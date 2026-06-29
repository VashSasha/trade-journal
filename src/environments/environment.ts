export const environment = {
    production: false,
    anthropicApiUrl: '/v1/messages',           // Electron-only: direct Anthropic call (dev proxied)
    aiProxyUrl: 'https://ai-proxy.nvzn-journal.com', // Web: server-side key store + AI proxy
};
