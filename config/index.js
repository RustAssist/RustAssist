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

module.exports = {
    general: {
        language: process.env.RPP_LANGUAGE || 'en',
        pollingIntervalMs: process.env.RPP_POLLING_INTERVAL || 10000,
        showCallStackError: process.env.RPP_LOG_CALL_STACK || false,
        reconnectIntervalMs: process.env.RPP_RECONNECT_INTERVAL || 15000,
    },
    discord: {
        username: process.env.RPP_DISCORD_USERNAME || 'RustAssist',
        clientId: process.env.RPP_DISCORD_CLIENT_ID || '',
        token: process.env.RPP_DISCORD_TOKEN || '',
        needAdminPrivileges: process.env.RPP_NEED_ADMIN_PRIVILEGES || true, /* If true, only admins can delete (server, switch..), manage credentials and reset a channel */
    },
    battlemetrics: {
        token: process.env.RPP_BATTLEMETRICS_TOKEN || '',
    },
    streamDeck: {
        enabled: process.env.RPP_STREAM_DECK_ENABLED === 'false',
        host: process.env.RPP_STREAM_DECK_HOST || 'localhost',
        port: process.env.RPP_STREAM_DECK_PORT || 8074,
        /* Per-guild passwords. Examples:
           RPP_STREAM_DECK_API_PASSWORDS='1134548581378961473=pass1,1033084565323001867=pass2'
           RPP_STREAM_DECK_API_PASSWORDS='{"1134548581378961473":"pass1","1033084565323001867":"pass2"}'
        */
        apiPasswords: process.env.RPP_STREAM_DECK_API_PASSWORDS || '',
    },
    license: {
        apiUrl: process.env.RPP_LICENSE_API_URL || '',
        apiToken: process.env.RPP_LICENSE_API_TOKEN || '',
        timeoutMs: Number(process.env.RPP_LICENSE_API_TIMEOUT_MS || 5000),
        graceMs: Number(process.env.RPP_LICENSE_GRACE_MS || 21600000),
        unlicensedLeaveDelayMs: Number(process.env.RPP_UNLICENSED_LEAVE_DELAY_MS || 900000),
        expiredLeaveAfterDays: Number(process.env.RPP_EXPIRED_LEAVE_AFTER_DAYS || 7),
        expiredArchiveAfterDays: Number(process.env.RPP_EXPIRED_ARCHIVE_AFTER_DAYS || 14),
        deleteCreatedChannelsOnLeave: process.env.RPP_DELETE_CREATED_CHANNELS_ON_LEAVE === 'true',
        credentialsRetentionDays: Number(process.env.RPP_CREDENTIALS_RETENTION_DAYS || 14),
    },
    rustplusBackend: {
        mode: process.env.RPP_RUSTPLUS_BACKEND || 'local',
        proxyUrl: process.env.RPP_RUSTPLUS_PROXY_URL || '',
        proxies: process.env.RPP_RUSTPLUS_PROXIES || '',
        defaultProxyId: process.env.RPP_RUSTPLUS_DEFAULT_PROXY_ID || '',
        allowLocalFallback: process.env.RPP_RUSTPLUS_ALLOW_LOCAL_FALLBACK === 'true',
    }
};
