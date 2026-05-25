/*
    Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

const Fs = require('fs');
const Path = require('path');
const Database = require('better-sqlite3');

/**
 * PlayerActivity database manager
 * Tracks player login/logout events and provides analysis of offline patterns
 */
class PlayerActivityDB {
    constructor() {
        this.dbFolder = Path.join(__dirname, '..', '..', 'database');
        
        // Ensure database directory exists
        if (!Fs.existsSync(this.dbFolder)) {
            Fs.mkdirSync(this.dbFolder);
        }
        
        this.db = null;
        this.init();
    }

    /**
     * Initialize the database and create tables if they don't exist
     */
    init() {
        try {
            this.db = new Database(Path.join(this.dbFolder, 'player_activity.db'));
            
            // Create tables if they don't exist
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS players (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bm_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    server_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    UNIQUE(bm_id, server_id, guild_id)
                );
                
                CREATE TABLE IF NOT EXISTS activity_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    FOREIGN KEY (player_id) REFERENCES players(id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_activity_events_player_id ON activity_events(player_id);
                CREATE INDEX IF NOT EXISTS idx_activity_events_timestamp ON activity_events(timestamp);

                CREATE TABLE IF NOT EXISTS name_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    first_seen INTEGER NOT NULL,
                    FOREIGN KEY (player_id) REFERENCES players(id)
                );

                CREATE INDEX IF NOT EXISTS idx_name_history_player_id ON name_history(player_id);
            `);
            
            // Prepare statements
            this.insertPlayerStmt = this.db.prepare(`
                INSERT OR IGNORE INTO players (bm_id, name, server_id, guild_id) 
                VALUES (?, ?, ?, ?)
            `);
            
            this.getPlayerIdStmt = this.db.prepare(`
                SELECT id FROM players WHERE bm_id = ? AND server_id = ? AND guild_id = ?
            `);
            
            this.updatePlayerNameStmt = this.db.prepare(`
                UPDATE players SET name = ? WHERE bm_id = ? AND server_id = ? AND guild_id = ?
            `);

            this.insertNameHistoryStmt = this.db.prepare(`
                INSERT INTO name_history (player_id, name, first_seen)
                SELECT ?, ?, ?
                WHERE NOT EXISTS (
                    SELECT 1 FROM name_history WHERE player_id = ? AND name = ?
                )
            `);

            this.getNameHistoryStmt = this.db.prepare(`
                SELECT name, first_seen
                FROM name_history
                WHERE player_id = ?
                ORDER BY first_seen ASC
            `);
            
            this.insertActivityEventStmt = this.db.prepare(`
                INSERT INTO activity_events (player_id, event_type, timestamp)
                VALUES (?, ?, ?)
            `);
            
            this.getPlayerHistoryStmt = this.db.prepare(`
                SELECT 
                    e.event_type,
                    e.timestamp,
                    p.name
                FROM activity_events e
                JOIN players p ON e.player_id = p.id
                WHERE p.bm_id = ? AND p.server_id = ? AND p.guild_id = ?
                ORDER BY e.timestamp DESC
                LIMIT ?
            `);
            
            this.getPlayerInfoStmt = this.db.prepare(`
                SELECT * FROM players WHERE bm_id = ? AND server_id = ? AND guild_id = ?
            `);

            this.getRecentActivityStmt = this.db.prepare(`
                SELECT 
                    p.name,
                    p.bm_id,
                    e.event_type,
                    e.timestamp
                FROM activity_events e
                JOIN players p ON e.player_id = p.id
                WHERE p.server_id = ? AND p.guild_id = ?
                ORDER BY e.timestamp DESC
                LIMIT ?
            `);

            this.getAllPlayerEventsStmt = this.db.prepare(`
                SELECT e.event_type, e.timestamp
                FROM activity_events e
                WHERE e.player_id = ?
                  AND e.timestamp >= ?
                ORDER BY e.timestamp ASC
            `);
            
            console.log('PlayerActivityDB initialized successfully');
        } catch (error) {
            console.error('Error initializing PlayerActivityDB:', error);
        }
    }

    /**
     * Record a player login event
     * @param {string} bmId - Player's Battlemetrics ID
     * @param {string} name - Player's name
     * @param {string} serverId - Server ID
     * @param {string} guildId - Discord Guild ID
     */
    recordLogin(bmId, name, serverId, guildId) {
        try {
            const playerId = this.getOrCreatePlayer(bmId, name, serverId, guildId);
            this.insertActivityEventStmt.run(playerId, 'online', Date.now());
        } catch (error) {
            console.error('Error recording login:', error);
        }
    }

    /**
     * Record a player logout event
     * @param {string} bmId - Player's Battlemetrics ID
     * @param {string} name - Player's name
     * @param {string} serverId - Server ID
     * @param {string} guildId - Discord Guild ID
     */
    recordLogout(bmId, name, serverId, guildId) {
        try {
            const playerId = this.getOrCreatePlayer(bmId, name, serverId, guildId);
            this.insertActivityEventStmt.run(playerId, 'offline', Date.now());
        } catch (error) {
            console.error('Error recording logout:', error);
        }
    }
    
    /**
     * Get or create a player record
     * @private
     */
    getOrCreatePlayer(bmId, name, serverId, guildId) {
        // Insert player if not exists
        this.insertPlayerStmt.run(bmId, name, serverId, guildId);

        // Get player ID
        const player = this.getPlayerIdStmt.get(bmId, serverId, guildId);
        const playerId = player ? player.id : null;

        if (playerId !== null) {
            // Update current name
            this.updatePlayerNameStmt.run(name, bmId, serverId, guildId);

            // Record name in history if not already there
            this.insertNameHistoryStmt.run(playerId, name, Date.now(), playerId, name);
        }

        return playerId;
    }
    

    
    /**
     * Get a player's activity history
     */
    getPlayerHistory(bmId, serverId, guildId, limit = 20) {
        try {
            return this.getPlayerHistoryStmt.all(bmId, serverId, guildId, limit);
        } catch (error) {
            console.error('Error getting player history:', error);
            return [];
        }
    }
    
    /**
     * Get offline patterns for a player
     * @param {string} bmId
     * @param {string} serverId
     * @param {string} guildId
     * @param {number} [days=30] - how many days of history to include
     * @param {string} [timezone='America/New_York'] - IANA timezone name
     */
    getOfflinePatterns(bmId, serverId, guildId, days = 30, timezone = 'America/New_York') {
        try {
            const playerId = this.getPlayerIdStmt.get(bmId, serverId, guildId);
            if (!playerId) return [];

            const offset = getUtcOffsetStr(timezone);
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

            return this.db.prepare(`
                SELECT
                    strftime('%H', datetime(timestamp/1000, 'unixepoch', '${offset}')) AS hour,
                    COUNT(*) AS count
                FROM activity_events
                WHERE player_id = ? AND event_type = 'offline' AND timestamp >= ?
                GROUP BY hour
                ORDER BY count DESC
            `).all(playerId.id, cutoff);
        } catch (error) {
            console.error('Error getting offline patterns:', error);
            return [];
        }
    }
    
    /**
     * Get info about a player
     */
    getPlayerInfo(bmId, serverId, guildId) {
        try {
            return this.getPlayerInfoStmt.get(bmId, serverId, guildId);
        } catch (error) {
            console.error('Error getting player info:', error);
            return null;
        }
    }

    /**
     * Get name history for a player
     * @param {string} bmId - Player's Battlemetrics ID
     * @param {string} serverId - Server ID
     * @param {string} guildId - Discord Guild ID
     * @returns {Array} - Array of { name, first_seen } ordered oldest to newest
     */
    getNameHistory(bmId, serverId, guildId) {
        try {
            const player = this.getPlayerIdStmt.get(bmId, serverId, guildId);
            if (!player) return [];
            return this.getNameHistoryStmt.all(player.id);
        } catch (error) {
            console.error('Error getting name history:', error);
            return [];
        }
    }
    
    /**
     * Get recent activity for a server
     */
    getRecentActivity(serverId, guildId, limit = 20) {
        try {
            return this.getRecentActivityStmt.all(serverId, guildId, limit);
        } catch (error) {
            console.error('Error getting recent activity:', error);
            return [];
        }
    }

    /**
     * Get all activity events for a player within a time window, oldest first.
     * Also includes the last 'online' event before the cutoff so in-progress
     * sessions that started before the window are not lost.
     * @param {string} bmId
     * @param {string} serverId
     * @param {string} guildId
     * @param {number} cutoffMs - Unix epoch ms; only events >= cutoff are returned
     * @returns {Array} Array of { event_type, timestamp }
     */
    getAllPlayerEvents(bmId, serverId, guildId, cutoffMs) {
        try {
            const player = this.getPlayerIdStmt.get(bmId, serverId, guildId);
            if (!player) return [];

            const events = this.getAllPlayerEventsStmt.all(player.id, cutoffMs);

            // Prepend the last 'online' event before the cutoff so sessions
            // that started just before the window boundary are captured.
            const lastBefore = this.db.prepare(`
                SELECT event_type, timestamp
                FROM activity_events
                WHERE player_id = ? AND event_type = 'online' AND timestamp < ?
                ORDER BY timestamp DESC
                LIMIT 1
            `).get(player.id, cutoffMs);

            return lastBefore ? [lastBefore, ...events] : events;
        } catch (error) {
            console.error('Error getting all player events:', error);
            return [];
        }
    }
    
    /**
     * Analyze when a player is most likely to be offline.
     * Computes actual online time per hour from sessions, then identifies
     * hours with below-average online time as the offline windows.
     * Returns { ranges, peakHour } where peakHour is the hour with the
     * least online time (best raid hour).
     */
    analyzeOfflinePatterns(bmId, serverId, guildId, days = 30, timezone = 'America/New_York') {
        try {
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            const events = this.getAllPlayerEvents(bmId, serverId, guildId, cutoff);
            if (!events.length) return null;

            const tzOffsetMs = parseOffsetToMs(getUtcOffsetStr(timezone));
            const onlineMinutes = computeOnlineMinutesPerHour(events, tzOffsetMs);
            if (onlineMinutes.every(m => m === 0)) return null;

            const mean = onlineMinutes.reduce((a, b) => a + b, 0) / 24;
            // Hours with below-mean online time are offline windows;
            // score proportional to how far below the mean they are.
            const offlineScores = onlineMinutes.map(m => Math.max(0, mean - m));
            const peakHour = onlineMinutes.indexOf(Math.min(...onlineMinutes));
            const ranges = buildTimeRanges(offlineScores);
            return { ranges, peakHour };
        } catch (error) {
            console.error('Error analyzing offline patterns:', error);
            return null;
        }
    }

    /**
     * Find when a group of players are most likely to be offline simultaneously.
     * @param {string[]} bmIds - Array of Battlemetrics IDs
     * @param {string} serverId
     * @param {string} guildId
     * @returns {{ playerCount, players, missingIds, ranges, peakHour } | null}
     */
    analyzeGroupOfflineTime(bmIds, serverId, guildId, days = 30, timezone = 'America/New_York') {
        try {
            if (!bmIds || bmIds.length === 0) return null;

            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            const tzOffsetMs = parseOffsetToMs(getUtcOffsetStr(timezone));
            const playerData = [];
            const missingIds = [];

            for (const bmId of bmIds) {
                const events = this.getAllPlayerEvents(bmId, serverId, guildId, cutoff);
                if (!events.length) {
                    missingIds.push(bmId);
                    continue;
                }

                const onlineMinutes = computeOnlineMinutesPerHour(events, tzOffsetMs);
                if (onlineMinutes.every(m => m === 0)) {
                    missingIds.push(bmId);
                    continue;
                }

                const playerInfo = this.getPlayerInfoStmt.get(bmId, serverId, guildId);
                playerData.push({
                    bmId,
                    name: playerInfo ? playerInfo.name : bmId,
                    onlineMinutes
                });
            }

            if (playerData.length === 0) return null;

            // Use the MAX online minutes per hour across all players.
            // This is the "bottleneck" metric: the best raid hour is when
            // even the most-active player is at their least active.
            const maxOnlineMinutes = Array(24).fill(0);
            for (let h = 0; h < 24; h++) {
                maxOnlineMinutes[h] = Math.max(...playerData.map(pd => pd.onlineMinutes[h]));
            }

            const mean = maxOnlineMinutes.reduce((a, b) => a + b, 0) / 24;
            const offlineScores = maxOnlineMinutes.map(m => Math.max(0, mean - m));
            const peakHour = maxOnlineMinutes.indexOf(Math.min(...maxOnlineMinutes));
            const ranges = buildTimeRanges(offlineScores);

            return {
                playerCount: playerData.length,
                players: playerData.map(pd => pd.name),
                missingIds,
                ranges,
                peakHour
            };
        } catch (error) {
            console.error('Error analyzing group offline time:', error);
            return null;
        }
    }
    
    /**
     * Get name history for a player by BM ID across all servers in a guild.
     */
    getNameHistoryByBmId(bmId, guildId) {
        try {
            return this.db.prepare(`
                SELECT nh.name, MIN(nh.first_seen) AS first_seen
                FROM name_history nh
                JOIN players p ON nh.player_id = p.id
                WHERE p.bm_id = ? AND p.guild_id = ?
                GROUP BY nh.name
                ORDER BY first_seen ASC
            `).all(bmId, guildId);
        } catch (error) {
            console.error('Error getting name history by BM ID:', error);
            return [];
        }
    }

    /**
     * Search for players by name (current or historical) within a guild.
     * Returns one result per unique bm_id, using the player's current name.
     */
    searchPlayersByName(name, guildId, like = false) {
        try {
            const value = like ? `%${name}%` : name;
            const op = like ? 'LIKE' : '=';
            return this.db.prepare(`
                SELECT p.bm_id, p.name
                FROM players p
                WHERE p.guild_id = ?
                  AND (
                    LOWER(p.name) ${op} LOWER(?)
                    OR EXISTS (
                        SELECT 1 FROM name_history nh
                        WHERE nh.player_id = p.id AND LOWER(nh.name) ${op} LOWER(?)
                    )
                  )
                GROUP BY p.bm_id
            `).all(guildId, value, value);
        } catch (error) {
            console.error('Error searching players by name:', error);
            return [];
        }
    }

    /**
     * Get a player record by BM ID within a guild.
     */
    getPlayerByBmId(bmId, guildId) {
        try {
            return this.db.prepare(
                `SELECT bm_id, name FROM players WHERE bm_id = ? AND guild_id = ? LIMIT 1`
            ).get(bmId, guildId);
        } catch (error) {
            console.error('Error getting player by BM ID:', error);
            return null;
        }
    }

    /**
     * Get all activity events for a player across all servers in a guild, oldest first.
     * Includes a look-behind 'online' event for sessions that started before the cutoff.
     */
    getAllPlayerEventsAllServers(bmId, guildId, cutoffMs) {
        try {
            const players = this.db.prepare(
                `SELECT id FROM players WHERE bm_id = ? AND guild_id = ?`
            ).all(bmId, guildId);

            if (!players.length) return [];

            const ids = players.map(p => p.id);
            const ph = ids.map(() => '?').join(',');

            const events = this.db.prepare(`
                SELECT event_type, timestamp
                FROM activity_events
                WHERE player_id IN (${ph}) AND timestamp >= ?
                ORDER BY timestamp ASC
            `).all(...ids, cutoffMs);

            const last = this.db.prepare(`
                SELECT event_type, timestamp
                FROM activity_events
                WHERE player_id IN (${ph}) AND event_type = 'online' AND timestamp < ?
                ORDER BY timestamp DESC
                LIMIT 1
            `).get(...ids, cutoffMs);

            return last ? [last, ...events] : events;
        } catch (error) {
            console.error('Error getting all player events across servers:', error);
            return [];
        }
    }

    /**
     * Get merged activity events for a group of players (multiple BM IDs) across all servers
     * in a guild, oldest first. Each player's events are fetched independently (including the
     * look-behind 'online' event) and returned as a map keyed by bmId.
     */
    getGroupEventsAllServers(bmIds, guildId, cutoffMs) {
        const result = {};
        for (const bmId of bmIds) {
            result[bmId] = this.getAllPlayerEventsAllServers(bmId, guildId, cutoffMs);
        }
        return result;
    }

    /**
     * Close the database connection
     */
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

/**
 * Parse a UTC offset string (e.g. '-04:00', '+05:30') to milliseconds.
 */
function parseOffsetToMs(offsetStr) {
    const match = offsetStr.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!match) return 0;
    const sign = match[1] === '+' ? 1 : -1;
    return sign * (parseInt(match[2]) * 60 + parseInt(match[3])) * 60000;
}

/**
 * Compute total online minutes per hour-of-day from a sorted list of events.
 * Each login→logout pair forms a session whose duration is distributed across
 * the local hours it spans.
 * @param {Array<{event_type: string, timestamp: number}>} events - sorted ascending
 * @param {number} tzOffsetMs - timezone offset in ms (from parseOffsetToMs)
 * @returns {number[]} 24-element array of online minutes indexed by local hour
 */
function computeOnlineMinutesPerHour(events, tzOffsetMs) {
    const onlineMinutes = Array(24).fill(0);
    let sessionStart = null;

    for (const event of events) {
        if (event.event_type === 'online') {
            sessionStart = event.timestamp;
        } else if (event.event_type === 'offline' && sessionStart !== null) {
            distributeSession(sessionStart, event.timestamp, onlineMinutes, tzOffsetMs);
            sessionStart = null;
        }
    }
    // Player is still online — count up to now
    if (sessionStart !== null) {
        distributeSession(sessionStart, Date.now(), onlineMinutes, tzOffsetMs);
    }

    return onlineMinutes;
}

/**
 * Distribute the online time of a single session across the 24-hour buckets.
 */
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

/**
 * Convert an IANA timezone name to a SQLite-compatible UTC offset string (e.g. '-04:00').
 * Falls back to '-05:00' (Eastern Standard Time) on any error.
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} offset like '+05:30' or '-04:00'
 */
function getUtcOffsetStr(timezone) {
    try {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'longOffset'
        }).formatToParts(now);
        const tzName = parts.find(p => p.type === 'timeZoneName');
        if (tzName) {
            const match = tzName.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
            if (match) {
                const sign = match[1];
                const h = match[2].padStart(2, '0');
                const m = match[3] || '00';
                return `${sign}${h}:${m}`;
            }
            // GMT+0 case
            if (tzName.value === 'GMT') return '+00:00';
        }
        return '-05:00';
    } catch (e) {
        return '-05:00';
    }
}

/**
 * Build sorted time ranges from a 24-element array of hourly scores.
 * Only includes hours whose score is at least `thresholdFraction` of the
 * maximum score, so shallow below-mean hours don't bloat the window.
 * Handles midnight wrap-around (hours 23 and 0 treated as adjacent).
 * Returns ranges sorted by average score per hour, highest first.
 * @param {number[]} hourScores - 24-element array indexed by hour (0-23)
 * @param {number} [thresholdFraction=0.33] - fraction of max score required to qualify
 */
function buildTimeRanges(hourScores, thresholdFraction = 0.33) {
    const maxScore = Math.max(...hourScores);
    const threshold = maxScore * thresholdFraction;

    const ranges = [];
    let currentRange = null;

    for (let i = 0; i < 24; i++) {
        const score = hourScores[i];
        if (score >= threshold && score > 0) {
            if (!currentRange) {
                currentRange = { start: i, end: i, totalScore: score };
            } else {
                currentRange.end = i;
                currentRange.totalScore += score;
            }
        } else if (currentRange) {
            ranges.push(currentRange);
            currentRange = null;
        }
    }
    if (currentRange) ranges.push(currentRange);

    // Merge first and last ranges if they are adjacent across midnight (23 -> 0)
    if (ranges.length >= 2 && ranges[0].start === 0 && ranges[ranges.length - 1].end === 23) {
        const last = ranges.pop();
        const first = ranges.shift();
        ranges.unshift({
            start: last.start,
            end: first.end,
            totalScore: last.totalScore + first.totalScore,
            spansMidnight: true
        });
    }

    return ranges.map(range => {
        const duration = range.spansMidnight
            ? (24 - range.start) + range.end + 1
            : range.end - range.start + 1;
        return {
            startHour: range.start,
            endHour: range.end,
            duration,
            offlineEvents: range.totalScore,
            averageEventsPerHour: range.totalScore / duration,
            spansMidnight: !!range.spansMidnight
        };
    }).sort((a, b) => b.averageEventsPerHour - a.averageEventsPerHour);
}

module.exports = new PlayerActivityDB();
