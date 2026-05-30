function clearTimer(timer) {
    if (timer) clearTimeout(timer);
}

function stopFcmListeners(client, guildId) {
    if (client.fcmListeners[guildId]) {
        client.fcmListeners[guildId].destroy();
        delete client.fcmListeners[guildId];
    }

    if (client.fcmListenersLite[guildId]) {
        for (const listener of Object.values(client.fcmListenersLite[guildId])) {
            if (listener && typeof listener.destroy === 'function') listener.destroy();
        }
        client.fcmListenersLite[guildId] = {};
    }
}

function stopRustplus(client, guildId) {
    const rustplus = client.rustplusInstances[guildId];
    if (rustplus) {
        rustplus.isDeleted = true;
        try {
            rustplus.disconnect();
        }
        catch {
            /* Ignore disconnect errors during cleanup. */
        }
        delete client.rustplusInstances[guildId];
    }

    client.activeRustplusInstances[guildId] = false;
    client.rustplusReconnecting[guildId] = false;
    client.rustplusReconnectAttempts[guildId] = 0;

    if (client.rustplusReconnectTimers[guildId]) {
        clearTimer(client.rustplusReconnectTimers[guildId]);
        client.rustplusReconnectTimers[guildId] = null;
    }
    if (client.rustplusLiteReconnectTimers[guildId]) {
        clearTimer(client.rustplusLiteReconnectTimers[guildId]);
        client.rustplusLiteReconnectTimers[guildId] = null;
    }
}

function stopGuildWork(client, guildId) {
    stopRustplus(client, guildId);
    stopFcmListeners(client, guildId);

    if (client.activationOnlyTimers && client.activationOnlyTimers[guildId]) {
        clearTimer(client.activationOnlyTimers[guildId]);
        delete client.activationOnlyTimers[guildId];
    }
}

async function startLicensedGuildWork(client, guild) {
    if (!guild || !client.isGuildLicensed(guild.id)) return false;
    if (client.rustplusInstances[guild.id]) return true;

    await client.setupGuild(guild);
    client.createRustplusInstanceFromConfig(guild.id);
    return true;
}

module.exports = {
    stopGuildWork,
    startLicensedGuildWork
};
