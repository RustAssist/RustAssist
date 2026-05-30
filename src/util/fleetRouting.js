const Config = require('../../config');
const LicenseClient = require('./licenseClient.js');
const LicenseMessages = require('./licenseMessages.js');

function buildInviteMessage(client, guildId, action, inviteUrl, fallback) {
    if (action === 'capacity_full') {
        return inviteUrl ?
            `This RustAssist instance is full. Please invite the available instance instead: ${inviteUrl}` :
            'This RustAssist instance is full and no alternative instance is currently available.';
    }

    if (action === 'duplicate' || action === 'wrong_instance') {
        return inviteUrl ?
            `This Discord server is assigned to another RustAssist instance. Please use: ${inviteUrl}` :
            'This Discord server is assigned to another RustAssist instance.';
    }

    return fallback || 'RustAssist cannot join this server right now.';
}

async function prepareGuildFiles(client, guild) {
    require('./CreateInstanceFile')(client, guild);
    require('./CreateCredentialsFile')(client, guild);
    client.fcmListenersLite[guild.id] = client.fcmListenersLite[guild.id] || {};
    client.loadGuildIntl(guild.id);
}

async function handleGuildCreate(client, guild) {
    const response = await LicenseClient.guildJoin(guild, client.getActiveLicensedGuildCount());

    if (!response.ok) {
        await LicenseMessages.leaveGuildWithMessage(
            client,
            guild,
            'RustAssist license service is temporarily unavailable. Please try inviting the bot again later.',
            'license-api-unavailable'
        );
        return;
    }

    if (['duplicate', 'wrong_instance', 'capacity_full', 'no_capacity'].includes(response.action)) {
        await LicenseMessages.leaveGuildWithMessage(
            client,
            guild,
            response.message || buildInviteMessage(client, guild.id, response.action, response.inviteUrl),
            `fleet-${response.action}`
        );
        return;
    }

    await prepareGuildFiles(client, guild);

    if (response.license) {
        if (response.license.assignedBotInstanceId &&
                response.license.assignedBotInstanceId !== Config.fleet.instanceId) {
            await LicenseMessages.leaveGuildWithMessage(
                client,
                guild,
                response.message || buildInviteMessage(client, guild.id, 'wrong_instance', response.inviteUrl),
                'fleet-wrong-instance'
            );
            return;
        }

        client.applyLicenseState(guild.id, response.license);
    }

    if (client.isGuildLicensed(guild.id)) {
        await client.startLicensedGuildWork(guild);
        return;
    }

    await client.enterActivationOnlyMode(guild, {
        message: Config.fleet.inviteUrl ?
            `RustAssist is installed. Activate a license with /license activate. This activation window will expire soon.` :
            'RustAssist is installed. Activate a license with /license activate. This activation window will expire soon.'
    });
}

module.exports = {
    handleGuildCreate,
    prepareGuildFiles,
    buildInviteMessage
};
