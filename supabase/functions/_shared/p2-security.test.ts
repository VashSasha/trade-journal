import assert from 'node:assert/strict';
import { validateAiBody, MAX_AI_BODY_BYTES } from './ai-validation.ts';
import { readJson, RequestError } from './request-body.ts';
import { discordIdentity, discordRoles } from './discord-identity.ts';
import { aiTextStream } from './ai-stream.ts';

const input = (maxTokens: unknown = 600) => ({ type: 'stream-analysis', payload: {
    messages: [{ role: 'system', content: 'Coach the trader.' }, { role: 'user', content: '2 wins, 1 loss.' }], maxTokens,
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
