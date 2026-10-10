export const environment = {
    production: false,
    coachVoiceUrl: 'https://nvzn-coach-voice.oleksandr-m-vashchuk.workers.dev', // Deployed voice backend; local Worker setup is optional (see coach-voice/README.md).
    anthropicApiUrl: '/v1/messages',           // Electron-only: direct Anthropic call (dev proxied)
    aiProxyUrl: 'https://ai-proxy.nvzn-journal.com', // Web: server-side key store + AI proxy
    betaGate: false,
    supabaseUrl: 'https://elbcjsewyqptrckdydha.supabase.co',
    // Publishable key (new-style "anon" role) — safe to ship in the client bundle
    // because RLS protects all data; it grants no access beyond row-level policies.
    supabasePublishableKey: 'sb_publishable_CxCruicDoUcsyrWAxElHHQ_c1rrwRUS',
};
