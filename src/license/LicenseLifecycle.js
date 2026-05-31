const Config = require('../../config');
const Discord = require('discord.js');
const DiscordMessages = require('../discordTools/discordMessages');

class LicenseLifecycle {
    constructor(client) {
        this.client = client;
        this.leaveTimers = {};
        this.expiryTimers = {};
        this.lastApiErrorLogAt = {};
        this.loggedApiConnected = false;
    }

    isEnabled() {
        return this.client.licenseApiClient?.isEnabled() === true;
    }

    async validateGuild(guildId) {
        if (!this.isEnabled()) {
            this.client.log('Info', 'License API disabled. Running in legacy local mode.');
            return this.client.licenseCache.defaultState('active');
        }

        try {
            const state = await this.client.licenseApiClient.validateGuild(guildId);
            if (!this.loggedApiConnected) {
                this.client.log('Info', `License API reachable: ${Config.license.apiUrl}`);
                this.loggedApiConnected = true;
            }
            this.client.log(
                'Info',
                `License validate OK for guild ${guildId}: status=${state.status}, plan=${state.plan}`,
            );
            const savedState = this.client.licenseCache.saveApiState(guildId, state);
            this.scheduleLicenseExpiry(guildId);
            return savedState;
        }
        catch (e) {
            const message = e?.response?.data?.detail || e.message || e;
            const cached = this.client.licenseCache.read(guildId);
            const lastValidatedAt = cached.lastValidatedAt ? new Date(cached.lastValidatedAt).getTime() : 0;
            const inGrace = cached.status === 'active' &&
                Date.now() - lastValidatedAt <= Config.license.graceMs;
            if (inGrace) {
                this.logApiError(
                    guildId,
                    `License API unavailable for guild ${guildId}: ${message}. ` +
                    `Using cached active license during grace period.`,
                );
                cached.lifecycleState = 'expired_grace';
                return this.client.licenseCache.write(guildId, cached);
            }
            this.logApiError(
                guildId,
                `License API unavailable for guild ${guildId}: ${message}. ` +
                'No valid cache/grace; guild stays activation-only/expired.',
            );
            cached.status = cached.status === 'active' ? 'expired' : cached.status;
            cached.lifecycleState = cached.status;
            return this.client.licenseCache.write(guildId, cached);
        }
    }

    async prepareGuild(guild) {
        if (!this.isEnabled()) {
            this.client.log('Info', 'License API disabled. Creating full guild setup in legacy mode.');
            this.createGuildFiles(guild);
            this.client.loadGuildIntl(guild.id);
            await this.client.setupGuild(guild);
            this.scheduleLicenseExpiry(guild.id);
            return;
        }

        await require('../discordTools/RegisterSlashCommands')(this.client, guild);
        const state = await this.validateGuild(guild.id);
        if (state.status === 'active') {
            this.client.log(
                'Info',
                `Guild ${guild.id} has active license (${state.plan}). Starting full services.`,
            );
            this.createGuildFiles(guild);
            this.client.loadGuildIntl(guild.id);
            await this.client.setupGuild(guild);
            return;
        }

        await this.stopGuildServices(guild.id);
        this.client.log(
            'Warning',
            `Guild ${guild.id} is ${state.status}. Activation-only mode enabled; heavy services stopped.`,
            'warning',
        );
        await this.sendActivationOnlyNotice(guild, state);
        this.scheduleUnlicensedLeave(guild);
    }

    createGuildFiles(guild) {
        require('../util/CreateInstanceFile')(this.client, guild);
        require('../util/CreateCredentialsFile')(this.client, guild);
        if (!this.client.fcmListenersLite[guild.id]) {
            this.client.fcmListenersLite[guild.id] = new Object();
        }
    }

    async activateGuild(guild, rawKey, activatedBy) {
        if (!this.isEnabled()) {
            return this.client.licenseCache.defaultState('active');
        }

        const state = await this.client.licenseApiClient.activateGuild(guild.id, rawKey, activatedBy);
        const savedState = this.client.licenseCache.saveApiState(guild.id, state);
        if (savedState.status === 'active') {
            this.client.log(
                'Info',
                `License activated for guild ${guild.id}: plan=${savedState.plan}, expires=${savedState.expiresAt}`,
            );
            this.createGuildFiles(guild);
            this.client.loadGuildIntl(guild.id);
            await this.client.setupGuild(guild);
            this.scheduleLicenseExpiry(guild.id);
        }
        return savedState;
    }

    async stopGuildServices(guildId) {
        const rustplus = this.client.rustplusInstances[guildId];
        if (rustplus) {
            const serverId = rustplus.serverId;
            const instance = this.client.getInstance(guildId);

            if (instance) {
                instance.activeServer = null;
                this.client.setInstance(guildId, instance);
            }

            this.client.resetRustplusVariables(guildId);

            try {
                rustplus.isDeleted = true;
                rustplus.disconnect();
            }
            catch (e) {
                this.client.log('Warning', `Could not gracefully disconnect Rust+ for guild ${guildId}: ${e}`, 'warning');
            }
            delete this.client.rustplusInstances[guildId];

            if (instance?.serverList?.[serverId]) {
                try {
                    await DiscordMessages.sendServerMessage(guildId, serverId, null);
                }
                catch (e) {
                    this.client.log('Warning', `Could not update disconnected server message for guild ${guildId}: ${e}`, 'warning');
                }
            }
        }

        if (this.client.fcmListeners[guildId]) {
            try {
                this.client.fcmListeners[guildId].destroy();
            }
            catch (e) {
                /* Ignore shutdown errors. */
            }
            delete this.client.fcmListeners[guildId];
        }

        if (this.client.fcmListenersLite[guildId]) {
            for (const listener of Object.values(this.client.fcmListenersLite[guildId])) {
                try {
                    listener.destroy();
                }
                catch (e) {
                    /* Ignore shutdown errors. */
                }
            }
            this.client.fcmListenersLite[guildId] = new Object();
        }
    }

    scheduleLicenseExpiry(guildId) {
        if (!this.isEnabled()) return;

        if (this.expiryTimers[guildId]) {
            clearTimeout(this.expiryTimers[guildId]);
            delete this.expiryTimers[guildId];
        }

        const state = this.client.licenseCache.read(guildId);
        const expiresAtMs = this.client.licenseCache.parseExpiresAt(state.expiresAt);
        if (state.status !== 'active' || expiresAtMs === null) return;

        const delay = expiresAtMs - Date.now();
        if (delay <= 0) {
            this.expireGuildNow(guildId);
            return;
        }

        const maxTimerDelay = 2147483647;
        this.expiryTimers[guildId] = setTimeout(
            () => this.handleLicenseExpiryTimer(guildId),
            Math.min(delay, maxTimerDelay),
        );
    }

    async handleLicenseExpiryTimer(guildId) {
        delete this.expiryTimers[guildId];

        const state = this.client.licenseCache.read(guildId);
        if (state.status === 'active') {
            this.scheduleLicenseExpiry(guildId);
            return;
        }

        await this.expireGuildNow(guildId);
    }

    async expireGuildNow(guildId) {
        const state = this.client.licenseCache.read(guildId);
        if (state.status === 'active') return;

        if (state.status === 'expired') {
            this.client.licenseCache.write(guildId, {
                ...state,
                status: 'expired',
                lifecycleState: 'expired',
            });
        }
        await this.stopGuildServices(guildId);
        this.client.log(
            'Warning',
            `Guild ${guildId} license is ${state.status}. Rust+ services stopped.`,
            'warning',
        );
    }

    scheduleUnlicensedLeave(guild) {
        const delay = Config.license.unlicensedLeaveDelayMs;
        if (!delay || delay < 1 || this.leaveTimers[guild.id]) return;

        this.client.log(
            'Warning',
            `Guild ${guild.id} scheduled to leave in ${this.formatDelay(delay)} unless activated.`,
            'warning',
        );

        this.leaveTimers[guild.id] = setTimeout(async () => {
            const state = this.client.licenseCache.read(guild.id);
            if (state.status === 'active') return;
            try {
                this.client.log('Warning', `Leaving unlicensed guild ${guild.id}.`, 'warning');
                await guild.leave();
            }
            catch (e) {
                this.client.log('Warning', `Could not leave unlicensed guild ${guild.id}: ${e}`, 'warning');
            }
        }, delay);
    }

    async sendActivationOnlyNotice(guild, state) {
        if (state.unlicensedNoticeSentAt) return;

        const delayMs = Config.license.unlicensedLeaveDelayMs;
        const leaveText = delayMs > 0
            ? `If this guild is not activated, I will leave in ${this.formatDelay(delayMs)}.`
            : 'Automatic leave is disabled, but all normal bot features are blocked.';
        const text = [
            'RustAssist license required.',
            '',
            'This guild is not activated yet. Only `/license activate` and `/license status` are available.',
            leaveText,
            '',
            'Activate with: `/license activate key:<your-key>`',
        ].join('\n');

        const channel = this.findNoticeChannel(guild);
        if (!channel) {
            this.client.log(
                'Warning',
                `Could not send license notice in guild ${guild.id}: no writable text channel found.`,
                'warning',
            );
            return;
        }

        try {
            await channel.send(text);
            this.client.log(
                'Info',
                `License activation notice sent in guild ${guild.id} channel ${channel.id}.`,
            );
            state.unlicensedNoticeSentAt = new Date().toISOString();
            this.client.licenseCache.write(guild.id, state);
        }
        catch (e) {
            this.client.log('Warning', `Could not send license notice in guild ${guild.id}: ${e}`, 'warning');
        }
    }

    findNoticeChannel(guild) {
        if (guild.systemChannel && this.canSend(guild.systemChannel)) {
            return guild.systemChannel;
        }

        return guild.channels.cache.find(channel =>
            channel.type === Discord.ChannelType.GuildText && this.canSend(channel));
    }

    canSend(channel) {
        const permissions = channel.permissionsFor(channel.guild.members.me);
        return permissions?.has(Discord.PermissionFlagsBits.SendMessages) === true;
    }

    formatDelay(delayMs) {
        const minutes = Math.round(delayMs / 60000);
        if (minutes < 60) return `${minutes} minutes`;

        const hours = Math.round(minutes / 60);
        return `${hours} hours`;
    }

    logApiError(guildId, message) {
        const now = Date.now();
        const last = this.lastApiErrorLogAt[guildId] || 0;
        if (now - last < 60000) return;

        this.lastApiErrorLogAt[guildId] = now;
        this.client.log('Error', message, 'error');
    }
}

module.exports = LicenseLifecycle;
