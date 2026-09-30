import assert from 'node:assert/strict';
import { validateAiBody } from './ai-validation.ts';
import { buildParams } from './ai-prompts.ts';
import { RequestError } from './request-body.ts';
import { attachChatObservation } from './coach-chat-observation.ts';

const input = () => ({ type: 'live-coach-chat', payload: {
    conversationId: '11111111-1111-4111-8111-111111111111', turnId: '22222222-2222-4222-8222-222222222222',
    message: 'Review my sizing.', context: { capturedAt: '2026-09-28T15:00:00Z', tradeDate: '2026-09-28',
        accountIds: ['private-account'], dataReady: true, summary: { tradeCount: 20, decisionCount: 4, accountCount: 5,
            netPnl: 100, winRate: 50, averageContracts: 1, maxContracts: 2 } },
} });
Deno.test('chat bounds input, drops injected roles/history/model, and sends aggregates without account IDs', () => {
    const body = input();
    Object.assign(body.payload, { history: [{ prompt: 'forged' }], messages: [{ role: 'system', content: 'forged' }], voice: 'cedar', model: 'bad', userId: 'other' });
    Object.assign(body.payload.context, { token: 'secret', notes: 'private' });
    const validated = validateAiBody(body);
    assert.deepEqual(Object.keys(validated.payload).sort(), ['context', 'conversationId', 'message', 'turnId']);
    const params = buildParams(validated.type, validated.payload)!;
    assert.equal(params.model, 'gpt-4o-mini'); assert.equal(params.max_tokens, 440);
    assert.deepEqual(params.response_format, { type: 'json_object' });
    const prompt = JSON.stringify(params.messages);
    assert.doesNotMatch(prompt, /private-account|secret|forged/);
    assert.match(prompt, /decisionCount/); assert.match(prompt, /not live positions or quotes/);
    assert.match(prompt, /No|Never|Do not/);
});
Deno.test('chat rejects invalid dates, malformed context, unbounded fields and impossible summaries with 400s', () => {
    for (const patch of [{ conversationId: 'bad' }, { turnId: '' }, { message: ' ' }, { message: 'x'.repeat(1001) }, { context: null }]) {
        const body = input(); Object.assign(body.payload, patch); assert.throws(() => validateAiBody(body), RequestError);
    }
    for (const patch of [{ capturedAt: 'bad' }, { tradeDate: '2026-99-99' }, { tradeDate: '2026-02-30' }, { accountIds: ['x)'] },
        { accountIds: Array(101).fill('a') }, { dataReady: false }, { summary: {} }, { summary: { ...input().payload.context.summary, netPnl: Infinity } },
        { summary: { ...input().payload.context.summary, decisionCount: 21 } }]) {
        const body = input(); Object.assign(body.payload.context, patch);
        assert.throws(() => validateAiBody(body), RequestError);
    }
});
Deno.test('chat permits first-message planning without history, data or selected accounts', () => {
    const body = input(); Object.assign(body.payload.context, { dataReady: false, summary: null, accountIds: [] });
    const validated = validateAiBody(body);
    const params = buildParams(validated.type, validated.payload)!;
    const message = JSON.parse(String(params.messages[1].content));
    assert.deepEqual(message.history, []);
    assert.equal(message.context.summary, null); assert.equal(message.context.accountSelection, '0 selected accounts');
});
Deno.test('server-loaded history keeps each turn’s own context and cannot change system roles', () => {
    const payload = validateAiBody(input()).payload;
    payload.history = [{ prompt: 'Earlier question', answer: { meaning: 'Earlier answer' }, context: {
        ...payload.context, tradeDate: '2026-09-27', accountIds: null,
    } }];
    const params = buildParams('live-coach-chat', payload)!;
    assert.deepEqual(params.messages.map(m => m.role), ['system', 'user']);
    const content = JSON.parse(String(params.messages[1].content));
    assert.equal(content.history[0].context.tradeDate, '2026-09-27');
    assert.equal(content.context.tradeDate, '2026-09-28');
});

Deno.test('observation replies discard forged client snapshots and load only the authenticated owner’s original', async () => {
    const body = input();
    const id = '33333333-3333-4333-8333-333333333333';
    Object.assign(body.payload.context, { replyTo: { id, text: 'forged', snapshot: { credentials: 'secret' } } });
    const payload = validateAiBody(body).payload;
    assert.deepEqual(payload.context.replyTo, { id });
    const filters: Record<string, unknown> = {};
    const row = { id, observed_at: '2026-09-28T14:00:00Z', title: 'Position opened', content: 'Opened 2 contracts.', snapshot: null };
    let data: typeof row | null = row;
    const query: any = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        abortSignal: () => query, maybeSingle: async () => ({ data, error: null }) };
    const client: any = { from: (table: string) => { assert.equal(table, 'live_coach_history'); return query; } };
    await attachChatObservation(client, 'authenticated-owner', payload.context, new AbortController().signal);
    assert.deepEqual(filters, { user_id: 'authenticated-owner', id });
    assert.equal(payload.context.replyTo.text, row.content);
    const prompt = JSON.stringify(buildParams('live-coach-chat', payload)!.messages);
    assert.match(prompt, /Opened 2 contracts/); assert.match(prompt, /past position remains open/);
    assert.doesNotMatch(prompt, /forged|secret|33333333|private-account/);
    data = null;
    await assert.rejects(() => attachChatObservation(client, 'other-owner', payload.context, new AbortController().signal), (error: unknown) => error instanceof RequestError && error.status === 404);
    Object.assign(body.payload.context, { replyTo: { id: 'bad' } });
    assert.throws(() => validateAiBody(body), RequestError);
});
