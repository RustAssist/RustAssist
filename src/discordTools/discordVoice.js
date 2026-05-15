/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)
    Copyright (C) 2023 FaiThiX

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
const { Readable } = require('stream');
const { getVoiceConnection, createAudioPlayer, createAudioResource, NoSubscriberBehavior,
    VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const Client = require('../../index.ts');

module.exports = {
    sendDiscordVoiceMessage: async function (guildId, text) {
        const connection = getVoiceConnection(guildId);
        if (!connection) return;

        /* Wait for the connection to be ready if it's not */
        if (connection.state.status !== VoiceConnectionStatus.Ready) {
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            } catch (e) {
                return;
            }
        }

        const language = this.getLanguage(guildId);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${language}&client=tw-ob&q=${encodeURIComponent(text)}`;

        try {
            const response = await fetch(url);
            if (!response.ok) return;
            const buffer = Buffer.from(await response.arrayBuffer());

            const player = createAudioPlayer({
                behaviors: { noSubscriber: NoSubscriberBehavior.Play }
            });

            connection.subscribe(player);
            const resource = createAudioResource(Readable.from(buffer));
            player.play(resource);
        } catch (e) {
            /* Silently ignore TTS errors */
        }
    },

    getLanguage: function (guildId) {
        const instance = Client.client.getInstance(guildId);
        return instance.generalSettings.language || 'en';
    },
}