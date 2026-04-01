/**
 * Discord OAuth configuration.
 * Fill in these values from your Discord Developer Portal.
 * discord.com/developers/applications → your app → OAuth2
 */
export const DISCORD_CONFIG = {
    /** Your Discord application Client ID (safe to commit — it's public) */
    clientId: '1479580819851972801',

    /** The Guild (server) ID users must be a member of to access the app */
    guildId: '1127722604925558826',

    /**
     * Role IDs that map to plan tiers.
     * Get IDs via Server Settings → Roles → right-click role → Copy Role ID.
     * If a user has the lifetime role they get 'lifetime'.
     * If they only have premium they get 'premium'.
     * Any server member without either gets 'free'.
     */
    roles: {
        admin: '1197302887617925250',
        lifetime: '1439849246663643148',
        premium: '1198859184402333706',
    },

    /** OAuth2 scopes — do not change */
    scopes: ['identify', 'guilds.members.read'],

    /** Electron: local callback server port */
    electronCallbackPort: 59432,

    /**
     * Web only: URL of your serverless function that handles the token exchange.
     * See discord-exchange/ in the project root for the Cloudflare Worker implementation.
     */
    webExchangeUrl: 'https://trade-journal-discord-exchange.nvzn-journal.workers.dev/discord-exchange',

    /** Web only: redirect URI registered in Discord Developer Portal for web builds */
    webCallbackUrl: typeof window !== 'undefined'
        ? `${window.location.origin}/integrations/discord-callback`
        : 'http://localhost:4200/integrations/discord-callback'
};
