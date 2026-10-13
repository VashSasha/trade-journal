import { RequestError } from '../../supabase/functions/_shared/request-body.ts';

export const VOICE_PROTOCOL = 'audio-only-v1';
export const OUTPUT_TOKENS = 512;
export const CONTEXT_TOKENS = 4096;

/** Reject control transports at the server, not merely in the shipped UI. */
export function audioOnlySdp(sdp: unknown, maxLength = 32000): string {
    if (typeof sdp !== 'string' || sdp.length > maxLength || sdp.includes('\0')) throw new RequestError('Invalid voice SDP.');
    const lines = sdp.split(/\r?\n/).filter(Boolean);
    const media = lines.filter(line => line.startsWith('m='));
    if (lines[0] !== 'v=0' || lines.some(line => !/^[a-z]=[^\r\n]*$/.test(line))
        || media.length !== 1 || !/^m=audio [1-9]\d{0,4} UDP\/TLS\/RTP\/SAVPF (?:\d+ ?)+$/.test(media[0])
        || lines.some(line => /sctp|webrtc-datachannel|^a=dc(?:map|sa):/i.test(line))) {
        throw new RequestError('Voice requires an audio-only connection. Refresh the app and try again.');
    }
    return sdp;
}

/** Bound the upstream body while reading, before buffering it for SDP validation. */
export async function readAnswer(response: Response): Promise<string> {
    if (!response.body) throw new RequestError('Voice provider returned no audio connection.', 502);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let text = '', bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 64000) { await reader.cancel(); throw new RequestError('Voice provider returned an invalid audio connection.', 502); }
            text += decoder.decode(value, { stream: true });
        }
        return audioOnlySdp(text + decoder.decode(), 64000);
    } finally { reader.releaseLock(); }
}

export function voiceSession(model: string, instructions: string, voice: string) {
    return { type: 'realtime', model, instructions, output_modalities: ['audio'], max_output_tokens: OUTPUT_TOKENS, tools: [],
        truncation: { type: 'retention_ratio', retention_ratio: 0.8, token_limits: { post_instructions: CONTEXT_TOKENS } },
        audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' },
            turn_detection: { type: 'semantic_vad', eagerness: 'medium', interrupt_response: true, create_response: false } },
            output: { voice } } };
}

/** Conservative input/context + output reservation, not an exact tokenizer or dollar cap. */
export function replyReservation(instructions: string): number {
    return new TextEncoder().encode(instructions).length + CONTEXT_TOKENS + OUTPUT_TOKENS + 1024;
}

/** Only these display fields may leave the trusted sideband. Never relay session config or arbitrary events. */
export function displayEvent(event: Record<string, unknown>): Record<string, string> | null {
    const type = event.type;
    if (typeof type !== 'string') return null;
    if (['input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'response.created',
        'output_audio_buffer.started', 'output_audio_buffer.stopped', 'output_audio_buffer.cleared',
        'conversation.item.truncated'].includes(type)) return { type };
    if (type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string')
        return { type, transcript: event.transcript.slice(0, 4000) };
    if (type === 'response.output_audio_transcript.delta' && typeof event.delta === 'string')
        return { type, delta: event.delta.slice(0, 4000) };
    return null;
}
