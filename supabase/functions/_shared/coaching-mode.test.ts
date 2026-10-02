import assert from 'node:assert/strict';
import { buildParams, normalizeCoachModelText, normalizeCoachFollowUp } from './ai-prompts.ts';
import { resolveCoachingMode } from './coaching-mode.ts';

const consent = { unhinged: true, consent_version: 1, consented_at: '2026-09-30T10:00:00Z' };
const signal = new AbortController().signal;
function client(data: unknown, error: unknown = null) {
    const calls: unknown[] = [];
    const chain = { select: (_: string) => chain, eq: (key: string, value: string) => { calls.push([key, value]); return chain; },
        abortSignal: (_: AbortSignal) => chain, maybeSingle: async () => ({ data, error }) };
    return { calls, from: (table: string) => { calls.push(table); return chain; } };
}

Deno.test('new coaching requires both explicit browser mode and current owner consent', async () => {
    const db = client(consent);
    for (const request of [undefined, null, false, 'standard', 'UNHINGED', {}]) {
        assert.equal(await resolveCoachingMode(db, 'owner-a', request, signal), 'standard');
    }
    assert.deepEqual(db.calls, []);
    assert.equal(await resolveCoachingMode(db, 'owner-a', 'unhinged', signal), 'unhinged');
    assert.deepEqual(db.calls, ['ai_coaching_preferences', ['user_id', 'owner-a']]);
    for (const record of [null, {}, { ...consent, unhinged: false }, { ...consent, unhinged: 'true' },
        { ...consent, consent_version: 2 }, { ...consent, consented_at: null }, { ...consent, consented_at: 'bad' }]) {
        assert.equal(await resolveCoachingMode(client(record), 'owner-a', 'unhinged', signal), 'standard');
    }
});

Deno.test('consent verification errors fail before model generation rather than assuming opt-in', async () => {
    await assert.rejects(resolveCoachingMode(client(null, new Error('unavailable')), 'owner-a', 'unhinged', signal),
        (error: any) => error.status === 503 && /verify/.test(error.message));
});

Deno.test('every generated coaching surface gets a server style without changing structure or budgets', () => {
    const cases: [string, any][] = [
        ['analyze-trade', {}], ['analyze-image', { imageBase64: 'YWJj', tradeDetails: {} }],
        ['predict-market', { candles: [], symbol: 'MNQ', timeframe: '5m' }],
        ['live-coach', { observation: {}, session: {} }],
        ['live-coach-follow-up', { question: 'explain', observedAt: consent.consented_at, comment: 'Size increased.', snapshot: null }],
        ['live-coach-chat', { message: 'Review my plan.', context: { capturedAt: consent.consented_at, tradeDate: '2026-09-30', accountIds: null, dataReady: false, summary: null }, history: [] }],
        ['stream-analysis', { messages: [{ role: 'system', content: 'Use ## Summary and ## Next step.' }, { role: 'user', content: 'Review my day.' }], maxTokens: 600 }],
    ];
    for (const [type, payload] of cases) {
        const standard = buildParams(type, payload)!, unhinged = buildParams(type, payload, 'unhinged')!;
        assert.ok(standard && unhinged, type);
        assert.equal(standard.model, unhinged.model); assert.equal(standard.max_tokens, unhinged.max_tokens);
        assert.deepEqual(standard.messages.slice(0, -1), unhinged.messages.slice(0, -1));
        assert.deepEqual(standard.response_format, unhinged.response_format);
        const style = unhinged.messages.at(-1)!;
        assert.equal(style.role, 'system'); assert.match(String(style.content), /explicitly opted/);
        assert.match(String(style.content), /not independent decisions/); assert.match(String(style.content), /Never invent/);
        assert.match(String(style.content), /No slurs, threats/); assert.match(String(style.content), /Never pressure/);
        assert.match(String(style.content), /JSON\/Markdown structure/);
        assert.match(String(style.content), /at least one strong, uncensored swear word/);
        assert.match(String(style.content), /every substantive coaching response/);
        assert.match(String(style.content), /one-sentence live observation/);
        assert.match(String(style.content), /two to four well-placed phrases/);
        assert.match(String(style.content), /never copy unsupported claims/);
        assert.doesNotMatch(String(standard.messages.at(-1)!.content), /every substantive coaching response|no-bullshit trading/);
        assert.match(String(standard.messages.at(-1)!.content), /No profanity/);
    }
    assert.equal(buildParams('live-coach-preview', {}, 'unhinged'), null);
    assert.equal(buildParams('live-coach-speech', {}, 'unhinged'), null);
});

Deno.test('strong coaching language survives live and structured-response normalization', () => {
    const comment = 'Your recorded size doubled; review that fucking decision against your sizing plan.';
    assert.equal(normalizeCoachModelText(comment), comment);
    const answer = { meaning: 'P&L alone cannot explain the fucking decision.', evidence: 'No entry context was supplied.', nextStep: 'Journal the setup before judging the outcome.' };
    assert.deepEqual(normalizeCoachFollowUp(JSON.stringify(answer)), answer);
    // Stronger tone does not permit a live trading instruction.
    assert.equal(normalizeCoachModelText('Buy another fucking contract now.'), '');
    assert.equal(normalizeCoachFollowUp(JSON.stringify({ ...answer, nextStep: 'Buy another fucking contract now.' })), null);
});
