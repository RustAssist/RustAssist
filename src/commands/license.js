const Builder = require('@discordjs/builders');

const DiscordEmbeds = require('../discordTools/discordEmbeds');

function formatLicensePlan(plan) {
    if (!plan) return 'Unknown';
    return `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}

function formatLicenseStatus(status) {
    if (!status) return 'Unknown';
    return `${status.charAt(0).toUpperCase()}${status.slice(1).replace(/_/g, ' ')}`;
}

function formatLicenseExpiry(expiresAt) {
    if (!expiresAt) return 'Never expires';

    const time = Date.parse(expiresAt);
    if (Number.isNaN(time)) return expiresAt;

    const seconds = Math.floor(time / 1000);
    return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

module.exports = {
    name: 'license',

    getData() {
        return new Builder.SlashCommandBuilder()
            .setName('license')
            .setDescription('Manage this guild license')
            .addSubcommand(subcommand => subcommand
                .setName('activate')
                .setDescription('Activate a license key')
                .addStringOption(option => option
                    .setName('key')
                    .setDescription('License key')
                    .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('status')
                .setDescription('Show current license status'));
    },

    async execute(client, interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });

        if (!client.licenseApiClient.isEnabled()) {
            await client.interactionEditReply(
                interaction,
                DiscordEmbeds.getActionInfoEmbed(0, 'License API disabled. Bot is running in legacy local mode.'),
            );
            return;
        }

        if (subcommand === 'activate') {
            const key = interaction.options.getString('key');
            try {
                const state = await client.licenseLifecycle.activateGuild(
                    interaction.guild,
                    key,
                    interaction.user.id,
                );
                await client.interactionEditReply(
                    interaction,
                    DiscordEmbeds.getActionInfoEmbed(
                        0,
                        [
                            'License activated successfully.',
                            '',
                            `Plan: ${formatLicensePlan(state.plan)}`,
                            `Expires: ${formatLicenseExpiry(state.expiresAt)}`,
                            '',
                            'You can now use all bot features.',
                        ].join('\n'),
                        null,
                        true,
                        false,
                    ),
                );
            }
            catch (e) {
                const message = e?.response?.data?.detail || e.message || 'Activation failed';
                await client.interactionEditReply(
                    interaction,
                    DiscordEmbeds.getActionInfoEmbed(1, `Activation failed: ${message}`),
                );
            }
            return;
        }

        const state = await client.licenseLifecycle.validateGuild(interaction.guildId);
        await client.interactionEditReply(
            interaction,
            DiscordEmbeds.getActionInfoEmbed(
                0,
                [
                    `License status: ${formatLicenseStatus(state.status)}`,
                    `Plan: ${formatLicensePlan(state.plan)}`,
                    `Expires: ${formatLicenseExpiry(state.expiresAt)}`,
                ].join('\n'),
                null,
                true,
                false,
            ),
        );
    },
};
