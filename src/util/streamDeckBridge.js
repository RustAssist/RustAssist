/*
    Local HTTP/WebSocket bridge for Stream Deck.
*/

const Http = require('http');
const Url = require('url');
const { WebSocketServer, WebSocket } = require('ws');

const Config = require('../../config');
const Timer = require('./timer.js');

const DEFAULT_ENDPOINTS = ['server', 'time', 'pop', 'switches', 'alarms', 'switchgroups', 'trackers'];

class StreamDeckBridge {
    constructor(client) {
        this.client = client;
        this.config = Config.streamDeck || {};
        this.enabled = this.config.enabled !== false;
        this.host = this.config.host || 'localhost';
        this.port = parseInt(this.config.port || 8074);
        this.apiPassword = this.config.apiPassword || '';
        this.server = null;
        this.wss = null;
        this.wsClients = new Map();
    }

    start() {
        if (!this.enabled || this.server) return;

        this.server = Http.createServer(this.handleHttpRequest.bind(this));
        this.wss = new WebSocketServer({ server: this.server });

        this.wss.on('connection', (ws, request) => {
            const query = Url.parse(request.url, true).query;
            this.wsClients.set(ws, {
                authenticated: this.isAuthorizedRequest(request, query),
                guildId: this.resolveGuildId(query.guildId),
                endpoints: DEFAULT_ENDPOINTS
            });

            ws.on('message', data => this.handleWsMessage(ws, data));
            ws.on('close', () => this.wsClients.delete(ws));
            ws.on('error', error => this.log('warning', `Stream Deck WebSocket error: ${error.message}`));
        });

        this.server.listen(this.port, this.host, () => {
            this.log('info', `Stream Deck bridge listening on http://${this.host}:${this.port}`);
        });

        this.server.on('error', error => {
            this.log('error', `Stream Deck bridge failed: ${error.message}`);
        });
    }

    stop() {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.wsClients.clear();
    }

    async handleHttpRequest(req, res) {
        const parsed = Url.parse(req.url, true);
        const requestPath = this.normalizeRequestPath(parsed.pathname, parsed.query.guildId);

        this.setCommonHeaders(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (!this.isAuthorizedRequest(req, parsed.query)) {
            this.sendJson(res, 401, { error: 'Unauthorized' });
            return;
        }

        try {
            if (req.method === 'GET') {
                await this.handleGet(requestPath.pathname, requestPath.guildId, res);
                return;
            }

            if (req.method === 'POST') {
                await this.handlePost(requestPath.pathname, requestPath.guildId, res);
                return;
            }

            this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        catch (error) {
            this.log('error', `Stream Deck bridge request failed: ${error.stack || error}`);
            this.sendJson(res, 500, { error: 'Internal server error' });
        }
    }

    normalizeRequestPath(pathname, queryGuildId) {
        const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/';
        const segments = cleanPath.split('/').filter(Boolean);

        if (segments.length > 0 && this.client.instances.hasOwnProperty(segments[0])) {
            const withoutGuild = `/${segments.slice(1).join('/')}`.replace(/\/+$/, '') || '/';
            return {
                guildId: this.resolveGuildId(segments[0]),
                pathname: withoutGuild
            };
        }

        return {
            guildId: this.resolveGuildId(queryGuildId),
            pathname: cleanPath
        };
    }

    async handleGet(pathname, guildId, res) {
        if (pathname === '/health') {
            this.sendJson(res, 200, {
                ok: true,
                guildId,
                websocketClients: this.wsClients.size
            });
            return;
        }

        const routes = {
            '/': () => this.getServerData(guildId),
            '/time': () => this.getTimeData(guildId),
            '/pop': () => this.getPopData(guildId),
            '/switches': () => this.getSwitchesData(guildId),
            '/alarms': () => this.getAlarmsData(guildId),
            '/switchgroups': () => this.getSwitchGroupsData(guildId),
            '/trackers': () => this.getTrackersData(guildId)
        };

        const handler = routes[pathname];
        if (!handler) {
            this.sendJson(res, 404, { error: 'Not found' });
            return;
        }

        this.sendJson(res, 200, handler());
    }

    async handlePost(pathname, guildId, res) {
        const switchMatch = pathname.match(/^\/switches\/([^/]+)\/toggle$/);
        if (switchMatch) {
            await this.toggleSwitch(guildId, decodeURIComponent(switchMatch[1]));
            this.sendJson(res, 200, { ok: true });
            this.broadcastSnapshot(guildId, ['switches', 'switchgroups'], 'immediate_update');
            return;
        }

        const groupMatch = pathname.match(/^\/switchgroups\/([^/]+)\/(on|off)$/);
        if (groupMatch) {
            await this.controlSwitchGroup(guildId, decodeURIComponent(groupMatch[1]), groupMatch[2] === 'on');
            this.sendJson(res, 200, { ok: true });
            this.broadcastSnapshot(guildId, ['switches', 'switchgroups'], 'immediate_update');
            return;
        }

        this.sendJson(res, 404, { error: 'Not found' });
    }

    handleWsMessage(ws, data) {
        let message = null;
        try {
            message = JSON.parse(data.toString());
        }
        catch {
            ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
            return;
        }

        if (!message || message.type !== 'subscribe') return;

        const current = this.wsClients.get(ws) || {};
        const authenticated = current.authenticated || this.isAuthorizedPassword(message.apiPassword);
        if (!authenticated) {
            ws.close(1008, 'Unauthorized');
            return;
        }

        const endpoints = Array.isArray(message.endpoints) && message.endpoints.length > 0
            ? message.endpoints.map(endpoint => `${endpoint}`)
            : DEFAULT_ENDPOINTS;

        const guildId = this.resolveGuildId(message.guildId);
        this.wsClients.set(ws, { authenticated, guildId, endpoints });
        ws.send(JSON.stringify({
            type: 'subscribed',
            guildId,
            endpoints
        }));
        this.sendSnapshotTo(ws, guildId, endpoints, 'immediate_update');
    }

    broadcastSnapshot(guildId, endpoints = DEFAULT_ENDPOINTS, type = 'update') {
        for (const [ws, state] of this.wsClients.entries()) {
            if (ws.readyState !== WebSocket.OPEN || !state.authenticated) continue;
            if (state.guildId !== this.resolveGuildId(guildId)) continue;

            const selected = endpoints.filter(endpoint => state.endpoints.includes(endpoint));
            if (selected.length === 0) continue;
            this.sendSnapshotTo(ws, state.guildId, selected, type);
        }
    }

    sendSnapshotTo(ws, guildId, endpoints, type) {
        const data = this.getSnapshot(guildId, endpoints);
        ws.send(JSON.stringify({
            type,
            guildId,
            data
        }));
    }

    getSnapshot(guildId, endpoints) {
        const data = {};
        for (const endpoint of endpoints) {
            if (endpoint === 'server') data.server = this.getServerData(guildId);
            if (endpoint === 'time') data.time = this.getTimeData(guildId);
            if (endpoint === 'pop') data.pop = this.getPopData(guildId);
            if (endpoint === 'switches') data.switches = this.getSwitchesData(guildId);
            if (endpoint === 'alarms') data.alarms = this.getAlarmsData(guildId);
            if (endpoint === 'switchgroups') data.switchgroups = this.getSwitchGroupsData(guildId);
            if (endpoint === 'trackers') data.trackers = this.getTrackersData(guildId);
        }
        return data;
    }

    getServerData(guildId) {
        const context = this.getContext(guildId);
        if (!context.instance || !context.server) {
            return { activeServer: null, connected: false, error: 'Guild not found or no active server' };
        }

        return {
            activeServer: context.instance.activeServer,
            connected: context.connected,
            server: context.server
        };
    }

    getTimeData(guildId) {
        const { rustplus, connected } = this.getContext(guildId);
        const time = rustplus && rustplus.time;
        if (!time) {
            return {
                connected,
                currentTime: 0,
                currentTimeFormatted: '--:--',
                isDay: false,
                timeTillChange: null,
                sunrise: 0,
                sunriseFormatted: '--:--',
                sunset: 0,
                sunsetFormatted: '--:--',
                dayLengthMinutes: 0,
                timeScale: 0
            };
        }

        return {
            connected,
            currentTime: time.time,
            currentTimeFormatted: Timer.convertDecimalToHoursMinutes(time.time),
            isDay: time.isDay(),
            timeTillChange: time.getTimeTillDayOrNight(),
            sunrise: time.sunrise,
            sunriseFormatted: Timer.convertDecimalToHoursMinutes(time.sunrise),
            sunset: time.sunset,
            sunsetFormatted: Timer.convertDecimalToHoursMinutes(time.sunset),
            dayLengthMinutes: time.dayLengthMinutes,
            timeScale: time.timeScale
        };
    }

    getPopData(guildId) {
        const { rustplus, server, connected } = this.getContext(guildId);
        const info = rustplus && rustplus.info;
        return {
            connected,
            currentPlayers: info ? info.players : 0,
            maxPlayers: info ? info.maxPlayers : 0,
            queuedPlayers: info ? info.queuedPlayers : 0,
            title: info ? info.name : (server ? server.title : '')
        };
    }

    getSwitchesData(guildId) {
        const { instance, server, connected } = this.getContext(guildId);
        const switches = server ? Object.entries(server.switches || {}).map(([id, device]) => ({
            id,
            name: device.name || id,
            active: device.active === true,
            reachable: device.reachable !== false,
            location: device.location || '',
            coordinates: { x: device.x || 0, y: device.y || 0 },
            command: device.command || '',
            autoDayNightOnOff: device.autoDayNightOnOff || 0,
            server: instance ? instance.activeServer : null,
            proximity: device.proximity || 0,
            messageId: device.messageId || null,
            image: device.image || 'smart_switch.png'
        })) : [];

        return { total: switches.length, connected, switches };
    }

    getAlarmsData(guildId) {
        const { instance, server, connected } = this.getContext(guildId);
        const alarms = server ? Object.entries(server.alarms || {}).map(([id, device]) => ({
            id,
            name: device.name || id,
            active: device.active === true,
            reachable: device.reachable !== false,
            message: device.message || '',
            everyone: device.everyone === true,
            lastTrigger: device.lastTrigger || 0,
            location: device.location || '',
            coordinates: { x: device.x || 0, y: device.y || 0 },
            command: device.command || '',
            image: device.image || 'smart_alarm.png',
            server: instance ? instance.activeServer : null
        })) : [];

        return { total: alarms.length, connected, alarms };
    }

    getSwitchGroupsData(guildId) {
        const { server, connected } = this.getContext(guildId);
        const switchGroups = server ? Object.entries(server.switchGroups || {}).map(([id, group]) => ({
            id,
            name: group.name || id,
            command: group.command || '',
            switches: Array.isArray(group.switches) ? group.switches : [],
            image: group.image || 'smart_switch.png',
            messageId: group.messageId || null
        })) : [];

        return { total: switchGroups.length, connected, switchGroups };
    }

    getTrackersData(guildId) {
        const { instance } = this.getContext(guildId);
        const trackers = instance ? Object.entries(instance.trackers || {}).map(([id, tracker]) => {
            const bmInstance = this.client.battlemetricsInstances[tracker.battlemetricsId];
            const players = (tracker.players || []).map(player => {
                const bmPlayer = bmInstance && player.playerId ? bmInstance.players[player.playerId] : null;
                const online = bmPlayer ? bmPlayer.status === true : false;
                const time = online && bmInstance ? bmInstance.getOnlineTime(player.playerId) :
                    bmInstance ? bmInstance.getOfflineTime(player.playerId) : null;

                return {
                    name: player.name || 'Unknown',
                    steamId: player.steamId || '',
                    battlemetricsId: player.playerId || null,
                    status: online ? 'online' : 'offline',
                    time: Array.isArray(time) ? time[1] : null
                };
            });

            return {
                id,
                trackerId: tracker.trackerId || parseInt(id),
                name: tracker.name || 'Tracker',
                serverId: tracker.serverId || null,
                battlemetricsId: tracker.battlemetricsId || null,
                title: tracker.title || '',
                img: tracker.img || null,
                clanTag: tracker.clanTag || '',
                everyone: tracker.everyone === true,
                inGame: tracker.inGame !== false,
                serverStatus: bmInstance ? bmInstance.server_status : 'unknown',
                streamerMode: false,
                messageId: tracker.messageId || null,
                createdAt: tracker.createdAt || 0,
                players
            };
        }) : [];

        return { total: trackers.length, trackers };
    }

    async toggleSwitch(guildId, switchId) {
        const context = this.getContext(guildId);
        const { rustplus } = context;
        if (!rustplus) {
            throw new Error('Rust+ is not connected');
        }

        const instance = this.client.getInstance(context.guildId);
        const server = instance.serverList[rustplus.serverId];
        const device = server && server.switches && server.switches[switchId];
        if (!device) throw new Error(`Switch not found: ${switchId}`);

        const SmartSwitchHandler = require('../handlers/smartSwitchHandler.js');
        await SmartSwitchHandler.smartSwitchCommandTurnOnOff(rustplus, this.client, switchId, !device.active);
    }

    async controlSwitchGroup(guildId, groupId, turnOn) {
        const context = this.getContext(guildId);
        const { rustplus } = context;
        if (!rustplus) {
            throw new Error('Rust+ is not connected');
        }

        const SmartSwitchGroupHandler = require('../handlers/smartSwitchGroupHandler.js');
        await SmartSwitchGroupHandler.TurnOnOffGroup(
            this.client,
            rustplus,
            context.guildId,
            rustplus.serverId,
            groupId,
            turnOn
        );
    }

    getContext(guildId) {
        const resolvedGuildId = this.resolveGuildId(guildId);
        const instance = resolvedGuildId ? this.client.getInstance(resolvedGuildId) : null;
        const activeServer = instance ? instance.activeServer : null;
        const server = instance && activeServer ? instance.serverList[activeServer] : null;
        const rustplus = resolvedGuildId ? this.client.rustplusInstances[resolvedGuildId] : null;

        return {
            guildId: resolvedGuildId,
            instance,
            server,
            rustplus,
            connected: rustplus ? rustplus.isOperational === true : false
        };
    }

    resolveGuildId(guildId) {
        if (guildId && guildId !== 'default') return `${guildId}`;

        const activeGuildId = Object.keys(this.client.instances)
            .find(id => this.client.instances[id] && this.client.instances[id].activeServer !== null);
        if (activeGuildId) return activeGuildId;

        return Object.keys(this.client.instances)[0] || null;
    }

    isAuthorizedRequest(req, query = {}) {
        if (!this.apiPassword) return true;

        const headerKey = req.headers['x-api-key'];
        const authHeader = req.headers.authorization || '';
        return this.isAuthorizedPassword(headerKey) ||
            this.isAuthorizedPassword(query.apiPassword) ||
            authHeader === `Bearer ${this.apiPassword}`;
    }

    isAuthorizedPassword(value) {
        if (!this.apiPassword) return true;
        return typeof value === 'string' && value === this.apiPassword;
    }

    setCommonHeaders(res) {
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    sendJson(res, status, body) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
    }

    log(level, message) {
        if (this.client && typeof this.client.log === 'function') {
            this.client.log('Stream Deck', message, level);
            return;
        }

        console.log(message);
    }
}

module.exports = StreamDeckBridge;
