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

    read(guildId) {
        const path = this.getPath(guildId);
        if (!Fs.existsSync(path)) return this.defaultState();

        try {
            return { ...this.defaultState(), ...JSON.parse(Fs.readFileSync(path, 'utf8')) };
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
        return this.write(guildId, {
            ...this.defaultState(state.status),
            ...state,
            lastValidatedAt: new Date().toISOString(),
            lifecycleState: state.status,
        });
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

