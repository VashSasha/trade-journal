import assert from 'node:assert/strict';
import { validateAiBody, MAX_AI_BODY_BYTES } from './ai-validation.ts';
import { readJson, RequestError } from './request-body.ts';
import { discordBotRoles, discordIdentity, discordRoles } from './discord-identity.ts';
import { aiTextStream } from './ai-stream.ts';
import { buildParams, normalizeCoachModelText } from './ai-prompts.ts';

const input = (maxTokens: unknown = 600) => ({ type: 'stream-analysis', payload: {
    messages: [{ role: 'system', content: 'Coach the trader.' }, { role: 'user', content: '2 wins, 1 loss.' }], maxTokens,
} });
const coachInput = () => ({ type: 'live-coach', payload: {
    observation: {
        kind: 'opened', symbol: 'MNQZ6', direction: 'long', previousQuantity: 0,
        quantity: 5, accountCount: 5, averagePrice: 23_000,
    },
    session: {
        tradeDate: '2026-09-09', dailyPnl: -120, weeklyPnl: 340,
        executionCount: 20, decisionCount: 4, accountCount: 5, winRate: 50,
        consecutiveLosses: 1, recentDecisionPnls: [200, -100],
        typicalContractsPerAccount: 1, currentContractsPerAccount: 1,
    },
} });
Deno.test('AI validation allows the journal and image-report shapes', () => {
    assert.equal(validateAiBody(input()).payload.maxTokens, 600);
    const body = input();
    (body.payload.messages as unknown[]) = [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        { type: 'text', text: 'Review this chart.' },
    ] }];
    assert.equal(validateAiBody(body).payload.messages.length, 1);
});
Deno.test('invalid tokens, roles, image URLs, and oversized prompts cannot reserve AI quota', () => {
    for (const max of [-1, 0, 2001, Infinity, 1.5, '600']) assert.throws(() => validateAiBody(input(max)), RequestError);
    for (const body of [null, {}, { type: 'unknown', payload: {} }, { type: 'stream-analysis', payload: { messages: [] } },
        { type: 'stream-analysis', payload: { messages: [{ role: 'tool', content: 'x' }] } },
        { type: 'stream-analysis', payload: { messages: [{ role: 'user', content: 'x'.repeat(40_001) }] } },
        { type: 'stream-analysis', payload: { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/private' } }] }] } },
        { type: 'analyze-trade', payload: { marketData: [{ timestamp: 'bad' }], tradeDetails: {} } },
    ]) assert.throws(() => validateAiBody(body), RequestError);
});
Deno.test('Live Coach accepts only bounded aggregate context and uses the short model', () => {
    const input = coachInput();
    (input.payload as any).userId = 'must-be-dropped';
    const validated = validateAiBody(input);
    assert.equal(validated.payload.session.decisionCount, 4);
    assert.equal(validated.payload.userId, undefined);
    const params = buildParams(validated.type, validated.payload)!;
    assert.equal(params.model, 'gpt-4o-mini');
    assert.equal(params.max_tokens, 80);
    assert.equal(normalizeCoachModelText('**Stay selective.**\n'), 'Stay selective.');
    assert.equal(normalizeCoachModelText('Buy another contract now.'), '');
});
Deno.test('Live Coach rejects malformed counts, identifiers in fields, and unsupported events', () => {
    const invalidCount = coachInput();
    invalidCount.payload.session.decisionCount = 21;
    assert.throws(() => validateAiBody(invalidCount), RequestError);
    const badEvent = coachInput();
    badEvent.payload.observation.kind = 'increased';
    assert.throws(() => validateAiBody(badEvent), RequestError);
    const badSymbol = coachInput();
    badSymbol.payload.observation.symbol = 'x'.repeat(33);
    assert.throws(() => validateAiBody(badSymbol), RequestError);
});
Deno.test('Coach voice accepts only built-in voices and previews cannot speak arbitrary text', () => {
    const input = coachInput();
    assert.equal(validateAiBody(input).payload.voice, 'browser');
    (input.payload as any).voice = 'marin';
    assert.equal(validateAiBody(input).payload.voice, 'marin');
    (input.payload as any).voice = 'voice_untrusted';
    assert.throws(() => validateAiBody(input), RequestError);
    assert.deepEqual(validateAiBody({ type: 'live-coach-preview', payload: { voice: 'cedar', text: 'Untrusted text' } }),
        { type: 'live-coach-preview', payload: { voice: 'cedar' } });
    assert.throws(() => validateAiBody({ type: 'live-coach-preview', payload: { voice: 'browser' } }), RequestError);
});
Deno.test('JSON body byte limits apply without Content-Length', async () => {
    const req = new Request('https://local.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
    assert.equal((await readJson(req, MAX_AI_BODY_BYTES) as any).type, 'stream-analysis');
    const large = new Request('https://local.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(100) });
    await assert.rejects(readJson(large, 10), (e: unknown) => e instanceof RequestError && e.status === 413);
});
Deno.test('Discord identity never falls back to editable metadata', () => {
    assert.equal(discordIdentity({ identities: [{ provider: 'google', id: '123456789012345678' }],
        user_metadata: { provider_id: '123456789012345678' } } as any), null);
    assert.equal(discordIdentity({ identities: [{ provider: 'discord', id: '123456789012345678' }] }), '123456789012345678');
});
Deno.test('Discord token substitution rejected before even querying guild membership', async () => {
    let calls = 0;
    const fake = (async () => { calls++; return Response.json({ id: '999' }); }) as typeof fetch;
    await assert.rejects(discordRoles('token', '123456789012345678', 'guild', new AbortController().signal, fake), /identity mismatch/);
    assert.equal(calls, 1);
});
Deno.test('verified user outside the guild has no paid roles; transient errors are not revocations', async () => {
    let calls = 0;
    const fake = (async () => ++calls === 1 ? Response.json({ id: '123' }) : new Response(null, { status: 404 })) as typeof fetch;
    assert.deepEqual(await discordRoles('token', '123', 'guild', new AbortController().signal, fake), []);
    await assert.rejects(discordRoles('token', '123', 'guild', new AbortController().signal,
        (async () => new Response(null, { status: 503 })) as typeof fetch), /unavailable/);
});
Deno.test('server bot silently verifies only the requested linked member', async () => {
    let requested = '';
    let authorization = '';
    const fake = (async (input: string | URL | Request, init?: RequestInit) => {
        requested = String(input);
        authorization = new Headers(init?.headers).get('Authorization') ?? '';
        return Response.json({ user: { id: '123' }, roles: ['member', 'lifetime'] });
    }) as typeof fetch;
    assert.deepEqual(await discordBotRoles('secret', '123', 'guild', new AbortController().signal, fake), ['member', 'lifetime']);
    assert.equal(requested, 'https://discord.com/api/v10/guilds/guild/members/123');
    assert.equal(authorization, 'Bot secret');
});
Deno.test('bot lookup distinguishes a missing member from broken verification', async () => {
    assert.deepEqual(await discordBotRoles('secret', '123', 'guild', new AbortController().signal,
        (async () => Response.json({ code: 10007, message: 'Unknown Member' }, { status: 404 })) as typeof fetch), []);
    await assert.rejects(discordBotRoles('secret', '123', 'guild', new AbortController().signal,
        (async () => Response.json({ code: 10004, message: 'Unknown Guild' }, { status: 404 })) as typeof fetch), /not configured correctly/);
    await assert.rejects(discordBotRoles('secret', '123', 'guild', new AbortController().signal,
        (async () => new Response(null, { status: 403 })) as typeof fetch), /not configured correctly/);
});
Deno.test('a failed partial AI stream sends an error, never a success marker', async () => {
    let aborted = false;
    const settlements: boolean[] = [];
    async function* broken() { yield 'partial'; throw new Error('upstream private detail'); }
    const response = await new Response(aiTextStream('first', broken(), () => { aborted = true; }, async success => { settlements.push(success); })).text();
    assert.match(response, /"type":"error"/);
    assert.doesNotMatch(response, /message_stop|upstream private detail/);
    assert.deepEqual(settlements, [true]);
    assert.equal(aborted, true);
});
Deno.test('completed AI stream emits a success marker and settles quota', async () => {
    async function* rest() { yield ' next'; }
    const result = await new Response(aiTextStream('first', rest(), () => {}, async success => assert.equal(success, true))).text();
    assert.match(result, /message_stop/);
});
