const LocalRustplusBackend = require('./LocalRustplusBackend');
const ProxyRustplusBackend = require('./ProxyRustplusBackend');
const RustplusProxyConfig = require('./RustplusProxyConfig');

class RustplusBackendManager {
    constructor(client) {
        this.client = client;
        this.localBackend = new LocalRustplusBackend(client);
    }

    selectProxy(guildId) {
        const config = RustplusProxyConfig.getConfig();
        const state = this.client.licenseCache.read(guildId);
        const assignedProxyId = state.assignedRustplusProxyId || config.defaultProxyId;
        if (!assignedProxyId) return null;
        return config.proxies[assignedProxyId] || (
            state.proxyUrl ? { id: assignedProxyId, baseUrl: state.proxyUrl, enabled: true } : null
        );
    }

    createRustplusInstance(guildId, serverIp, appPort, steamId, playerToken) {
        const config = RustplusProxyConfig.getConfig();
        const state = this.client.licenseCache.read(guildId);
        const mode = state.assignedRustplusBackend === 'proxy' ? 'api-assigned' : config.mode;

        if (mode === 'local') {
            return this.localBackend.createRustplusInstance(guildId, serverIp, appPort, steamId, playerToken);
        }

        const proxy = this.selectProxy(guildId);
        if (proxy?.enabled !== false) {
            const backend = new ProxyRustplusBackend(this.client, proxy);
            return backend.createRustplusInstance(guildId, serverIp, appPort, steamId, playerToken);
        }

        if (config.allowLocalFallback) {
            return this.localBackend.createRustplusInstance(guildId, serverIp, appPort, steamId, playerToken);
        }

        throw new Error(`No Rust+ proxy available for guild ${guildId}`);
    }
}

module.exports = RustplusBackendManager;

