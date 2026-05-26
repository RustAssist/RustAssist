const DEFAULT_WINDOW_HOURS = 3;
const MIN_RELIABLE_PLAYER_CONFIDENCE = 45;
const MIN_RELIABLE_PLAYERS = 2;

function buildTrackerActivityReport(db, bmIds, serverId, guildId, days, timezone, bmPlayers = {}, nowMs = Date.now()) {
    const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
    const tzOffsetMs = parseOffsetToMs(getUtcOffsetStr(timezone));
    const summaries = [];

    for (const bmId of bmIds) {
        const events = db.getAllPlayerEvents(bmId, serverId, guildId, cutoffMs);
        const sessions = buildSessions(events, cutoffMs, nowMs);
        const playerInfo = db.getPlayerInfo(bmId, serverId, guildId);
        const bmPlayer = bmPlayers[bmId] || {};
        const hourMinutes = computeOnlineMinutesPerHour(sessions, tzOffsetMs);
        const observedHours = getObservedHours(events, cutoffMs, nowMs);
        const sessions7d = sessions.filter(([start, end]) => end >= nowMs - 7 * 24 * 60 * 60 * 1000).length;
        const confidence = getPlayerConfidence(events.length, sessions.length, observedHours);

        summaries.push({
            bmId,
            name: bmPlayer.name || (playerInfo ? playerInfo.name : bmId),
            isOnline: !!bmPlayer.status,
            events: events.length,
            sessions: sessions.length,
            sessions7d,
            observedHours,
            confidence,
            totals: {
                h24: sumSessionMinutes(sessions, nowMs - 24 * 60 * 60 * 1000, nowMs),
                d7: sumSessionMinutes(sessions, nowMs - 7 * 24 * 60 * 60 * 1000, nowMs),
                d30: sumSessionMinutes(sessions, cutoffMs, nowMs)
            },
            lastConnected: lastEventTimestamp(events, 'online'),
            lastDisconnected: lastEventTimestamp(events, 'offline'),
            lastSeen: lastSeenTimestamp(events),
            likelySleep: confidence >= MIN_RELIABLE_PLAYER_CONFIDENCE ?
                bestWindow(hourMinutes, 6, false) : null,
            likelyPlaying: confidence >= MIN_RELIABLE_PLAYER_CONFIDENCE ?
                bestWindow(hourMinutes, 5, true) : null,
            peakHours: confidence >= MIN_RELIABLE_PLAYER_CONFIDENCE ?
                topHours(hourMinutes, 3) : [],
            activeProbByHour: toActiveProbability(hourMinutes, observedHours)
        });
    }

    const reliablePlayers = summaries.filter(player =>
        player.confidence >= MIN_RELIABLE_PLAYER_CONFIDENCE && player.sessions > 0);
    const groupWindows = buildGroupRaidWindows(reliablePlayers);
    const groupConfidence = reliablePlayers.length > 0 ?
        Math.min(...reliablePlayers.map(player => player.confidence)) : 0;

    return {
        days,
        timezone,
        players: summaries,
        group: {
            reliable: reliablePlayers.length >= MIN_RELIABLE_PLAYERS && groupWindows.length > 0,
            confidence: groupConfidence,
            playersAnalyzed: reliablePlayers.length,
            playerCount: summaries.length,
            totalSessions: summaries.reduce((sum, player) => sum + player.sessions, 0),
            windows: groupWindows
        }
    };
}

function buildSessions(events, cutoffMs, nowMs) {
    const sessions = [];
    let sessionStart = null;

    for (const event of events) {
        if (event.event_type === 'online') {
            sessionStart = Math.max(event.timestamp, cutoffMs);
        }
        else if (event.event_type === 'offline' && sessionStart !== null) {
            const end = Math.min(event.timestamp, nowMs);
            if (end > sessionStart) sessions.push([sessionStart, end]);
            sessionStart = null;
        }
    }

    if (sessionStart !== null && nowMs > sessionStart) {
        sessions.push([sessionStart, nowMs]);
    }

    return sessions;
}

function getObservedHours(events, cutoffMs, nowMs) {
    const inWindow = events.filter(event => event.timestamp >= cutoffMs);
    if (inWindow.length === 0) return 0;
    return Math.max(0, (nowMs - inWindow[0].timestamp) / 3600000);
}

function getPlayerConfidence(eventCount, sessionCount, observedHours) {
    const eventScore = Math.min(1, eventCount / 8);
    const sessionScore = Math.min(1, sessionCount / 4);
    const spanScore = Math.min(1, observedHours / 72);
    return Math.round((eventScore * 0.2 + sessionScore * 0.5 + spanScore * 0.3) * 100);
}

function computeOnlineMinutesPerHour(sessions, tzOffsetMs) {
    const onlineMinutes = Array(24).fill(0);
    for (const [startMs, endMs] of sessions) {
        distributeSession(startMs, endMs, onlineMinutes, tzOffsetMs);
    }
    return onlineMinutes;
}

function distributeSession(startMs, endMs, onlineMinutes, tzOffsetMs) {
    let cur = startMs + tzOffsetMs;
    const end = endMs + tzOffsetMs;

    while (cur < end) {
        const slot = Math.floor(cur / 3600000) % 24;
        const nextHour = (Math.floor(cur / 3600000) + 1) * 3600000;
        const chunkEnd = Math.min(end, nextHour);
        onlineMinutes[(slot + 24) % 24] += (chunkEnd - cur) / 60000;
        cur = chunkEnd;
    }
}

function toActiveProbability(hourMinutes, observedHours) {
    const observedDays = Math.max(observedHours / 24, 1 / 24);
    return hourMinutes.map(minutes => Math.min(1, minutes / (observedDays * 60)));
}

function buildGroupRaidWindows(players) {
    if (players.length < MIN_RELIABLE_PLAYERS) return [];

    const risks = Array(24).fill(0).map((_, hour) =>
        Math.max(...players.map(player => player.activeProbByHour[hour])));
    const averageRisk = risks.reduce((sum, risk) => sum + risk, 0) / 24;

    const candidates = [];
    for (let startHour = 0; startHour < 24; startHour++) {
        const hours = [];
        for (let offset = 0; offset < DEFAULT_WINDOW_HOURS; offset++) {
            hours.push((startHour + offset) % 24);
        }

        const risk = hours.reduce((sum, hour) => sum + risks[hour], 0) / hours.length;
        const contrast = averageRisk > 0 ? Math.max(0, (averageRisk - risk) / averageRisk) : 0;
        const baseConfidence = Math.min(...players.map(player => player.confidence));
        candidates.push({
            startHour,
            endHour: (startHour + DEFAULT_WINDOW_HOURS) % 24,
            risk,
            confidence: Math.round(baseConfidence * 0.75 + Math.min(contrast, 1) * 25)
        });
    }

    candidates.sort((a, b) => a.risk - b.risk || b.confidence - a.confidence);

    const selected = [];
    for (const candidate of candidates) {
        if (selected.every(window => !windowsOverlap(window.startHour, candidate.startHour, DEFAULT_WINDOW_HOURS))) {
            selected.push(candidate);
        }
        if (selected.length === 3) break;
    }

    return selected;
}

function windowsOverlap(aStart, bStart, duration) {
    const aHours = new Set(Array.from({ length: duration }, (_, i) => (aStart + i) % 24));
    return Array.from({ length: duration }, (_, i) => (bStart + i) % 24).some(hour => aHours.has(hour));
}

function bestWindow(hourMinutes, duration, highest) {
    let bestStart = 0;
    let bestTotal = null;

    for (let startHour = 0; startHour < 24; startHour++) {
        let total = 0;
        for (let offset = 0; offset < duration; offset++) {
            total += hourMinutes[(startHour + offset) % 24];
        }

        if (bestTotal === null || (highest ? total > bestTotal : total < bestTotal)) {
            bestTotal = total;
            bestStart = startHour;
        }
    }

    return { startHour: bestStart, endHour: (bestStart + duration) % 24 };
}

function topHours(hourMinutes, limit) {
    return Array.from({ length: 24 }, (_, hour) => hour)
        .sort((a, b) => hourMinutes[b] - hourMinutes[a])
        .slice(0, limit);
}

function sumSessionMinutes(sessions, windowStart, windowEnd) {
    return sessions.reduce((sum, [start, end]) => {
        const clippedStart = Math.max(start, windowStart);
        const clippedEnd = Math.min(end, windowEnd);
        return clippedEnd > clippedStart ? sum + (clippedEnd - clippedStart) / 60000 : sum;
    }, 0);
}

function lastEventTimestamp(events, type) {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].event_type === type) return events[i].timestamp;
    }
    return null;
}

function lastSeenTimestamp(events) {
    return events.length > 0 ? events[events.length - 1].timestamp : null;
}

function formatDuration(minutes) {
    const totalMinutes = Math.round(minutes);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
}

function formatHour(hour) {
    return `${hour.toString().padStart(2, '0')}:00`;
}

function formatHourRange(window) {
    return `${formatHour(window.startHour)} - ${formatHour(window.endHour)}`;
}

function parseOffsetToMs(offsetStr) {
    const match = offsetStr.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!match) return 0;
    const sign = match[1] === '+' ? 1 : -1;
    return sign * (parseInt(match[2]) * 60 + parseInt(match[3])) * 60000;
}

function getUtcOffsetStr(timezone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'longOffset'
        }).formatToParts(new Date());
        const tzName = parts.find(part => part.type === 'timeZoneName');
        const match = tzName && tzName.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
        if (!match) return '+00:00';
        return `${match[1]}${match[2].padStart(2, '0')}:${match[3] || '00'}`;
    }
    catch (e) {
        return '+00:00';
    }
}

module.exports = {
    buildTrackerActivityReport,
    formatDuration,
    formatHour,
    formatHourRange
};
