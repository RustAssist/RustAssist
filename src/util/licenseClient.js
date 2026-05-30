const Axios = require('axios');

const Config = require('../../config');

function isLicenseDisabled() {
    return !Config.license.required || Config.license.bypass;
}

function buildLocalLicense(overrides = {}) {
    const now = Date.now();
    return {
        status: 'active',
        licenseId: overrides.licenseId || 'local-dev',
        assignedBotInstanceId: Config.fleet.instanceId,
        plan: overrides.plan || 'local',
        featureFlags: overrides.featureFlags || { all: true },
        limits: overrides.limits || {},
        expiresAt: overrides.expiresAt || null,
        lastValidatedAt: now,
        validationGraceExpiresAt: now + Config.license.validationGraceMs
    };
}

function isCachedLicenseUsable(license) {
    if (!license) return false;
    if (!['active', 'licensed'].includes(license.status)) return false;
    if (license.assignedBotInstanceId && license.assignedBotInstanceId !== Config.fleet.instanceId) return false;
    if (license.expiresAt && Date.parse(license.expiresAt) <= Date.now()) return false;
    return license.validationGraceExpiresAt && license.validationGraceExpiresAt > Date.now();
}

class LicenseClient {
    constructor() {
        this.apiUrl = (Config.license.apiUrl || '').replace(/\/+$/, '');
    }

    isConfigured() {
        return this.apiUrl !== '' && Config.fleet.instanceToken !== '';
    }

    async request(method, path, data = null) {
        if (!this.isConfigured()) {
            return { ok: false, reason: 'api_unavailable', temporary: true };
        }

        try {
            const response = await Axios.request({
                method,
                url: `${this.apiUrl}${path}`,
                data,
                timeout: 10000,
                headers: {
                    Authorization: `Bearer ${Config.fleet.instanceToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return { ok: true, data: response.data };
        }
        catch (e) {
            return {
                ok: false,
                reason: e.response && e.response.data && e.response.data.reason ?
                    e.response.data.reason : 'api_unavailable',
                status: e.response ? e.response.status : null,
                temporary: !e.response || e.response.status >= 500,
                data: e.response ? e.response.data : null
            };
        }
    }

    normalizeLicense(data) {
        const source = data && data.license ? data.license : data;
        if (!source || typeof source !== 'object') return null;

        const now = Date.now();
        return {
            status: source.status || 'active',
            licenseId: source.licenseId || source.id || null,
            assignedBotInstanceId: source.assignedBotInstanceId || source.instanceId || Config.fleet.instanceId,
            plan: source.plan || 'default',
            featureFlags: source.featureFlags || {},
            limits: source.limits || {},
            expiresAt: source.expiresAt || null,
            lastValidatedAt: now,
            validationGraceExpiresAt: now + Config.license.validationGraceMs
        };
    }

    async guildJoin(guild, activeGuildCount) {
        if (isLicenseDisabled()) {
            return { action: 'accepted', license: buildLocalLicense() };
        }

        const response = await this.request('POST', '/fleet/guild-join', {
            guildId: guild.id,
            guildName: guild.name,
            botInstanceId: Config.fleet.instanceId,
            activeGuildCount,
            activeGuildLimit: Config.fleet.activeGuildLimit,
            inviteUrl: Config.fleet.inviteUrl
        });

        if (!response.ok) return response;

        const action = response.data.action || response.data.status || 'accepted';
        return {
            ok: true,
            action,
            license: this.normalizeLicense(response.data),
            inviteUrl: response.data.inviteUrl || response.data.correctInviteUrl || null,
            assignedBotInstanceId: response.data.assignedBotInstanceId || null,
            message: response.data.message || null
        };
    }

    async validateGuild(guild, cachedLicense = null) {
        if (isLicenseDisabled()) {
            return { ok: true, action: 'licensed', license: buildLocalLicense(cachedLicense || {}) };
        }

        const response = await this.request(
            'GET',
            `/licenses/guild/${encodeURIComponent(guild.id)}?botInstanceId=${encodeURIComponent(Config.fleet.instanceId)}`
        );

        if (!response.ok) {
            if (response.status === 404) {
                return { ok: true, action: 'unlicensed', license: null };
            }
            if (isCachedLicenseUsable(cachedLicense)) {
                return { ok: true, action: 'licensed_grace', license: cachedLicense, usingGrace: true };
            }
            return response;
        }

        const action = response.data.action || response.data.status || 'licensed';
        return {
            ok: true,
            action,
            license: this.normalizeLicense(response.data),
            inviteUrl: response.data.inviteUrl || response.data.correctInviteUrl || null,
            assignedBotInstanceId: response.data.assignedBotInstanceId || null,
            message: response.data.message || null
        };
    }

    async activateLicense(guild, key) {
        if (isLicenseDisabled()) {
            return { ok: true, action: 'licensed', license: buildLocalLicense({ licenseId: 'local-dev' }) };
        }

        const response = await this.request('POST', '/licenses/activate', {
            guildId: guild.id,
            guildName: guild.name,
            licenseKey: key,
            botInstanceId: Config.fleet.instanceId,
            activeGuildCount: null,
            activeGuildLimit: Config.fleet.activeGuildLimit,
            inviteUrl: Config.fleet.inviteUrl
        });

        if (!response.ok) return response;

        return {
            ok: true,
            action: response.data.action || response.data.status || 'licensed',
            license: this.normalizeLicense(response.data),
            inviteUrl: response.data.inviteUrl || response.data.correctInviteUrl || null,
            assignedBotInstanceId: response.data.assignedBotInstanceId || null,
            message: response.data.message || null
        };
    }

    async deactivateLicense(guild) {
        if (isLicenseDisabled()) {
            return { ok: true, action: 'deactivated' };
        }

        return await this.request('POST', '/licenses/deactivate', {
            guildId: guild.id,
            botInstanceId: Config.fleet.instanceId
        });
    }

    async heartbeat(activeGuildCount) {
        if (isLicenseDisabled()) return { ok: true };

        return await this.request('POST', '/instances/heartbeat', {
            botInstanceId: Config.fleet.instanceId,
            activeGuildCount,
            activeGuildLimit: Config.fleet.activeGuildLimit,
            inviteUrl: Config.fleet.inviteUrl,
            status: 'active',
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = new LicenseClient();
module.exports.isLicenseDisabled = isLicenseDisabled;
module.exports.isCachedLicenseUsable = isCachedLicenseUsable;
module.exports.buildLocalLicense = buildLocalLicense;
