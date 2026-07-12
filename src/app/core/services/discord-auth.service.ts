import { Injectable } from '@angular/core';
import { User, PlanTier } from '../models/user.model';
import { DISCORD_CONFIG } from '../config/discord.config';

declare global {
    interface Window {
        electronAPI?: {
            discordLogin: (clientId: string, guildId: string, roles: Record<string, string>, port: number) => Promise<DiscordLoginResult>;
            isElectron: boolean;
        };
    }
}

interface DiscordLoginResult {
    id: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
    roles: string[];
    roleConfig: Record<string, string>;
    sessionExpiry: number;
    authToken?: string; // Session JWT for the ai-proxy (web flow only; Electron omits it)
}

@Injectable({ providedIn: 'root' })
export class DiscordAuthService {

    get isElectron(): boolean {
        return !!(window as any).electronAPI?.isElectron;
    }

    /**
     * Trigger Discord login. In Electron, runs entirely inside the app.
     * In web, redirects to Discord OAuth (call handleWebCallback after redirect).
     */
    async loginWithDiscord(): Promise<User> {
        if (this.isElectron) {
            return this.electronLogin();
        } else {
            return this.webLogin();
        }
    }

    /** Handle the OAuth callback code (web flow only). */
    async handleWebCallback(code: string): Promise<User> {
        const codeVerifier = sessionStorage.getItem('discord_pkce_verifier');
        if (!codeVerifier) throw new Error('PKCE verifier not found — please try logging in again.');

        sessionStorage.removeItem('discord_pkce_verifier');

        const res = await fetch(DISCORD_CONFIG.webExchangeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                codeVerifier,
                redirectUri: DISCORD_CONFIG.webCallbackUrl
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Auth failed: ${err}`);
        }

        const data: DiscordLoginResult = await res.json();
        return this.buildUser(data);
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private async electronLogin(): Promise<User> {
        const result = await window.electronAPI!.discordLogin(
            DISCORD_CONFIG.clientId,
            DISCORD_CONFIG.guildId,
            DISCORD_CONFIG.roles,
            DISCORD_CONFIG.electronCallbackPort
        );
        return this.buildUser(result);
    }

    private async webLogin(): Promise<User> {
        const codeVerifier = this.generateCodeVerifier();
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);
        sessionStorage.setItem('discord_pkce_verifier', codeVerifier);

        const params = new URLSearchParams({
            client_id: DISCORD_CONFIG.clientId,
            response_type: 'code',
            redirect_uri: DISCORD_CONFIG.webCallbackUrl,
            scope: DISCORD_CONFIG.scopes.join(' '),
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });

        window.location.href = `https://discord.com/oauth2/authorize?${params}`;
        // Never resolves — page navigates away
        return new Promise(() => {});
    }

    private buildUser(data: DiscordLoginResult): User {
        const displayName = data.globalName || data.username;
        const initials = displayName
            .split(/\s+/)
            .map((w: string) => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);

        const plan = this.mapRolesToPlan(data.roles, data.roleConfig ?? DISCORD_CONFIG.roles);

        return {
            id: data.id,
            discordId: data.id,
            email: '',
            name: displayName,
            initials,
            avatar: data.avatar ?? undefined,
            plan,
            sessionExpiry: data.sessionExpiry,
            authToken: data.authToken
        };
    }

    private mapRolesToPlan(memberRoles: string[], roleConfig: Record<string, string>): PlanTier {
        if (memberRoles.includes(roleConfig['admin'])) return 'admin';
        if (memberRoles.includes(roleConfig['lifetime'])) return 'lifetime';
        if (memberRoles.includes(roleConfig['premium'])) return 'premium';
        return 'free';
    }

    // ── PKCE helpers ───────────────────────────────────────────────────────────

    private generateCodeVerifier(): string {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return btoa(String.fromCharCode(...array))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    private async generateCodeChallenge(verifier: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
}
