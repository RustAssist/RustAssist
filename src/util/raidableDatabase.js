/*
    Copyright (C) 2024 rustplusplus contributors

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

const RAIDABLE_BASE_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert', 'nightmare'];
const RAIDABLE_BASE_MAX_AGE_MS = 2 * 60 * 60 * 1000; /* 2 hours */

/**
 * Parse a raidable base vending machine name to extract difficulty and metadata.
 * Example names:
 *   "[PVE] easy Loot: 27 Raidable Base Event [26m]"
 *   "[PVP] hard Loot: 42 Raidable Base Event [45m]"
 *   "medium Loot: 15 Raidable Base Event [30m]"
 */
function parseRaidableBaseName(name) {
    if (!name || typeof name !== 'string') return null;
    if (!name.toLowerCase().includes('raidable base')) return null;

    const lower = name.toLowerCase();

    let difficulty = 'unknown';
    for (const diff of RAIDABLE_BASE_DIFFICULTIES) {
        if (lower.includes(diff)) {
            difficulty = diff;
            break;
        }
    }

    let lootCount = null;
    const lootMatch = name.match(/Loot:\s*(\d+)/i);
    if (lootMatch) {
        lootCount = parseInt(lootMatch[1], 10);
    }

    let timeRemaining = null;
    const timeMatch = name.match(/\[(\d+)m\]/);
    if (timeMatch) {
        timeRemaining = parseInt(timeMatch[1], 10);
    }

    let mode = null;
    if (lower.includes('[pve]')) mode = 'PVE';
    else if (lower.includes('[pvp]')) mode = 'PVP';

    return { difficulty, lootCount, timeRemaining, mode };
}

/**
 * RaidableBaseDB - tracks raidable base spawn and claim events
 */
class RaidableBaseDB {
    constructor() {
        this.dbFolder = Path.join(__dirname, '..', '..', 'database');

        if (!Fs.existsSync(this.dbFolder)) {
            Fs.mkdirSync(this.dbFolder);
        }

        this.db = null;
        this.init();
    }

    init() {
        try {
            this.db = new Database(Path.join(this.dbFolder, 'raidable_bases.db'));

            this.db.exec(`
                CREATE TABLE IF NOT EXISTS raidable_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    server_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    difficulty TEXT,
                    mode TEXT,
                    loot_count INTEGER,
                    location TEXT,
                    grid TEXT,
                    x REAL,
                    y REAL,
                    timestamp INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_raidable_server ON raidable_events(server_id, guild_id);
                CREATE INDEX IF NOT EXISTS idx_raidable_timestamp ON raidable_events(timestamp);
                CREATE INDEX IF NOT EXISTS idx_raidable_difficulty ON raidable_events(difficulty);
            `);

            this.insertEventStmt = this.db.prepare(`
                INSERT INTO raidable_events (server_id, guild_id, event_type, difficulty, mode, loot_count, location, grid, x, y, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            this.getRecentEventsStmt = this.db.prepare(`
                SELECT * FROM raidable_events
                WHERE server_id = ? AND guild_id = ?
                ORDER BY timestamp DESC
                LIMIT ?
            `);

            this.getEventsByDifficultyStmt = this.db.prepare(`
                SELECT * FROM raidable_events
                WHERE server_id = ? AND guild_id = ? AND difficulty = ?
                ORDER BY timestamp DESC
                LIMIT ?
            `);

            this.getStatsStmt = this.db.prepare(`
                SELECT
                    difficulty,
                    event_type,
                    COUNT(*) as count
                FROM raidable_events
                WHERE server_id = ? AND guild_id = ? AND timestamp >= ?
                GROUP BY difficulty, event_type
                ORDER BY difficulty, event_type
            `);

            console.log('RaidableBaseDB initialized successfully');
        } catch (error) {
            console.error('Error initializing RaidableBaseDB:', error);
        }
    }

    /**
     * Record a raidable base event (spawn, claimed, despawned)
     */
    recordEvent(serverId, guildId, eventType, { difficulty, mode, lootCount, location, grid, x, y }) {
        try {
            this.insertEventStmt.run(
                serverId, guildId, eventType,
                difficulty || null, mode || null, lootCount || null,
                location || null, grid || null, x || null, y || null,
                Date.now()
            );
        } catch (error) {
            console.error('Error recording raidable event:', error);
        }
    }

    /**
     * Get recent raidable base events
     */
    getRecentEvents(serverId, guildId, limit = 20) {
        try {
            return this.getRecentEventsStmt.all(serverId, guildId, limit);
        } catch (error) {
            console.error('Error getting recent raidable events:', error);
            return [];
        }
    }

    /**
     * Get recent events filtered by difficulty
     */
    getEventsByDifficulty(serverId, guildId, difficulty, limit = 20) {
        try {
            return this.getEventsByDifficultyStmt.all(serverId, guildId, difficulty, limit);
        } catch (error) {
            console.error('Error getting raidable events by difficulty:', error);
            return [];
        }
    }

    /**
     * Get stats for a time period (default: last 24 hours)
     */
    getStats(serverId, guildId, sinceMs = null) {
        try {
            const since = sinceMs || (Date.now() - 24 * 60 * 60 * 1000);
            return this.getStatsStmt.all(serverId, guildId, since);
        } catch (error) {
            console.error('Error getting raidable stats:', error);
            return [];
        }
    }

    /**
     * Get active raidable bases (spawned but not yet claimed/despawned)
     * @param {string} serverId
     * @param {string} guildId
     * @param {string|null} difficulty - optional filter
     */
    getActive(serverId, guildId, difficulty = null) {
        try {
            let sql = `
                SELECT e1.*
                FROM raidable_events e1
                WHERE e1.server_id = ? AND e1.guild_id = ? AND e1.event_type = 'spawn'
                AND e1.timestamp >= ?
                AND NOT EXISTS (
                    SELECT 1 FROM raidable_events e2
                    WHERE e2.server_id = e1.server_id AND e2.guild_id = e1.guild_id
                    AND e2.x = e1.x AND e2.y = e1.y
                    AND e2.event_type IN ('claimed', 'despawned')
                    AND e2.timestamp > e1.timestamp
                )`;
            const params = [serverId, guildId, Date.now() - RAIDABLE_BASE_MAX_AGE_MS];

            if (difficulty) {
                sql += ` AND e1.difficulty = ?`;
                params.push(difficulty);
            }

            sql += ` ORDER BY e1.loot_count DESC, e1.timestamp DESC`;

            return this.db.prepare(sql).all(...params);
        } catch (error) {
            console.error('Error getting active raidable bases:', error);
            return [];
        }
    }
}

module.exports = new RaidableBaseDB();
module.exports.parseRaidableBaseName = parseRaidableBaseName;
module.exports.RAIDABLE_BASE_DIFFICULTIES = RAIDABLE_BASE_DIFFICULTIES;
