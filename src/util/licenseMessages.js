const Discord = require('discord.js');

const messageCooldowns = new Map();

function canWrite(channel, guild) {
    if (!channel || !guild || !channel.permissionsFor) return false;

    const permissions = channel.permissionsFor(guild.members.me);
    if (!permissions) return false;

    return permissions.has(Discord.PermissionsBitField.Flags.ViewChannel) &&
        permissions.has(Discord.PermissionsBitField.Flags.SendMessages);
}

function findWritableTextChannel(guild) {
    if (!guild) return null;

    if (canWrite(guild.systemChannel, guild)) return guild.systemChannel;

    return guild.channels.cache.find(channel =>
        channel.type === Discord.ChannelType.GuildText && canWrite(channel, guild)) || null;
}

async function sendGuildMessage(client, guild, message, cooldownKey = null, cooldownMs = 60000) {
    if (!guild || !message) return false;

    const key = cooldownKey ? `${guild.id}:${cooldownKey}` : null;
    if (key) {
        const lastSentAt = messageCooldowns.get(key) || 0;
        if ((Date.now() - lastSentAt) < cooldownMs) return false;
        messageCooldowns.set(key, Date.now());
    }

    const channel = findWritableTextChannel(guild);
    if (!channel) {
        if (client && typeof client.log === 'function') {
            client.log('License', `No writable channel found for guild ${guild.id}.`, 'warning');
        }
        return false;
    }

    try {
        await channel.send(message);
        return true;
    }
    catch (e) {
        if (client && typeof client.log === 'function') {
            client.log('License', `Could not send license message in guild ${guild.id}: ${e.message}`, 'warning');
        }
        return false;
    }
}

async function leaveGuildWithMessage(client, guild, message, cooldownKey = null) {
    await sendGuildMessage(client, guild, message, cooldownKey);

    try {
        await guild.leave();
    }
    catch (e) {
        if (client && typeof client.log === 'function') {
            client.log('License', `Could not leave guild ${guild.id}: ${e.message}`, 'warning');
        }
    }
}

module.exports = {
    findWritableTextChannel,
    sendGuildMessage,
    leaveGuildWithMessage
};
