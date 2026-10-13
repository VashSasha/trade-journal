import assert from 'node:assert/strict';
import { audioOnlySdp, CONTEXT_TOKENS, displayEvent, OUTPUT_TOKENS, readAnswer, replyReservation, voiceSession } from './controls.ts';
import { allowance } from './usage.ts';

const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 0 8\r\na=mid:0\r\n';
Deno.test('voice negotiates only a single audio transport, never browser commands', () => {
    assert.equal(audioOnlySdp(sdp), sdp);
    assert.equal(audioOnlySdp(sdp.replaceAll('\r\n', '\n')), sdp.replaceAll('\r\n', '\n'));
    for (const invalid of [null, '', 'v=0', sdp + 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
        sdp + 'a=sctp-port:5000\r\n', sdp + 'a=SCTPmap:5000 webrtc-datachannel 1024\r\n',
        sdp + 'a=dcmap:0 label="oai-events"\r\n', sdp + 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
        sdp.replace('m=audio', 'm=video'), sdp.replace('m=audio 9', 'm=audio 0'),
        sdp.replace('UDP/TLS/RTP/SAVPF', 'UDP/DTLS/SCTP'), sdp + '\0', sdp + 'x'.repeat(32000)])
        assert.throws(() => audioOnlySdp(invalid));
});
Deno.test('upstream answers are byte-bounded and cannot add a control transport', async () => {
    assert.equal(await readAnswer(new Response(sdp)), sdp);
    await assert.rejects(() => readAnswer(new Response(null)));
    await assert.rejects(() => readAnswer(new Response(sdp + 'a=sctp-port:5000\r\n')));
    let cancelled = false;
    const response = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(33000)); }, cancel() { cancelled = true; } }));
    await assert.rejects(() => readAnswer(response)); assert.equal(cancelled, true);
});
Deno.test('only the server creates replies with bounded context and no tools', () => {
    const config = voiceSession('gpt-realtime-mini', 'trusted instructions', 'cedar');
    assert.equal(config.audio.input.turn_detection.create_response, false);
    assert.equal(config.audio.input.turn_detection.interrupt_response, true);
    assert.equal(config.max_output_tokens, OUTPUT_TOKENS);
    assert.equal(config.truncation.token_limits.post_instructions, CONTEXT_TOKENS);
    assert.deepEqual(config.tools, []);
    const hold = replyReservation('trusted instructions');
    assert.ok(hold > CONTEXT_TOKENS + OUTPUT_TOKENS);
    const budget = allowance({ tokens: 1000, estimatedTokens: 0, reservedTokens: hold }, 50000);
    assert.equal(budget.usedTokens, 1000); assert.equal(budget.remainingTokens, 49000 - hold);
    assert.ok(replyReservation('😈') > replyReservation('a'));
});
Deno.test('browser display stream excludes session config, commands, metadata and audio', () => {
    for (const type of ['session.created', 'session.updated', 'response.create', 'response.done', 'response.output_audio.delta', 'error'])
        assert.equal(displayEvent({ type, secret: 'never send', instructions: 'private context' }), null);
    assert.deepEqual(displayEvent({ type: 'response.created', response: { metadata: { key: 'secret' } } }), { type: 'response.created' });
    assert.deepEqual(displayEvent({ type: 'response.output_audio_transcript.delta', delta: 'hello', secret: 'never send' }),
        { type: 'response.output_audio_transcript.delta', delta: 'hello' });
    assert.equal(displayEvent({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'x'.repeat(5000) })?.transcript.length, 4000);
});
