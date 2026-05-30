/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

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

loadDotEnv(Path.join(__dirname, '..', '.env'));

function loadDotEnv(path) {
    if (!Fs.existsSync(path)) return;

    const lines = Fs.readFileSync(path, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separator = trimmed.indexOf('=');
        if (separator <= 0) continue;

        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (!hasEnv(key)) {
            process.env[key] = value;
        }
    }
}

function hasEnv(key) {
    return Object.prototype.hasOwnProperty.call(process.env, key);
}

function envBool(key, defaultValue = false) {
    if (!hasEnv(key)) return defaultValue;
    return `${process.env[key]}`.toLowerCase() === 'true';
}

function envInt(key, defaultValue) {
    const parsed = parseInt(process.env[key] || defaultValue);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

module.exports = {
    general: {
        language: process.env.RPP_LANGUAGE || 'en',
        pollingIntervalMs: envInt('RPP_POLLING_INTERVAL', 10000),
        showCallStackError: envBool('RPP_LOG_CALL_STACK', false),
        reconnectIntervalMs: envInt('RPP_RECONNECT_INTERVAL', 15000),
    },
    discord: {
        username: process.env.RPP_DISCORD_USERNAME || 'RustAssist',
        clientId: process.env.RPP_DISCORD_CLIENT_ID || '',
        token: process.env.RPP_DISCORD_TOKEN || '',
        needAdminPrivileges: envBool('RPP_NEED_ADMIN_PRIVILEGES', true), /* If true, only admins can delete (server, switch..), manage credentials and reset a channel */
    },
    battlemetrics: {
        token: process.env.RPP_BATTLEMETRICS_TOKEN || '',
    },
    license: {
        required: envBool('RPP_LICENSE_REQUIRED', false),
        apiUrl: process.env.RPP_LICENSE_API_URL || '',
        validationGraceMs: envInt('RPP_LICENSE_VALIDATION_GRACE_MS', 86400000),
        activationTimeoutMs: envInt('RPP_LICENSE_ACTIVATION_TIMEOUT_MS', 900000),
        bypass: envBool('RPP_LICENSE_BYPASS', false),
    },
    fleet: {
        instanceId: process.env.RPP_BOT_INSTANCE_ID || 'rustassist-1',
        instanceToken: process.env.RPP_BOT_INSTANCE_TOKEN || '',
        inviteUrl: process.env.RPP_BOT_INVITE_URL || '',
        activeGuildLimit: envInt('RPP_BOT_ACTIVE_GUILD_LIMIT', 20),
    },
    streamDeck: {
        enabled: envBool('RPP_STREAM_DECK_ENABLED', false),
        host: process.env.RPP_STREAM_DECK_HOST || 'localhost',
        port: envInt('RPP_STREAM_DECK_PORT', 8074),
        /* Per-guild passwords. Examples:
           RPP_STREAM_DECK_API_PASSWORDS='1134548581378961473=pass1,1033084565323001867=pass2'
           RPP_STREAM_DECK_API_PASSWORDS='{"1134548581378961473":"pass1","1033084565323001867":"pass2"}'
        */
        apiPasswords: process.env.RPP_STREAM_DECK_API_PASSWORDS || '',
    }
};
