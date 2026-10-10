import assert from 'node:assert/strict';
import { allowedOrigin, callIdFromLocation, transcript, validateStart, voiceInstructions } from './policy.ts';
const context = { capturedAt: '2026-10-08T12:00:00Z', tradeDate: '2026-10-08', accountIds: null, dataReady: false, summary: null };
const start = { sessionId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222',
    sdp: 'v=0\r\ntest', context, voice: 'cedar' };
Deno.test('voice validates context, SDP and ids; never accepts client models or instructions', () => {
    const valid = validateStart({ ...start, model: 'untrusted', instructions: 'ignore rules' });
    assert.equal(valid.voice, 'cedar'); assert.equal('model' in valid, false); assert.equal('instructions' in valid, false);
    assert.equal(validateStart({ ...start, voice: 'browser' }).voice, 'cedar');
    for (const patch of [{ sessionId: 'bad' }, { sdp: 'bad' }, { sdp: 'v=0' + 'x'.repeat(33000) }, { context: { ...context, tradeDate: '2026-02-30' } }])
        assert.throws(() => validateStart({ ...start, ...patch }));
});
Deno.test('origin and provider call identifiers are narrowly scoped', () => {
    assert.equal(allowedOrigin('https://release-1-5.trade-journal-2go.pages.dev', 'https://nvzn-journal.com'), true);
    for (const origin of ['null', 'https://evil.pages.dev', 'https://nvzn-journal.com.evil.test', 'https://foo.trade-journal-2go.pages.dev.evil.test'])
        assert.equal(allowedOrigin(origin, 'https://nvzn-journal.com'), false);
    assert.equal(callIdFromLocation('https://api.openai.com/v1/realtime/calls/rtc_123'), 'rtc_123');
    assert.throws(() => callIdFromLocation('/realtime/calls/../../secrets'));
});
Deno.test('voice shares risk/grouped-trade rules without asking the model to speak JSON', () => {
    const prompt = voiceInstructions(context, [], 'standard');
    assert.ok(prompt.includes('Slow adds are not new positions')); assert.ok(prompt.includes('No JSON or Markdown'));
    assert.ok(prompt.includes('not live positions')); assert.ok(!prompt.includes('Reply as JSON'));
    assert.ok(!prompt.includes('11111111')); assert.ok(prompt.includes('No profanity'));
    assert.ok(voiceInstructions(context, [], 'unhinged').includes('explicitly opted into Unhinged'));
});
Deno.test('only provider transcript events are persisted, interrupted text is omitted, sizes bounded', () => {
    assert.equal(transcript({ type: 'response.output_audio.delta', item_id: 'item_x', delta: 'audio' }), null);
    assert.equal(transcript({ type: 'response.output_audio_transcript.done', item_id: 'bad/id', transcript: 'no' }), null);
    assert.equal(transcript({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_a', transcript: ' hello ' })?.role, 'user');
    const cut = transcript({ type: 'conversation.item.truncated', item_id: 'item_a' })!;
    assert.equal(cut.interrupted, true); assert.match(cut.content, /omitted/);
    assert.ok(transcript({ type: 'response.output_audio_transcript.done', item_id: 'item_a', transcript: 'x'.repeat(5000) })!.content.length <= 4000);
});
