import type OpenAI from 'npm:openai@7.9.0';

export const COACH_VOICE_PREVIEW = 'This is your AI coach. Position updates will be short and focused. Keep your decisions deliberate and your size consistent.';
const MAX_AUDIO_BYTES = 384 * 1024;

/** Only server-generated coaching copy (or a fixed preview) reaches speech. */
export async function coachSpeech(
    openai: OpenAI,
    text: string,
    voice: string,
    signal: AbortSignal,
): Promise<{ mimeType: 'audio/mpeg'; base64: string } | undefined> {
    if (voice === 'browser') return undefined;
    if (!['marin', 'cedar'].includes(voice) || !text.trim() || text.length > 220) {
        throw new Error('Invalid Coach speech input.');
    }
    const response = await openai.audio.speech.create({
        model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3',
        instructions: 'Speak in a calm, clear, concise trading coach voice. Neutral, grounded delivery. Read exactly the supplied text.',
    }, { signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]) });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty Coach audio.');
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_AUDIO_BYTES) throw new Error('Coach audio is too large.');
            chunks.push(value);
        }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!size) throw new Error('Empty Coach audio.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { mimeType: 'audio/mpeg', base64: btoa(binary) };
}
