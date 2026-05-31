const Axios = require('axios');

class LicenseApiClient {
    constructor(config) {
        this.baseUrl = config.apiUrl;
        this.token = config.apiToken;
        this.timeoutMs = config.timeoutMs;
    }

    isEnabled() {
        return Boolean(this.baseUrl && this.token);
    }

    getStatusSummary() {
        if (!this.baseUrl) return 'disabled: RPP_LICENSE_API_URL is empty';
        if (!this.token) return 'disabled: RPP_LICENSE_API_TOKEN is empty';
        return `enabled: ${this.baseUrl}`;
    }

    headers() {
        return { Authorization: `Bearer ${this.token}` };
    }

    async validateGuild(guildId) {
        const response = await Axios.post(
            `${this.baseUrl}/bot/guilds/${guildId}/validate`,
            {},
            { headers: this.headers(), timeout: this.timeoutMs },
        );
        return response.data;
    }

    async activateGuild(guildId, key, activatedBy) {
        const response = await Axios.post(
            `${this.baseUrl}/bot/guilds/${guildId}/activate`,
            { key, activatedBy },
            { headers: this.headers(), timeout: this.timeoutMs },
        );
        return response.data;
    }
}

module.exports = LicenseApiClient;
