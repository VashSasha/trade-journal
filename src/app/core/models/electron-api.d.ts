// Renderer-side view of the API exposed by electron/preload.js.
// (Legacy discordLogin remains in the preload but auth now goes through
// Supabase; only isElectron is consumed by the app.)
declare global {
    interface Window {
        electronAPI?: {
            discordLogin: (
                clientId: string,
                guildId: string,
                roles: Record<string, string>,
                port: number
            ) => Promise<unknown>;
            isElectron: boolean;
        };
    }
}

export {};
