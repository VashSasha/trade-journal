import assert from 'node:assert/strict';
import type OpenAI from 'npm:openai@7.9.0';
import { coachSpeech, COACH_VOICE_PREVIEW } from './coach-speech.ts';
import { COACH_AI_VOICES } from './coach-voices.ts';
import { LIVE_COACH_AI_VOICES } from '../../../src/app/features/live-coach/live-coach-voices.ts';
import { validateAiBody } from './ai-validation.ts';

Deno.test('speech uses approved voice/model, exact validated text and bounded output', async () => {
    let params: any;
    const api = { audio: { speech: { create: async (body: unknown) => {
        params = body;
        return new Response(new Uint8Array([1, 2, 3]));
    } } } } as unknown as OpenAI;
    const audio = await coachSpeech(api, COACH_VOICE_PREVIEW, 'marin', new AbortController().signal);
    assert.equal(params.model, 'gpt-4o-mini-tts');
    assert.equal(params.input, COACH_VOICE_PREVIEW);
    assert.equal(params.voice, 'marin');
    assert.deepEqual(audio, { mimeType: 'audio/mpeg', base64: 'AQID' });
    assert.equal(await coachSpeech(api, 'Hello.', 'browser', new AbortController().signal), undefined);
    await assert.rejects(coachSpeech(api, 'Hello.', 'unapproved', new AbortController().signal));
    await assert.rejects(coachSpeech(api, 'x'.repeat(221), 'cedar', new AbortController().signal));
});

Deno.test('empty and oversized audio are rejected for factual playback fallback', async () => {
    for (const size of [0, 384 * 1024 + 1]) {
        const api = { audio: { speech: { create: async () => new Response(new Uint8Array(size)) } } } as unknown as OpenAI;
        await assert.rejects(coachSpeech(api, 'Keep your size consistent.', 'cedar', new AbortController().signal));
    }
});

Deno.test('every UI voice is allowlisted for preview and speech without arbitrary text', async () => {
    assert.deepEqual(LIVE_COACH_AI_VOICES, COACH_AI_VOICES);
    assert.equal(COACH_AI_VOICES.length, 13);
    for (const voice of COACH_AI_VOICES) {
        const body = validateAiBody({ type: 'live-coach-preview', payload: { voice, text: 'Do not speak this' } });
        assert.deepEqual(body.payload, { voice });
        const api = { audio: { speech: { create: async (params: any) => {
            assert.equal(params.voice, voice);
            assert.equal(params.input, COACH_VOICE_PREVIEW);
            return new Response(new Uint8Array([1, 2, 3]));
        } } } } as unknown as OpenAI;
        assert.ok(await coachSpeech(api, COACH_VOICE_PREVIEW, body.payload.voice, new AbortController().signal));
    }
});
