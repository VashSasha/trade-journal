// Renderer-side view of the API exposed by electron/preload.js.
// Authentication goes through Supabase; no privileged auth IPC is exposed.
declare global {
    interface Window {
        electronAPI?: {
            isElectron: boolean;
        };
    }
}

export {};
