const FEATURE_FLAGS = {
    rustplus: false,
    battlemetrics: false,
    notifications: false,
    maps: false,
    automation: false,
    smartDevices: false,
    teamChat: false,
    streamDeck: false,
    activityHistory: false,
    cameraControls: false,
    credentials: false,
    serverManagement: false,
};

const LIMITS = {
    maxRustServers: 0,
    maxPairedPlayers: 0,
    mapRefreshMinSeconds: 0,
    maxTrackers: 0,
    maxSmartDevices: 0,
};

const COMMAND_FEATURES = {
    activity: 'activityHistory',
    alarm: 'smartDevices',
    credentials: 'credentials',
    ingameaccess: 'teamChat',
    leader: 'serverManagement',
    map: 'maps',
    market: 'rustplus',
    offlinepattern: 'activityHistory',
    players: 'rustplus',
    storagemonitor: 'smartDevices',
    switch: 'smartDevices',
    voice: 'teamChat',
};

function activeEverything() {
    return Object.fromEntries(Object.keys(FEATURE_FLAGS).map((key) => [key, true]));
}

module.exports = {
    FEATURE_FLAGS,
    LIMITS,
    COMMAND_FEATURES,
    activeEverything,
};

