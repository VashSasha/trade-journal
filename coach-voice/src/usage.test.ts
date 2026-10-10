import assert from 'node:assert/strict';
import { allowance, limitMessage, providerUsage, tokenLimit, utcDay } from './usage.ts';

Deno.test('voice token allowance uses UTC, clamps remaining and validates config', () => {
    assert.equal(tokenLimit('80000'), 80000);
    for (const invalid of [undefined, '', 'NaN', 'Infinity', '-10', '0', '50000.5']) assert.equal(tokenLimit(invalid), 50000);
    const day = utcDay(Date.parse('2026-10-09T23:59:59.999Z'));
    const budget = allowance({ tokens: 49000, estimatedTokens: 2000 }, 50000, day);
    assert.equal(budget.remainingTokens, 0); assert.equal(budget.usedTokens, 51000);
    assert.equal(budget.resetsAt, '2026-10-10T00:00:00.000Z');
    assert.equal(allowance(undefined, 50000, '2026-10-10').remainingTokens, 50000);
    assert.match(limitMessage(budget.resetsAt), /00:00 UTC on 2026-10-10/);
});
Deno.test('completed, interrupted and failed responses charge reported total input and output tokens', () => {
    for (const status of ['completed', 'cancelled', 'failed', 'incomplete']) {
        assert.deepEqual(providerUsage({ type: 'response.done', response: { id: 'resp_1', status, usage: { total_tokens: 456 } } }),
            { key: 'response:resp_1', complete: true, tokens: 456 });
    }
    assert.equal(providerUsage({ type: 'response.created', response: { id: 'resp_1' } })?.tokens, null);
});
Deno.test('input transcription has its own usage; missing and invalid usage never become free tokens', () => {
    assert.deepEqual(providerUsage({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', usage: { type: 'tokens', total_tokens: 30 } }),
        { key: 'transcript:item_1', complete: true, tokens: 30 });
    assert.equal(providerUsage({ type: 'input_audio_buffer.committed', item_id: 'item_1' })?.complete, false);
    for (const total_tokens of [undefined, -10, 0.5, '50', Infinity])
        assert.equal(providerUsage({ type: 'response.done', response: { id: 'resp_1', usage: { total_tokens } } })?.tokens, null);
    assert.equal(providerUsage({ type: 'response.done', response: { id: 'resp_1', usage: { total_tokens: 0 } } })?.tokens, 0);
    assert.equal(providerUsage({ type: 'response.output_audio.delta', delta: 'audio' }), null);
    assert.throws(() => providerUsage({ type: 'response.done', response: { id: '../bad' } }));
});
