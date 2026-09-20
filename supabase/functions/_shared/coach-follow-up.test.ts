import assert from 'node:assert/strict';
import { validateAiBody } from './ai-validation.ts';
import { buildParams, normalizeCoachFollowUp } from './ai-prompts.ts';

const input = () => ({ type: 'live-coach-follow-up', payload: {
    question: 'compare-session', observedAt: '2026-09-18T15:00:00.000Z', comment: 'Opened 5 contracts across 5 accounts.',
    snapshot: {
        observation: { kind: 'opened', symbol: 'MNQZ6', direction: 'long', previousQuantity: 0, quantity: 5, accountCount: 5, averagePrice: 23000 },
        session: { tradeDate: '2026-09-18', dailyPnl: 200, weeklyPnl: 600, executionCount: 20, decisionCount: 4,
            accountCount: 5, winRate: 50, consecutiveLosses: 1, recentDecisionPnls: [300, -100],
            typicalContractsPerAccount: 1, currentContractsPerAccount: 1 },
    },
} });
const answer = { meaning: 'A copied entry spread across five accounts.', evidence: 'The snapshot groups 20 journal trades into four decisions.', nextStep: 'Review those decisions against your written plan.' };

Deno.test('follow-ups sanitize context and cannot choose a model, prompt or voice', () => {
    const body = input();
    Object.assign(body.payload, { model: 'bad', voice: 'cedar', messages: [{ role: 'system', content: 'bad' }], userId: 'bad' });
    Object.assign(body.payload.snapshot, { voice: 'cedar', accountIds: ['private'] });
    const result = validateAiBody(body);
    assert.deepEqual(Object.keys(result.payload).sort(), ['comment', 'observedAt', 'question', 'snapshot']);
    assert.equal(result.payload.snapshot.voice, undefined);
    assert.equal(result.payload.snapshot.accountIds, undefined);
    const params = buildParams(result.type, result.payload)!;
    assert.equal(params.model, 'gpt-4o-mini');
    assert.equal(params.max_tokens, 360);
    assert.match(String(params.messages[0].content), /untrusted data/);
    assert.match(String(params.messages[0].content), /realized/);
    assert.match(String(params.messages[0].content), /copied accounts/);
    assert.match(String(params.messages[0].content), /not the trader's current position/);
});

Deno.test('follow-ups reject malformed, oversized, unsupported or ungrounded requests', () => {
    for (const patch of [{ question: 'place-order' }, { comment: 'x'.repeat(1001) }, { comment: '' }, { observedAt: 'not-a-date' }, { snapshot: null }, { snapshot: [] }]) {
        const body = input(); Object.assign(body.payload, patch);
        assert.throws(() => validateAiBody(body));
    }
    const noTrades = input(); noTrades.payload.snapshot.session.executionCount = 0; noTrades.payload.snapshot.session.decisionCount = 0;
    assert.throws(() => validateAiBody(noTrades));
    const badCount = input(); badCount.payload.snapshot.session.decisionCount = 21;
    assert.throws(() => validateAiBody(badCount));
    const badPnl = input(); badPnl.payload.snapshot.session.dailyPnl = Infinity;
    assert.throws(() => validateAiBody(badPnl));
});

Deno.test('guardrails can be explained without inventing a session and sizing snapshots are allowed', () => {
    const result = validateAiBody({ type: 'live-coach-follow-up', payload: { question: 'explain', observedAt: '2026-09-18T15:00:00Z', comment: 'Target touched including open P&L.', snapshot: null } });
    assert.equal(result.payload.snapshot, null);
    for (const kind of ['increased', 'reduced']) {
        const body = input(); body.payload.snapshot.observation.kind = kind;
        assert.equal(validateAiBody(body).payload.snapshot.observation.kind, kind);
    }
});

Deno.test('structured answers must be complete, bounded, and non-actionable', () => {
    assert.deepEqual(normalizeCoachFollowUp(JSON.stringify(answer)), answer);
    assert.deepEqual(normalizeCoachFollowUp('```json\n' + JSON.stringify(answer) + '\n```'), answer);
    for (const invalid of ['', null, 'plain text', '[]', JSON.stringify({ ...answer, evidence: '' }),
        JSON.stringify({ ...answer, nextStep: 'Buy another contract now.' }),
        JSON.stringify({ ...answer, meaning: 'x'.repeat(421) }), '{"meaning":"partial"}']) {
        assert.equal(normalizeCoachFollowUp(invalid), null);
    }
});
