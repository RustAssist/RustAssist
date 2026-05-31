const Config = require('../../config');

function parseProxyList(raw) {
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        return Object.fromEntries(parsed.map((proxy) => [proxy.id, proxy]));
    }
    catch (e) {
        const proxies = {};
        raw.split(',').forEach((entry) => {
            const [id, baseUrl, token = ''] = entry.split('|').map((value) => value.trim());
            if (!id || !baseUrl) return;
            proxies[id] = { id, baseUrl, token, enabled: true };
        });
        return proxies;
    }
}

module.exports = {
    getConfig() {
        const proxies = parseProxyList(Config.rustplusBackend.proxies);
        if (Config.rustplusBackend.proxyUrl && Config.rustplusBackend.defaultProxyId) {
            proxies[Config.rustplusBackend.defaultProxyId] = {
                id: Config.rustplusBackend.defaultProxyId,
                baseUrl: Config.rustplusBackend.proxyUrl,
                enabled: true,
            };
        }

        return {
            mode: Config.rustplusBackend.mode,
            proxies,
            defaultProxyId: Config.rustplusBackend.defaultProxyId,
            allowLocalFallback: Config.rustplusBackend.allowLocalFallback,
        };
    },
};

