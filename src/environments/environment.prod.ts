export const environment = {
    production: true,
    anthropicApiUrl: 'https://api.anthropic.com/v1/messages', // Electron-only: direct Anthropic call
    aiProxyUrl: 'https://ai-proxy.nvzn-journal.com',          // Web: server-side key store + AI proxy
    supabaseUrl: 'https://elbcjsewyqptrckdydha.supabase.co',
    // Publishable key (new-style "anon" role) — safe to ship in the client bundle
    // because RLS protects all data; it grants no access beyond row-level policies.
    supabasePublishableKey: 'sb_publishable_CxCruicDoUcsyrWAxElHHQ_c1rrwRUS',
};
