const Fs = require('fs');
const Path = require('path');

const { FEATURE_FLAGS, LIMITS } = require('./PlanFeatures');

class LicenseCache {
    constructor(rootDir) {
        this.rootDir = rootDir;
        if (!Fs.existsSync(this.rootDir)) {
            Fs.mkdirSync(this.rootDir, { recursive: true });
        }
    }

    getPath(guildId) {
        return Path.join(this.rootDir, `${guildId}.json`);
    }

    defaultState(status = 'activation_only') {
        return {
            status,
            plan: 'free',
            featureFlags: { ...FEATURE_FLAGS },
            limits: { ...LIMITS },
            expiresAt: null,
            assignedRustplusBackend: 'local',
            assignedRustplusProxyId: null,
            proxyUrl: null,
            lastValidatedAt: null,
            lifecycleState: status,
        };
    }

    parseExpiresAt(expiresAt) {
        if (!expiresAt) return null;

        const expiryText = String(expiresAt);
        const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(expiryText);
        const time = Date.parse(hasTimezone ? expiryText : `${expiryText}Z`);
        return Number.isNaN(time) ? null : time;
    }

    applyLocalExpiry(state) {
        const expiresAtMs = this.parseExpiresAt(state.expiresAt);
        if (state.status === 'active' && expiresAtMs !== null && expiresAtMs <= Date.now()) {
            return {
                ...state,
                status: 'expired',
                lifecycleState: 'expired',
            };
        }
        return state;
    }

    read(guildId) {
        const path = this.getPath(guildId);
        if (!Fs.existsSync(path)) return this.defaultState();

        try {
            return this.applyLocalExpiry({
                ...this.defaultState(),
                ...JSON.parse(Fs.readFileSync(path, 'utf8')),
            });
        }
        catch (e) {
            return this.defaultState();
        }
    }

    write(guildId, state) {
        const path = this.getPath(guildId);
        const tempPath = `${path}.tmp`;
        Fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
        Fs.renameSync(tempPath, path);
        return state;
    }

    saveApiState(guildId, state) {
        return this.write(guildId, this.applyLocalExpiry({
            ...this.defaultState(state.status),
            ...state,
            lastValidatedAt: new Date().toISOString(),
            lifecycleState: state.status,
        }));
    }

    isActive(guildId) {
        return this.read(guildId).status === 'active';
    }

    hasFeature(guildId, feature) {
        if (!feature) return true;
        const state = this.read(guildId);
        if (state.status !== 'active') return false;
        return state.featureFlags?.[feature] === true;
    }
}

module.exports = LicenseCache;
