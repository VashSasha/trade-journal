const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /** Trigger the Discord OAuth login flow and return the resolved user info */
    discordLogin: (clientId, guildId, roles, port) =>
        ipcRenderer.invoke('discord-login', { clientId, guildId, roles, port }),

    isElectron: true
});
