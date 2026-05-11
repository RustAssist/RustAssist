/*
    Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)

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

const { AttachmentBuilder } = require('discord.js');
const Builder = require('@discordjs/builders');
const { DateTime } = require('luxon');

const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const PlayerActivityDB = require('../util/database.js');
const { analyzeEvents, renderHourlyBarChart, renderHeatmap } = require('../util/activityAnalysis.js');

const DEFAULT_DAYS = 90;
const DEFAULT_TZ = 'America/New_York';

module.exports = {
    name: 'activity',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('activity')
            .setDescription(client.intlGet(guildId, 'commandsActivityDesc'))
            .addSubcommand(sub => sub
                .setName('player')
                .setDescription(client.intlGet(guildId, 'commandsActivityPlayerDesc'))
                .addStringOption(opt => opt
                    .setName('name')
                    .setDescription(client.intlGet(guildId, 'theNameOfThePlayer'))
                    .setRequired(true))
                .addBooleanOption(opt => opt
                    .setName('like')
                    .setDescription(client.intlGet(guildId, 'commandsWhoisLikeDesc'))
                    .setRequired(false))
                .addIntegerOption(opt => opt
                    .setName('days')
                    .setDescription(client.intlGet(guildId, 'commandsActivityDaysDesc'))
                    .setMinValue(1)
                    .setMaxValue(365)
                    .setRequired(false))
                .addStringOption(opt => opt
                    .setName('timezone')
                    .setDescription(client.intlGet(guildId, 'commandsActivityTimezoneDesc'))
                    .setRequired(false)))
            .addSubcommand(sub => sub
                .setName('playerid')
                .setDescription(client.intlGet(guildId, 'commandsActivityPlayerIdDesc'))
                .addStringOption(opt => opt
                    .setName('playerid')
                    .setDescription(client.intlGet(guildId, 'commandsPlayersPlayerIdPlayerIdDesc'))
                    .setRequired(true))
                .addIntegerOption(opt => opt
                    .setName('days')
                    .setDescription(client.intlGet(guildId, 'commandsActivityDaysDesc'))
                    .setMinValue(1)
                    .setMaxValue(365)
                    .setRequired(false))
                .addStringOption(opt => opt
                    .setName('timezone')
                    .setDescription(client.intlGet(guildId, 'commandsActivityTimezoneDesc'))
                    .setRequired(false)));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        switch (interaction.options.getSubcommand()) {
            case 'player':   await activityNameHandler(client, interaction);   break;
            case 'playerid': await activityPlayerIdHandler(client, interaction); break;
            default: break;
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `${interaction.options.getSubcommand()} ` +
                `${interaction.options.getString('name')} ` +
                `${interaction.options.getString('playerid')} ` +
                `${interaction.options.getInteger('days')} ` +
                `${interaction.options.getString('timezone')}`
        }));
    }
};

async function activityNameHandler(client, interaction) {
    const guildId = interaction.guildId;
    const name = interaction.options.getString('name');
    const like = interaction.options.getBoolean('like') ?? false;
    const players = PlayerActivityDB.searchPlayersByName(name, guildId, like);

    if (players.length === 0) {
        const str = client.intlGet(guildId, 'couldNotFindAnyPlayers');
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
        return;
    }
    if (players.length === 1) {
        await displayActivity(client, interaction, players[0].bm_id, players[0].name);
    } else {
        await displayMultiplePlayerMatches(client, interaction, players, name);
    }
}

async function activityPlayerIdHandler(client, interaction) {
    const guildId = interaction.guildId;
    const bmId = interaction.options.getString('playerid');
    const player = PlayerActivityDB.getPlayerByBmId(bmId, guildId);

    if (!player) {
        const str = client.intlGet(guildId, 'couldNotFindPlayerId', { id: bmId });
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
        return;
    }

    await displayActivity(client, interaction, player.bm_id, player.name);
}

async function displayActivity(client, interaction, bmId, playerName) {
    const guildId = interaction.guildId;

    const days = interaction.options.getInteger('days') ?? DEFAULT_DAYS;
    const tzInput = interaction.options.getString('timezone') ?? DEFAULT_TZ;

    const timezone = DateTime.now().setZone(tzInput).isValid ? tzInput : DEFAULT_TZ;
    if (timezone !== tzInput) {
        client.log(client.intlGet(null, 'warningCap'),
            `Invalid timezone '${tzInput}', falling back to UTC`);
    }

    const cutoffMs = DateTime.now().setZone(timezone).minus({ days }).toMillis();
    const events = PlayerActivityDB.getAllPlayerEventsAllServers(bmId, guildId, cutoffMs);
    const result = analyzeEvents(events, days, timezone);

    if (!result) {
        const str = client.intlGet(guildId, 'noActivityData');
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
        return;
    }

    const { hourMinutes, heat, totalMinutes, top3, best2hStart, best2hTotal } = result;

    const [h1, h2, h3] = top3;
    const fmt = h => `${String(h).padStart(2, '0')}:00-${String(h + 1).padStart(2, '0')}:00`;
    const totalHours = (totalMinutes / 60).toFixed(1);

    const summaryLines = [
        `**${client.intlGet(guildId, 'activityTop3Hours')}**`,
        `1. ${fmt(h1)} — ${hourMinutes[h1].toFixed(0)} min`,
        `2. ${fmt(h2)} — ${hourMinutes[h2].toFixed(0)} min`,
        `3. ${fmt(h3)} — ${hourMinutes[h3].toFixed(0)} min`,
        `**${client.intlGet(guildId, 'activityBest2h')}:** ` +
            `${String(best2hStart).padStart(2, '0')}:00–${String(best2hStart + 2).padStart(2, '0')}:00` +
            ` (${best2hTotal.toFixed(0)} min)`,
        `**${client.intlGet(guildId, 'activityTotalOnline')}:** ${totalHours} hrs over last ${days} days`
    ].join('\n');

    // Check live BM instances for current online status (optional enrichment)
    let isOnline = false;
    for (const bmInst of Object.values(client.battlemetricsInstances)) {
        if (bmInst.players && bmInst.players.hasOwnProperty(bmId)) {
            isOnline = bmInst.players[bmId].status;
            break;
        }
    }

    const profileLink = `[${bmId}](${Constants.BATTLEMETRICS_PROFILE_URL}${bmId})`;

    const embed = DiscordEmbeds.getEmbed({
        title: client.intlGet(guildId, 'activityTitle', { name: playerName }),
        color: Constants.COLOR_DEFAULT,
        description: [
            `__**${client.intlGet(guildId, 'profile')}:**__ ${profileLink}`,
            `__**${client.intlGet(guildId, 'status')}:**__ ${isOnline ? Constants.ONLINE_EMOJI : Constants.OFFLINE_EMOJI}`,
            `__**${client.intlGet(guildId, 'activityWindow')}:**__ Last ${days} days (${timezone})`,
            '',
            summaryLines
        ].join('\n')
    });

    let barBuf, heatBuf;
    try {
        [barBuf, heatBuf] = await Promise.all([
            renderHourlyBarChart(hourMinutes, playerName, days, timezone),
            renderHeatmap(heat, playerName, days, timezone)
        ]);
    } catch (err) {
        client.log(client.intlGet(null, 'errorCap'), `Activity chart render error: ${err.message}`);
        await client.interactionEditReply(interaction, { embeds: [embed] });
        return;
    }

    const barAttachment = new AttachmentBuilder(barBuf, { name: 'hourly.png' });
    const heatAttachment = new AttachmentBuilder(heatBuf, { name: 'heatmap.png' });

    await client.interactionEditReply(interaction, {
        embeds: [embed],
        files: [barAttachment, heatAttachment]
    });

    client.log(client.intlGet(guildId, 'infoCap'),
        client.intlGet(guildId, 'displayingPlayerSearchResults'));
}

async function displayMultiplePlayerMatches(client, interaction, players, search) {
    const guildId = interaction.guildId;
    const title = `${client.intlGet(guildId, 'playersSearch')}: ${search}`;

    let totalCharacters = title.length;
    let fieldCharacters = 0;
    totalCharacters += client.intlGet(guildId, 'andMorePlayers', { number: 100 }).length;
    totalCharacters += client.intlGet(guildId, 'players').length;

    const fields = [''];
    let fieldIndex = 0;
    let isEmbedFull = false;
    let playerCounter = 0;

    for (const player of players) {
        playerCounter += 1;
        const nameMaxLength = Constants.EMBED_FIELD_MAX_WIDTH_LENGTH_3 - 4;
        let name = player.name.replace('[', '(').replace(']', ')');
        name = name.length <= nameMaxLength ? name : `${name.substring(0, nameMaxLength - 2)}..`;
        const playerStr = `[${name}](${Constants.BATTLEMETRICS_PROFILE_URL}${player.bm_id})\n`;

        if (totalCharacters + playerStr.length >= Constants.EMBED_MAX_TOTAL_CHARACTERS) {
            isEmbedFull = true;
            break;
        }
        if (fieldCharacters + playerStr.length >= Constants.EMBED_MAX_FIELD_VALUE_CHARACTERS) {
            fieldCharacters = 0;
            fieldIndex += 1;
            fields.push('');
        }
        fields[fieldIndex] += playerStr;
        totalCharacters += playerStr.length;
        fieldCharacters += playerStr.length;
    }

    const embed = DiscordEmbeds.getEmbed({
        title,
        color: Constants.COLOR_DEFAULT,
        description: isEmbedFull
            ? client.intlGet(guildId, 'andMorePlayers', { number: players.length - playerCounter })
            : client.intlGet(guildId, 'multiplePlayersFound')
    });

    let fieldCounter = 0;
    for (const field of fields) {
        embed.addFields({
            name: fieldCounter === 0 ? client.intlGet(guildId, 'players') : '\u200B',
            value: field === '' ? '\u200B' : field,
            inline: true
        });
        fieldCounter += 1;
    }

    await client.interactionEditReply(interaction, { embeds: [embed] });
    client.log(client.intlGet(guildId, 'infoCap'),
        client.intlGet(guildId, 'displayingPlayerSearchResults'));
}
