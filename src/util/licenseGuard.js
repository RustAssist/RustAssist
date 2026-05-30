const LicenseClient = require('./licenseClient.js');

const COMMAND_FEATURES = {
    activity: 'activityHistory',
    offlinepattern: 'activityHistory',
    whois: 'activityHistory',
    players: 'battlemetrics',
    map: 'mapFeatures',
    alarm: 'deviceControls',
    switch: 'deviceControls',
    storagemonitor: 'deviceControls',
    market: 'automation'
};

function isLicenseCommand(interaction) {
    return interaction &&
        interaction.type !== undefined &&
        interaction.commandName === 'license';
}

function getLicenseSubcommand(interaction) {
    try {
        return interaction.options.getSubcommand();
    }
    catch {
        return null;
    }
}

function isActivationAllowedLicenseCommand(interaction) {
    if (!isLicenseCommand(interaction)) return false;
    const subcommand = getLicenseSubcommand(interaction);
    return subcommand === 'activate' || subcommand === 'status';
}

function getMessage(client, guildId, key, fallback) {
    try {
        return client.intlGet(guildId, key);
    }
    catch {
        return fallback;
    }
}

function getFeatureFlags(client, guildId) {
    const instance = client.getInstance(guildId);
    return instance && instance.license && instance.license.featureFlags ?
        instance.license.featureFlags : {};
}

function isFeatureEnabled(client, guildId, feature) {
    if (!feature) return true;

    const flags = getFeatureFlags(client, guildId);
    if (flags.all === true) return true;
    if (flags.hasOwnProperty(feature)) return flags[feature] !== false;
    return true;
}

function getCommandFeature(commandName) {
    return COMMAND_FEATURES[commandName] || null;
}

function evaluate(client, guildId, options = {}) {
    if (!guildId || LicenseClient.isLicenseDisabled()) {
        return { allowed: true };
    }

    if (options.allowActivationCommand) {
        return { allowed: true };
    }

    if (!client.isGuildLicensed(guildId)) {
        return {
            allowed: false,
            reason: 'not_licensed',
            message: getMessage(
                client,
                guildId,
                'licenseCommandBlocked',
                'RustAssist is waiting for license activation. Use /license activate or /license status.'
            )
        };
    }

    const feature = options.feature || null;
    if (!isFeatureEnabled(client, guildId, feature)) {
        return {
            allowed: false,
            reason: 'feature_disabled',
            message: getMessage(
                client,
                guildId,
                'licenseFeatureDisabled',
                'This feature is not enabled for the current license plan.'
            )
        };
    }

    return { allowed: true };
}

async function replyToInteraction(client, interaction, message) {
    try {
        const payload = { content: message, ephemeral: true };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        }
        else {
            await interaction.reply(payload);
        }
    }
    catch (e) {
        if (client && typeof client.log === 'function') {
            client.log('License', `Could not reply to blocked interaction: ${e.message}`, 'warning');
        }
    }
}

async function guardInteraction(client, interaction) {
    const guildId = interaction.guildId;
    const feature = interaction.commandName ? getCommandFeature(interaction.commandName) : null;
    const result = evaluate(client, guildId, {
        allowActivationCommand: isActivationAllowedLicenseCommand(interaction),
        feature
    });

    if (result.allowed) return true;

    await replyToInteraction(client, interaction, result.message);
    return false;
}

async function guardMessage(client, message, options = {}) {
    if (!message || !message.guild) return true;

    const result = evaluate(client, message.guild.id, options);
    if (result.allowed) return true;

    try {
        await message.reply(result.message);
    }
    catch (e) {
        if (client && typeof client.log === 'function') {
            client.log('License', `Could not reply to blocked message: ${e.message}`, 'warning');
        }
    }
    return false;
}

function guardGuildFeature(client, guildId, feature) {
    return evaluate(client, guildId, { feature });
}

module.exports = {
    evaluate,
    guardInteraction,
    guardMessage,
    guardGuildFeature,
    isActivationAllowedLicenseCommand,
    isFeatureEnabled,
    getCommandFeature
};
