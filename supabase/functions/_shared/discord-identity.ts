import { RequestError } from './request-body.ts';

export function discordIdentity(user: { identities?: { provider: string; id: string }[] }): string | null {
    const id = user.identities?.find(identity => identity.provider === 'discord')?.id;
    return id && /^\d{15,22}$/.test(id) ? id : null;
}

/** Token ownership is checked even when the caller is no longer in the guild. */
export async function discordRoles(token: string, expectedId: string, guild: string, signal: AbortSignal, request = fetch): Promise<string[]> {
    const headers = { Authorization: `Bearer ${token}` };
    const who = await request('https://discord.com/api/v10/users/@me', { headers, signal });
    if (who.status === 401 || who.status === 403) throw new RequestError('Please sign in with Discord again to refresh your membership.', 401);
    if (!who.ok) throw new RequestError('Discord is unavailable. Please try again shortly.', 502);
    if ((await who.json()).id !== expectedId) throw new RequestError('Discord identity mismatch.', 403);
    const response = await request(`https://discord.com/api/v10/users/@me/guilds/${guild}/member`, { headers, signal });
    if (response.status === 404) return [];
    if (response.status === 401 || response.status === 403) throw new RequestError('Please sign in with Discord again to refresh your membership.', 401);
    if (!response.ok) throw new RequestError('Discord is unavailable. Please try again shortly.', 502);
    const member = await response.json();
    if (member.user?.id !== expectedId || !Array.isArray(member.roles) || !member.roles.every((r: unknown) => typeof r === 'string')) {
        throw new RequestError('Discord membership could not be verified.', 502);
    }
    return member.roles;
}
