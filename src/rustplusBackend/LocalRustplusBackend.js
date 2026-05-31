class LocalRustplusBackend {
    constructor(client) {
        this.client = client;
    }

    createRustplusInstance(guildId, serverIp, appPort, steamId, playerToken) {
        return this.client.createLocalRustplusInstance(guildId, serverIp, appPort, steamId, playerToken);
    }
}

module.exports = LocalRustplusBackend;

