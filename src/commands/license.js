const Builder = require('@discordjs/builders');

const Config = require('../../config');
const LicenseClient = require('../util/licenseClient.js');

module.exports = {
    name: 'license',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('license')
            .setDescription(client.intlGet(guildId, 'commandsLicenseDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('activate')
                .setDescription(client.intlGet(guildId, 'commandsLicenseActivateDesc'))
                .addStringOption(option => option
                    .setName('key')
                    .setDescription(client.intlGet(guildId, 'commandsLicenseKeyDesc'))
                    .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('status')
                .setDescription(client.intlGet(guildId, 'commandsLicenseStatusDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('deactivate')
                .setDescription(client.intlGet(guildId, 'commandsLicenseDeactivateDesc')));
    },

    async execute(client, interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand !== 'status' && !client.isAdministrator(interaction)) {
            await interaction.reply({ content: client.intlGet(interaction.guildId, 'missingPermission'), ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        if (subcommand === 'activate') {
            await activate(client, interaction);
            return;
        }

        if (subcommand === 'deactivate') {
            await deactivate(client, interaction);
            return;
        }

        await status(client, interaction);
    }
};

async function activate(client, interaction) {
    const key = interaction.options.getString('key');
    const result = await LicenseClient.activateLicense(interaction.guild, key);

    if (!result.ok) {
        if (result.temporary) {
            await client.interactionEditReply(interaction, {
                content: client.intlGet(interaction.guildId, 'licenseApiUnavailable')
            });
            return;
        }

        await client.interactionEditReply(interaction, {
            content: result.data && result.data.message ?
                result.data.message :
                client.intlGet(interaction.guildId, 'licenseActivationRejected', {
                    invite: Config.fleet.inviteUrl || client.intlGet(interaction.guildId, 'unavailable')
                })
        });
        return;
    }

    if (result.license && result.license.assignedBotInstanceId &&
            result.license.assignedBotInstanceId !== Config.fleet.instanceId) {
        const invite = result.inviteUrl || Config.fleet.inviteUrl || client.intlGet(interaction.guildId, 'unavailable');
        await client.interactionEditReply(interaction, {
            content: client.intlGet(interaction.guildId, 'licenseAssignedElsewhere', { invite })
        });
        client.stopGuildWork(interaction.guildId);
        setTimeout(() => interaction.guild.leave().catch(() => {}), 2000);
        return;
    }

    if (['duplicate', 'wrong_instance', 'capacity_full', 'no_capacity'].includes(result.action)) {
        const invite = result.inviteUrl || Config.fleet.inviteUrl || client.intlGet(interaction.guildId, 'unavailable');
        await client.interactionEditReply(interaction, {
            content: result.message || client.intlGet(interaction.guildId, 'licenseActivationRejected', { invite })
        });
        return;
    }

    if (!result.license) {
        await client.interactionEditReply(interaction, {
            content: client.intlGet(interaction.guildId, 'licenseActivationRejected', {
                invite: Config.fleet.inviteUrl || client.intlGet(interaction.guildId, 'unavailable')
            })
        });
        return;
    }

    client.applyLicenseState(interaction.guildId, result.license);
    await client.startLicensedGuildWork(interaction.guild);

    await client.interactionEditReply(interaction, {
        content: client.intlGet(interaction.guildId, 'licenseActivated', {
            plan: result.license.plan || 'default'
        })
    });
}

async function deactivate(client, interaction) {
    const result = await LicenseClient.deactivateLicense(interaction.guild);
    if (!result.ok) {
        await client.interactionEditReply(interaction, {
            content: client.intlGet(interaction.guildId, 'licenseApiUnavailable')
        });
        return;
    }

    client.setGuildUnlicensed(interaction.guildId, 'activation_only');
    await client.enterActivationOnlyMode(interaction.guild, {
        message: client.intlGet(interaction.guildId, 'licenseDeactivated')
    });
    await client.interactionEditReply(interaction, {
        content: client.intlGet(interaction.guildId, 'licenseDeactivated')
    });
}

async function status(client, interaction) {
    const instance = client.getInstance(interaction.guildId);
    const license = instance ? instance.license : null;
    const statusValue = license ? license.status : 'unknown';
    const plan = license ? license.plan : 'unknown';
    const assigned = license ? license.assignedBotInstanceId : null;

    await client.interactionEditReply(interaction, {
        content: client.intlGet(interaction.guildId, 'licenseStatus', {
            status: statusValue,
            plan,
            assigned: assigned || client.intlGet(interaction.guildId, 'none')
        })
    });
}
