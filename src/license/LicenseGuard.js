const DiscordEmbeds = require('../discordTools/discordEmbeds');
const { COMMAND_FEATURES } = require('./PlanFeatures');

class LicenseGuard {
    constructor(client) {
        this.client = client;
    }

    isEnabled() {
        return this.client.licenseApiClient?.isEnabled() === true;
    }

    isLicenseCommand(interaction) {
        return interaction?.commandName === 'license';
    }

    hasFeature(guildId, feature) {
        if (!this.isEnabled()) return true;
        return this.client.licenseCache.hasFeature(guildId, feature);
    }

    isStateActive(state) {
        if (state.status !== 'active') return false;
        if (!state.expiresAt) return true;

        const expiresText = `${state.expiresAt}`;
        const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(expiresText);
        const expiresAt = Date.parse(hasTimezone ? expiresText : `${expiresText}Z`);
        return Number.isNaN(expiresAt) || expiresAt > Date.now();
    }

    canRunGuildServices(guildId, feature = null) {
        if (!this.isEnabled()) return true;
        const state = this.client.licenseCache.read(guildId);
        if (!this.isStateActive(state)) return false;
        if (!feature) return true;
        return state.featureFlags?.[feature] === true;
    }

    async replyBlocked(interaction, message) {
        const content = DiscordEmbeds.getActionInfoEmbed(1, message);
        if (interaction.deferred || interaction.replied) {
            await this.client.interactionEditReply(interaction, content);
        }
        else {
            await this.client.interactionReply(interaction, { ...content, ephemeral: true });
        }
    }

    async allowInteraction(interaction) {
        if (!this.isEnabled()) return true;
        if (!interaction.guildId) return true;
        if (this.isLicenseCommand(interaction)) return true;

        const state = this.client.licenseCache.read(interaction.guildId);
        if (!this.isStateActive(state)) {
            await this.replyBlocked(
                interaction,
                'License required. Use `/license activate` or `/license status`.',
            );
            return false;
        }

        const feature = COMMAND_FEATURES[interaction.commandName];
        if (feature && state.featureFlags?.[feature] !== true) {
            await this.replyBlocked(interaction, `Plan does not include feature: ${feature}`);
            return false;
        }

        return true;
    }
}

module.exports = LicenseGuard;
