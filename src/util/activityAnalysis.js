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

const { DateTime } = require('luxon');
const { createCanvas } = require('canvas');
const { Chart, registerables } = require('chart.js');
const { MatrixController, MatrixElement } = require('chartjs-chart-matrix');

Chart.register(...registerables, MatrixController, MatrixElement);

const CHART_BG = '#2b2d31';
const LABEL_COLOR = '#b5bac1';
const GRID_COLOR = 'rgba(255,255,255,0.08)';
const BAR_COLOR = 'rgba(88, 101, 242, 0.85)';
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Walk through a player's activity events and accumulate online minutes into
 * hourly and weekday/hour buckets.
 *
 * @param {Array}  events    - [{event_type, timestamp}] sorted oldest→newest
 * @param {number} days      - look-back window in days
 * @param {string} timezone  - IANA timezone name (e.g. 'America/New_York')
 * @returns {object|null}
 */
function analyzeEvents(events, days, timezone) {
    if (!events || events.length === 0) return null;

    const cutoff = DateTime.now().setZone(timezone).minus({ days }).toMillis();

    const hourMinutes = new Array(24).fill(0);
    // heat[0] = Monday … heat[6] = Sunday  (Luxon weekday: Mon=1 … Sun=7)
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));

    let sessionStart = null;
    let totalMinutes = 0;

    for (const row of events) {
        const dt = DateTime.fromMillis(row.timestamp, { zone: timezone });

        if (row.event_type === 'online') {
            sessionStart = dt;
            continue;
        }

        if (row.event_type === 'offline' && sessionStart !== null) {
            // Clamp session start to the cutoff boundary.
            const effectiveStart = sessionStart.toMillis() < cutoff
                ? DateTime.fromMillis(cutoff, { zone: timezone })
                : sessionStart;

            if (dt > effectiveStart) {
                let current = effectiveStart;
                while (current < dt) {
                    const nextHour = current.startOf('hour').plus({ hours: 1 });
                    const segmentEnd = nextHour < dt ? nextHour : dt;
                    const minutes = segmentEnd.diff(current, 'minutes').minutes;

                    hourMinutes[current.hour] += minutes;
                    heat[current.weekday - 1][current.hour] += minutes;
                    totalMinutes += minutes;

                    current = segmentEnd;
                }
            }

            sessionStart = null;
        }
    }

    if (totalMinutes === 0) return null;

    // Top-3 hours by minutes
    const top3 = Array.from({ length: 24 }, (_, i) => i)
        .sort((a, b) => hourMinutes[b] - hourMinutes[a])
        .slice(0, 3);

    // Best 2-hour window (non-wrapping)
    let best2hStart = 0;
    let best2hTotal = hourMinutes[0] + hourMinutes[1];
    for (let h = 1; h < 23; h++) {
        const t = hourMinutes[h] + hourMinutes[h + 1];
        if (t > best2hTotal) { best2hTotal = t; best2hStart = h; }
    }

    return { hourMinutes, heat, totalMinutes, top3, best2hStart, best2hTotal, timezone, days };
}

/**
 * Render the hourly bar chart as a PNG Buffer.
 */
async function renderHourlyBarChart(hourMinutes, playerName, days, timezone) {
    const width = 960;
    const height = 320;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const bgPlugin = {
        id: 'customBackground',
        beforeDraw(chart) {
            const { ctx: c, width: w, height: h } = chart;
            c.save();
            c.fillStyle = CHART_BG;
            c.fillRect(0, 0, w, h);
            c.restore();
        }
    };

    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: `Minutes online (last ${days} days)`,
                data: hourMinutes,
                backgroundColor: BAR_COLOR,
                borderColor: 'rgba(88, 101, 242, 1)',
                borderWidth: 1
            }]
        },
        options: {
            animation: false,
            plugins: {
                title: {
                    display: true,
                    text: `${playerName} — Online time by hour (${timezone})`,
                    color: '#ffffff',
                    font: { size: 15 }
                },
                legend: { labels: { color: LABEL_COLOR } }
            },
            scales: {
                x: {
                    ticks: { color: LABEL_COLOR },
                    grid: { color: GRID_COLOR }
                },
                y: {
                    ticks: { color: LABEL_COLOR },
                    grid: { color: GRID_COLOR },
                    title: { display: true, text: 'Minutes online', color: LABEL_COLOR }
                }
            }
        },
        plugins: [bgPlugin]
    });

    const buffer = canvas.toBuffer('image/png');
    chart.destroy();
    return buffer;
}

/**
 * Render the weekday x hour heatmap as a PNG Buffer.
 */
async function renderHeatmap(heat, playerName, days, timezone) {
    const data = [];
    let maxVal = 0;
    for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
            const v = heat[d][h];
            data.push({ x: h, y: d, v });
            if (v > maxVal) maxVal = v;
        }
    }

    const width = 1080;
    const height = 380;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const bgPlugin = {
        id: 'customBackground',
        beforeDraw(chart) {
            const { ctx: c, width: w, height: h } = chart;
            c.save();
            c.fillStyle = CHART_BG;
            c.fillRect(0, 0, w, h);
            c.restore();
        }
    };

    const chart = new Chart(ctx, {
        type: 'matrix',
        data: {
            datasets: [{
                label: `Minutes online (last ${days} days)`,
                data,
                backgroundColor(context) {
                    const v = context.dataset.data[context.dataIndex]?.v ?? 0;
                    if (maxVal === 0) return 'rgba(68,1,84,1)';
                    const t = v / maxVal;
                    // Viridis colour stops (t=0..1)
                    const stops = [
                        [0.0,  [68,  1,   84]],
                        [0.13, [71,  44,  122]],
                        [0.25, [59,  81,  139]],
                        [0.38, [44,  113, 142]],
                        [0.50, [33,  144, 141]],
                        [0.63, [39,  173, 129]],
                        [0.75, [92,  200, 99]],
                        [0.88, [170, 220, 50]],
                        [1.0,  [253, 231, 37]]
                    ];
                    let lo = stops[0], hi = stops[stops.length - 1];
                    for (let i = 0; i < stops.length - 1; i++) {
                        if (t >= stops[i][0] && t <= stops[i + 1][0]) {
                            lo = stops[i]; hi = stops[i + 1]; break;
                        }
                    }
                    const f = lo[0] === hi[0] ? 0 : (t - lo[0]) / (hi[0] - lo[0]);
                    const r = Math.round(lo[1][0] + f * (hi[1][0] - lo[1][0]));
                    const g = Math.round(lo[1][1] + f * (hi[1][1] - lo[1][1]));
                    const b = Math.round(lo[1][2] + f * (hi[1][2] - lo[1][2]));
                    return `rgba(${r},${g},${b},1)`;
                },
                borderColor: 'rgba(0,0,0,0)',
                borderWidth: 1,
                width(context) {
                    const area = context.chart.chartArea ?? {};
                    return ((area.right - area.left) / 24) - 2;
                },
                height(context) {
                    const area = context.chart.chartArea ?? {};
                    return ((area.bottom - area.top) / 7) - 2;
                }
            }]
        },
        options: {
            animation: false,
            plugins: {
                title: {
                    display: true,
                    text: `${playerName} — Online time by weekday & hour (${timezone})`,
                    color: '#ffffff',
                    font: { size: 15 }
                },
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: {
                    type: 'linear',
                    min: -0.5,
                    max: 23.5,
                    afterBuildTicks(axis) {
                        axis.ticks = Array.from({ length: 24 }, (_, i) => ({ value: i }));
                    },
                    ticks: {
                        color: LABEL_COLOR,
                        callback: (v) => String(v).padStart(2, '0')
                    },
                    grid: { color: GRID_COLOR },
                    title: { display: true, text: `Hour of day (${timezone})`, color: LABEL_COLOR }
                },
                y: {
                    type: 'linear',
                    min: -0.5,
                    max: 6.5,
                    reverse: true,
                    afterBuildTicks(axis) {
                        axis.ticks = Array.from({ length: 7 }, (_, i) => ({ value: i }));
                    },
                    ticks: {
                        color: LABEL_COLOR,
                        callback: (v) => DAY_LABELS[v] ?? ''
                    },
                    grid: { color: GRID_COLOR }
                }
            }
        },
        plugins: [bgPlugin]
    });

    const buffer = canvas.toBuffer('image/png');
    chart.destroy();
    return buffer;
}

module.exports = { analyzeEvents, analyzeGroupEvents, renderHourlyBarChart, renderHeatmap };

/**
 * Merge activity events from multiple players into union (non-overlapping) intervals,
 * then bucket them the same way analyzeEvents does for a single player.
 *
 * @param {Object} eventsByBmId  - { [bmId]: [{event_type, timestamp}] }
 * @param {number} days
 * @param {string} timezone
 * @returns {object|null}
 */
function analyzeGroupEvents(eventsByBmId, days, timezone) {
    const cutoff = DateTime.now().setZone(timezone).minus({ days }).toMillis();

    // Step 1: collect all [start, end] intervals across every player.
    const intervals = [];
    for (const events of Object.values(eventsByBmId)) {
        if (!events || events.length === 0) continue;

        let sessionStart = null;
        for (const row of events) {
            if (row.event_type === 'online') {
                sessionStart = row.timestamp;
            } else if (row.event_type === 'offline' && sessionStart !== null) {
                const start = Math.max(sessionStart, cutoff);
                const end = row.timestamp;
                if (end > start) intervals.push([start, end]);
                sessionStart = null;
            }
        }
        // Still-open session: treat as lasting until now.
        if (sessionStart !== null) {
            const start = Math.max(sessionStart, cutoff);
            const end = DateTime.now().toMillis();
            if (end > start) intervals.push([start, end]);
        }
    }

    if (intervals.length === 0) return null;

    // Step 2: sort and merge overlapping intervals into a union.
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [intervals[0].slice()];
    for (let i = 1; i < intervals.length; i++) {
        const last = merged[merged.length - 1];
        if (intervals[i][0] <= last[1]) {
            last[1] = Math.max(last[1], intervals[i][1]);
        } else {
            merged.push(intervals[i].slice());
        }
    }

    // Step 3: bucket merged intervals into hourMinutes / heat exactly like analyzeEvents.
    const hourMinutes = new Array(24).fill(0);
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let totalMinutes = 0;

    for (const [startMs, endMs] of merged) {
        let current = DateTime.fromMillis(startMs, { zone: timezone });
        const end = DateTime.fromMillis(endMs, { zone: timezone });

        while (current < end) {
            const nextHour = current.startOf('hour').plus({ hours: 1 });
            const segmentEnd = nextHour < end ? nextHour : end;
            const minutes = segmentEnd.diff(current, 'minutes').minutes;

            hourMinutes[current.hour] += minutes;
            heat[current.weekday - 1][current.hour] += minutes;
            totalMinutes += minutes;

            current = segmentEnd;
        }
    }

    if (totalMinutes === 0) return null;

    const top3 = Array.from({ length: 24 }, (_, i) => i)
        .sort((a, b) => hourMinutes[b] - hourMinutes[a])
        .slice(0, 3);

    let best2hStart = 0;
    let best2hTotal = hourMinutes[0] + hourMinutes[1];
    for (let h = 1; h < 23; h++) {
        const t = hourMinutes[h] + hourMinutes[h + 1];
        if (t > best2hTotal) { best2hTotal = t; best2hStart = h; }
    }

    return { hourMinutes, heat, totalMinutes, top3, best2hStart, best2hTotal, timezone, days };
}
