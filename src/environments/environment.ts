export const environment = {
    production: false,
    anthropicApiUrl: '/v1/messages',           // Electron-only: direct Anthropic call (dev proxied)
    aiProxyUrl: 'https://ai-proxy.nvzn-journal.com', // Web: server-side key store + AI proxy
    // Closed-beta routing gate. Off in local dev so developers aren't bounced
    // to /beta. The authoritative decision is still profiles.beta_access
    // (written server-side); this flag only toggles the client-side redirect.
    betaGate: true,
    supabaseUrl: 'https://elbcjsewyqptrckdydha.supabase.co',
    // Publishable key (new-style "anon" role) — safe to ship in the client bundle
    // because RLS protects all data; it grants no access beyond row-level policies.
    supabasePublishableKey: 'sb_publishable_CxCruicDoUcsyrWAxElHHQ_c1rrwRUS',
};
