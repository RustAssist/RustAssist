/*
	Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

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

const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const InstanceUtils = require('../util/instanceUtils.js');
const SmartSwitchHandler = require('../handlers/smartSwitchHandler.js');
const SmartSwitchGroupHandler = require('../handlers/smartSwitchGroupHandler.js');

module.exports = {
	name: 'alarm',

	getData(client, guildId) {
		return new Builder.SlashCommandBuilder()
			.setName('alarm')
			.setDescription(client.intlGet(guildId, 'commandsAlarmDesc'))
			.addSubcommand(subcommand => subcommand
				.setName('edit')
				.setDescription(client.intlGet(guildId, 'commandsAlarmEditDesc'))
				.addStringOption(option => option
					.setName('id')
					.setDescription(client.intlGet(guildId, 'commandsAlarmEditIdDesc'))
					.setRequired(true))
				.addStringOption(option => option
					.setName('image')
					.setDescription(client.intlGet(guildId, 'commandsAlarmEditImageDesc'))
					.setRequired(true)
					.addChoices(
						{ name: client.intlGet(guildId, 'autoturret'), value: 'autoturret' },
						{ name: client.intlGet(guildId, 'boomBox'), value: 'boombox' },
						{ name: client.intlGet(guildId, 'broadcaster'), value: 'broadcaster' },
						{ name: client.intlGet(guildId, 'ceilingLight'), value: 'ceiling_light' },
						{ name: client.intlGet(guildId, 'discoFloor'), value: 'discofloor' },
						{ name: client.intlGet(guildId, 'doorController'), value: 'door_controller' },
						{ name: client.intlGet(guildId, 'elevator'), value: 'elevator' },
						{ name: client.intlGet(guildId, 'hbhfSensor'), value: 'hbhf_sensor' },
						{ name: client.intlGet(guildId, 'heater'), value: 'heater' },
						{ name: client.intlGet(guildId, 'samsite'), value: 'samsite' },
						{ name: client.intlGet(guildId, 'sirenLight'), value: 'siren_light' },
						{ name: client.intlGet(guildId, 'smartAlarm'), value: 'smart_alarm' },
						{ name: client.intlGet(guildId, 'smartSwitch'), value: 'smart_switch' },
						{ name: client.intlGet(guildId, 'sprinkler'), value: 'sprinkler' },
						{ name: client.intlGet(guildId, 'storageMonitor'), value: 'storage_monitor' },
						{ name: client.intlGet(guildId, 'christmasLights'), value: 'xmas_light' })))
			.addSubcommand(subcommand => subcommand
				.setName('action-add')
				.setDescription(client.intlGet(guildId, 'commandsAlarmActionAddDesc'))
				.addStringOption(option => option
					.setName('id')
					.setDescription(client.intlGet(guildId, 'commandsAlarmEditIdDesc'))
					.setRequired(true))
				.addStringOption(option => option
					.setName('type')
					.setDescription(client.intlGet(guildId, 'commandsAlarmActionTypeDesc'))
					.setRequired(true)
					.addChoices(
						{ name: 'switch', value: 'switch' },
						{ name: 'group', value: 'group' }))
				.addStringOption(option => option
					.setName('target')
					.setDescription(client.intlGet(guildId, 'commandsAlarmActionTargetDesc'))
					.setRequired(true))
				.addStringOption(option => option
					.setName('state')
					.setDescription(client.intlGet(guildId, 'commandsAlarmActionStateDesc'))
					.setRequired(true)
					.addChoices(
						{ name: 'on', value: 'on' },
						{ name: 'off', value: 'off' },
						{ name: 'toggle', value: 'toggle' })))
			.addSubcommand(subcommand => subcommand
				.setName('action-remove')
				.setDescription(client.intlGet(guildId, 'commandsAlarmActionRemoveDesc'))
				.addStringOption(option => option
					.setName('id')
					.setDescription(client.intlGet(guildId, 'commandsAlarmEditIdDesc'))
					.setRequired(true))
				.addIntegerOption(option => option
					.setName('index')
					.setDescription(client.intlGet(guildId, 'commandsAlarmActionIndexDesc'))
					.setRequired(true)
					.setMinValue(1)))
			.addSubcommand(subcommand => subcommand
				.setName('action-list')
				.setDescription(client.intlGet(guildId, 'commandsAlarmActionListDesc'))
				.addStringOption(option => option
					.setName('id')
					.setDescription(client.intlGet(guildId, 'commandsAlarmEditIdDesc'))
					.setRequired(true)));
	},

	async execute(client, interaction) {
		const guildId = interaction.guildId;
		const instance = client.getInstance(guildId);

		const verifyId = Math.floor(100000 + Math.random() * 900000);
		client.logInteraction(interaction, verifyId, 'slashCommand');

		if (!await client.validatePermissions(interaction)) return;
		await interaction.deferReply({ ephemeral: true });

		switch (interaction.options.getSubcommand()) {
			case 'edit': {
				const entityId = interaction.options.getString('id');
				const image = interaction.options.getString('image');

				const device = InstanceUtils.getSmartDevice(guildId, entityId);
				if (device === null) {
					const str = client.intlGet(guildId, 'invalidId', { id: entityId });
					await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
					client.log(client.intlGet(null, 'warningCap'), str);
					return;
				}

				const entity = instance.serverList[device.serverId].alarms[entityId];

				if (image !== null) instance.serverList[device.serverId].alarms[entityId].image = `${image}.png`;
				client.setInstance(guildId, instance);

				client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
					id: `${verifyId}`,
					value: `edit, ${entityId}, ${image}.png`
				}));

				await DiscordMessages.sendSmartAlarmMessage(guildId, device.serverId, entityId);

				const str = client.intlGet(guildId, 'smartAlarmEditSuccess', { name: entity.name });
				await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str,
					instance.serverList[device.serverId].title));
				client.log(client.intlGet(null, 'infoCap'), str);
			} break;

			case 'action-add': {
				const alarmId = interaction.options.getString('id');
				const type = interaction.options.getString('type');
				const targetId = interaction.options.getString('target');
				const state = interaction.options.getString('state');

				const alarmDevice = InstanceUtils.getSmartDevice(guildId, alarmId);
				if (alarmDevice === null || alarmDevice.type !== 'alarm') {
					const str = client.intlGet(guildId, 'invalidId', { id: alarmId });
					await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
					return;
				}

				/* Validate target exists */
				const serverId = alarmDevice.serverId;
				const serverEntry = instance.serverList[serverId];
				let targetName = null;
				if (type === 'switch') {
					if (!serverEntry.switches[targetId]) {
						const str = client.intlGet(guildId, 'invalidId', { id: targetId });
						await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
						return;
					}
					targetName = serverEntry.switches[targetId].name;
				}
				else {
					if (!serverEntry.switchGroups[targetId]) {
						const str = client.intlGet(guildId, 'invalidId', { id: targetId });
						await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
						return;
					}
					targetName = serverEntry.switchGroups[targetId].name;
				}

				if (!instance.serverList[serverId].alarms[alarmId].actions) {
					instance.serverList[serverId].alarms[alarmId].actions = [];
				}
				instance.serverList[serverId].alarms[alarmId].actions.push({ type, targetId, state });
				client.setInstance(guildId, instance);

				const str = client.intlGet(guildId, 'alarmActionAdded', {
					state: state, target: targetName
				});
				await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str,
					serverEntry.title));
				client.log(client.intlGet(null, 'infoCap'), str);
			} break;

			case 'action-remove': {
				const alarmId = interaction.options.getString('id');
				const index = interaction.options.getInteger('index') - 1; /* 1-based → 0-based */

				const alarmDevice = InstanceUtils.getSmartDevice(guildId, alarmId);
				if (alarmDevice === null || alarmDevice.type !== 'alarm') {
					const str = client.intlGet(guildId, 'invalidId', { id: alarmId });
					await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
					return;
				}

				const serverId = alarmDevice.serverId;
				const actions = instance.serverList[serverId].alarms[alarmId].actions || [];
				if (index < 0 || index >= actions.length) {
					const str = client.intlGet(guildId, 'alarmActionInvalidIndex');
					await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
					return;
				}

				actions.splice(index, 1);
				instance.serverList[serverId].alarms[alarmId].actions = actions;
				client.setInstance(guildId, instance);

				const str = client.intlGet(guildId, 'alarmActionRemoved', { index: index + 1 });
				await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str,
					instance.serverList[serverId].title));
				client.log(client.intlGet(null, 'infoCap'), str);
			} break;

			case 'action-list': {
				const alarmId = interaction.options.getString('id');

				const alarmDevice = InstanceUtils.getSmartDevice(guildId, alarmId);
				if (alarmDevice === null || alarmDevice.type !== 'alarm') {
					const str = client.intlGet(guildId, 'invalidId', { id: alarmId });
					await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
					return;
				}

				const serverId = alarmDevice.serverId;
				const serverEntry = instance.serverList[serverId];
				const alarmEntry = serverEntry.alarms[alarmId];
				const actions = alarmEntry.actions || [];

				let description;
				if (actions.length === 0) {
					description = client.intlGet(guildId, 'alarmActionNone');
				}
				else {
					description = actions.map((a, i) => {
						const collection = a.type === 'switch' ? serverEntry.switches : serverEntry.switchGroups;
						const targetName = collection[a.targetId]
							? collection[a.targetId].name : `id:${a.targetId}`;
						return `${i + 1}. [${a.type}] ${targetName} → **${a.state}**`;
					}).join('\n');
				}

				await client.interactionEditReply(interaction, {
					embeds: [DiscordEmbeds.getEmbed({
						color: 0x00b0f4,
						title: `${alarmEntry.name} — ${client.intlGet(guildId, 'commandsAlarmActionListDesc')}`,
						description: description,
						footer: { text: serverEntry.title }
					})]
				});
			} break;

			default: {
			} break;
		}
	},
};
