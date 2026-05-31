const Axios = require('axios');

class ProxyRustplusBackend {
    constructor(client, proxy) {
        this.client = client;
        this.proxy = proxy;
    }

    createRustplusInstance(guildId, serverIp, appPort, steamId, playerToken) {
        if (!this.proxy?.baseUrl) {
            throw new Error(`Rust+ proxy is not configured for guild ${guildId}`);
        }

        Axios.post(
            `${this.proxy.baseUrl}/guilds/${guildId}/rustplus/connect`,
            { serverIp, appPort, steamId, playerToken },
            {
                timeout: 10000,
                headers: this.proxy.token ? { Authorization: `Bearer ${this.proxy.token}` } : {},
            },
        ).catch((e) => {
            this.client.activeRustplusInstances[guildId] = false;
            this.client.log('Error', `Rust+ proxy connect failed for guild ${guildId}: ${e.message}`, 'error');
        });

        this.client.activeRustplusInstances[guildId] = true;
        return { backend: 'proxy', proxyId: this.proxy.id };
    }
}

module.exports = ProxyRustplusBackend;
