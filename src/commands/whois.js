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

const Builder = require('@discordjs/builders');

const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const PlayerActivityDB = require('../util/database.js');

module.exports = {
	name: 'whois',

	getData(client, guildId) {
		return new Builder.SlashCommandBuilder()
			.setName('whois')
			.setDescription(client.intlGet(guildId, 'commandsWhoisDesc'))
			.addSubcommand(subcommand => subcommand
				.setName('player')
				.setDescription(client.intlGet(guildId, 'commandsWhoisPlayerDesc'))
				.addStringOption(option => option
					.setName('name')
					.setDescription(client.intlGet(guildId, 'theNameOfThePlayer'))
					.setRequired(true))
				.addBooleanOption(option => option
					.setName('like')
					.setDescription(client.intlGet(guildId, 'commandsWhoisLikeDesc'))
					.setRequired(false))
				.addStringOption(option => option
					.setName('battlemetricsid')
					.setDescription(client.intlGet(guildId, 'commandsPlayersBattlemetricsIdDesc'))
					.setRequired(false)))
			.addSubcommand(subcommand => subcommand
				.setName('playerid')
				.setDescription(client.intlGet(guildId, 'commandsWhoisPlayerIdDesc'))
				.addStringOption(option => option
					.setName('playerid')
					.setDescription(client.intlGet(guildId, 'commandsPlayersPlayerIdPlayerIdDesc'))
					.setRequired(true))
				.addStringOption(option => option
					.setName('battlemetricsid')
					.setDescription(client.intlGet(guildId, 'commandsPlayersBattlemetricsIdDesc'))
					.setRequired(false)));
	},

	async execute(client, interaction) {
		const verifyId = Math.floor(100000 + Math.random() * 900000);
		client.logInteraction(interaction, verifyId, 'slashCommand');

		if (!await client.validatePermissions(interaction)) return;
		await interaction.deferReply({ ephemeral: true });

		switch (interaction.options.getSubcommand()) {
			case 'player':   await whoisNameHandler(client, interaction);   break;
			case 'playerid': await whoisPlayerIdHandler(client, interaction); break;
			default: break;
		}

		client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
			id: `${verifyId}`,
			value: `${interaction.options.getSubcommand()} ` +
				`${interaction.options.getString('name')} ` +
				`${interaction.options.getString('playerid')}`
		}));
	},
};

async function whoisNameHandler(client, interaction) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name');
	const like = interaction.options.getBoolean('like') ?? false;
	const players = PlayerActivityDB.searchPlayersByName(name, guildId, like);

	if (players.length === 0) {
		const str = client.intlGet(guildId, 'couldNotFindAnyPlayers');
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}
	else if (players.length === 1) {
		await displayWhois(client, interaction, players[0].bm_id, players[0].name);
	}
	else {
		await displayMultiplePlayerMatches(client, interaction, players, name);
	}
}

async function whoisPlayerIdHandler(client, interaction) {
	const guildId = interaction.guildId;
	const bmId = interaction.options.getString('playerid');
	const player = PlayerActivityDB.getPlayerByBmId(bmId, guildId);

	if (!player) {
		const str = client.intlGet(guildId, 'couldNotFindPlayerId', { id: bmId });
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}

	await displayWhois(client, interaction, player.bm_id, player.name);
}

async function displayWhois(client, interaction, bmId, currentName) {
	const guildId = interaction.guildId;

	const nameHistory = PlayerActivityDB.getNameHistoryByBmId(bmId, guildId);

	if (!nameHistory || nameHistory.length === 0) {
		const str = client.intlGet(guildId, 'noNameHistoryData', { name: currentName });
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}

	const profileLink = `[${bmId}](${Constants.BATTLEMETRICS_PROFILE_URL}${bmId})`;

	// Check live BM instances for current online status (optional enrichment)
	let isOnline = false;
	for (const bmInst of Object.values(client.battlemetricsInstances)) {
		if (bmInst.players && bmInst.players.hasOwnProperty(bmId)) {
			isOnline = bmInst.players[bmId].status;
			break;
		}
	}
	const status = isOnline ? Constants.ONLINE_EMOJI : Constants.OFFLINE_EMOJI;

	let description = `__**${client.intlGet(guildId, 'profile')}:**__ ${profileLink}\n`;
	description += `__**${client.intlGet(guildId, 'status')}:**__ ${status}\n`;
	description += `__**${client.intlGet(guildId, 'whoisCurrentName')}:**__ ${currentName}\n`;

	const embed = DiscordEmbeds.getEmbed({
		title: client.intlGet(guildId, 'whoisTitle', { name: currentName }),
		color: Constants.COLOR_DEFAULT,
		description: description
	});

	let historyValue = '';
	for (const entry of nameHistory) {
		const date = new Date(entry.first_seen).toISOString().slice(0, 10);
		historyValue += `• **${entry.name}** — ${client.intlGet(guildId, 'whoisFirstSeen')}: ${date}\n`;
	}

	embed.addFields({
		name: client.intlGet(guildId, 'whoisNameHistory'),
		value: historyValue || '\u200B',
		inline: false
	});

	await client.interactionEditReply(interaction, { embeds: [embed] });
	client.log(client.intlGet(guildId, 'infoCap'),
		client.intlGet(guildId, 'displayingPlayerSearchResults'));
}

async function displayMultiplePlayerMatches(client, interaction, players, search) {
	const guildId = interaction.guildId;
	const title = `${client.intlGet(guildId, 'playersSearch')}: ${search}`;
	const shown = players.slice(0, Constants.EMBED_MAX_FIELDS);
	const overflow = players.length - shown.length;

	const description = overflow > 0
		? client.intlGet(guildId, 'andMorePlayers', { number: overflow })
		: client.intlGet(guildId, 'multiplePlayersFound');

	const embed = DiscordEmbeds.getEmbed({
		title: title,
		color: Constants.COLOR_DEFAULT,
		description: description
	});

	let totalChars = title.length + description.length;

	for (const player of shown) {
		const nameHistory = PlayerActivityDB.getNameHistoryByBmId(player.bm_id, guildId);

		const bmUrl = `${Constants.BATTLEMETRICS_PROFILE_URL}${player.bm_id}`;
		const maxNameLen = Constants.EMBED_MAX_FIELD_NAME_CHARACTERS - bmUrl.length - 4; // 4 for `[]()`
		const displayName = player.name.length <= maxNameLen
			? player.name
			: player.name.substring(0, maxNameLen - 2) + '..';
		const fieldName = `[${displayName}](${bmUrl})`;

		let fieldValue = '';
		if (nameHistory && nameHistory.length > 0) {
			for (const entry of nameHistory) {
				const date = new Date(entry.first_seen).toISOString().slice(0, 10);
				const line = `• **${entry.name}** — ${client.intlGet(guildId, 'whoisFirstSeen')}: ${date}\n`;
				if (fieldValue.length + line.length > Constants.EMBED_MAX_FIELD_VALUE_CHARACTERS) break;
				fieldValue += line;
			}
		}
		if (!fieldValue) fieldValue = '\u200B';

		const fieldChars = fieldName.length + fieldValue.length;
		if (totalChars + fieldChars > Constants.EMBED_MAX_TOTAL_CHARACTERS) break;
		totalChars += fieldChars;

		embed.addFields({ name: fieldName, value: fieldValue, inline: false });
	}

	await client.interactionEditReply(interaction, { embeds: [embed] });
	client.log(client.intlGet(guildId, 'infoCap'),
		client.intlGet(guildId, 'displayingPlayerSearchResults'));
}
