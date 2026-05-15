/*
    Copyright (C) 2024 rustplusplus contributors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

const Builder = require('@discordjs/builders');

const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const RaidableDB = require('../util/raidableDatabase.js');
const Timer = require('../util/timer.js');

module.exports = {
    name: 'raidable',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('raidable')
            .setDescription(client.intlGet(guildId, 'commandsRaidableDesc'))
            .addSubcommand(sub => sub
                .setName('history')
                .setDescription(client.intlGet(guildId, 'commandsRaidableHistoryDesc'))
                .addStringOption(opt => opt
                    .setName('difficulty')
                    .setDescription(client.intlGet(guildId, 'commandsRaidableDifficultyDesc'))
                    .setRequired(false)
                    .addChoices(
                        { name: 'Easy', value: 'easy' },
                        { name: 'Medium', value: 'medium' },
                        { name: 'Hard', value: 'hard' },
                        { name: 'Expert', value: 'expert' },
                        { name: 'Nightmare', value: 'nightmare' }
                    )))
            .addSubcommand(sub => sub
                .setName('active')
                .setDescription(client.intlGet(guildId, 'commandsRaidableActiveDesc'))
                .addStringOption(opt => opt
                    .setName('difficulty')
                    .setDescription(client.intlGet(guildId, 'commandsRaidableDifficultyDesc'))
                    .setRequired(false)
                    .addChoices(
                        { name: 'Easy', value: 'easy' },
                        { name: 'Medium', value: 'medium' },
                        { name: 'Hard', value: 'hard' },
                        { name: 'Expert', value: 'expert' },
                        { name: 'Nightmare', value: 'nightmare' }
                    )))
            .addSubcommand(sub => sub
                .setName('stats')
                .setDescription(client.intlGet(guildId, 'commandsRaidableStatsDesc')));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const rustplus = client.rustplusInstances[interaction.guildId];
        if (!rustplus || !rustplus.isOperational) {
            const str = client.intlGet(interaction.guildId, 'notConnectedToRustServer');
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            return;
        }

        const serverId = rustplus.serverId;
        const guildId = interaction.guildId;

        switch (interaction.options.getSubcommand()) {
            case 'history': {
                const difficulty = interaction.options.getString('difficulty');
                let events;
                if (difficulty) {
                    events = RaidableDB.getEventsByDifficulty(serverId, guildId, difficulty, 15);
                } else {
                    events = RaidableDB.getRecentEvents(serverId, guildId, 15);
                }

                if (!events || events.length === 0) {
                    const str = client.intlGet(interaction.guildId, 'noData');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str));
                    return;
                }

                const lines = events.map(e => {
                    const seconds = (Date.now() - e.timestamp) / 1000;
                    const time = Timer.secondsToFullScale(seconds);
                    const diffLabel = e.difficulty ? e.difficulty.charAt(0).toUpperCase() + e.difficulty.slice(1) : '?';
                    const modeLabel = e.mode ? `[${e.mode}] ` : '';
                    return `\`${time} ago\` ${modeLabel}**${diffLabel}** @ ${e.grid} - *${e.event_type}*`;
                });

                const embed = DiscordEmbeds.getEmbed({
                    color: Constants.COLOR_RAIDABLE_BASE_DETECTED,
                    title: `Raidable Base History${difficulty ? ` (${difficulty})` : ''}`,
                    description: lines.join('\n'),
                    timestamp: true
                });

                await client.interactionEditReply(interaction, { embeds: [embed] });
            } break;

            case 'active': {
                const difficulty = interaction.options.getString('difficulty');
                const active = RaidableDB.getActive(serverId, guildId, difficulty);

                if (!active || active.length === 0) {
                    const str = difficulty
                        ? `No active ${difficulty} Raidable Bases.`
                        : 'No active Raidable Bases.';
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str));
                    return;
                }

                const lines = active.map(e => {
                    const seconds = (Date.now() - e.timestamp) / 1000;
                    const time = Timer.secondsToFullScale(seconds);
                    const diffLabel = e.difficulty ? e.difficulty.charAt(0).toUpperCase() + e.difficulty.slice(1) : '?';
                    const modeLabel = e.mode ? `[${e.mode}] ` : '';
                    const lootLabel = e.loot_count ? ` (Loot: ${e.loot_count})` : '';
                    return `${modeLabel}**${diffLabel}**${lootLabel} @ ${e.grid} - *${time} ago*`;
                });

                const embed = DiscordEmbeds.getEmbed({
                    color: Constants.COLOR_RAIDABLE_BASE_DETECTED,
                    title: `Active Raidable Bases${difficulty ? ` (${difficulty})` : ''}`,
                    description: lines.join('\n'),
                    timestamp: true
                });

                await client.interactionEditReply(interaction, { embeds: [embed] });
            } break;

            case 'stats': {
                const stats = RaidableDB.getStats(serverId, guildId);

                if (!stats || stats.length === 0) {
                    const str = 'No Raidable Base data in the last 24 hours.';
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str));
                    return;
                }

                const lines = [];
                const grouped = {};
                for (const row of stats) {
                    if (!grouped[row.difficulty]) grouped[row.difficulty] = {};
                    grouped[row.difficulty][row.event_type] = row.count;
                }

                for (const [diff, events] of Object.entries(grouped)) {
                    const diffLabel = diff ? diff.charAt(0).toUpperCase() + diff.slice(1) : 'Unknown';
                    const spawned = events['spawn'] || 0;
                    const claimed = events['claimed'] || 0;
                    const despawned = events['despawned'] || 0;
                    lines.push(`**${diffLabel}**: ${spawned} spawned, ${claimed} claimed, ${despawned} despawned`);
                }

                const embed = DiscordEmbeds.getEmbed({
                    color: Constants.COLOR_RAIDABLE_BASE_DETECTED,
                    title: 'Raidable Base Stats (Last 24h)',
                    description: lines.join('\n'),
                    timestamp: true
                });

                await client.interactionEditReply(interaction, { embeds: [embed] });
            } break;

            default: break;
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `${interaction.options.getSubcommand()}`
        }));
    },
};
