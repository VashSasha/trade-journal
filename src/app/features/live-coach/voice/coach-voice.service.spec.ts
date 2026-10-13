import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachVoiceService } from './coach-voice.service';
import { CoachChatService } from '../chat/coach-chat.service';
import { LiveCoachService } from '../live-coach.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserSessionService } from '../../../core/services/user-session.service';
import { AiCoachingSettingsService } from '../../ai-settings/ai-coaching-settings.service';

function setup(connect = true) {
    const owner = signal<string | null>('owner'), allowed = signal(true), mode = signal('standard');
    const voiceActive = signal(false), conversationId = signal<string | null>('conversation');
    const track = { enabled: true, stop: vi.fn(), onended: null as null | (() => void) };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    const media = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } });
    let feed!: ReadableStreamDefaultController<Uint8Array>;
    const close = vi.fn(), createDataChannel = vi.fn(), cancelFeed = vi.fn();
    const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
    class Peer {
        ontrack = null; onconnectionstatechange: (() => void) | null = null;
        connectionState = 'new';
        addTrack = vi.fn(); close = close;
        createDataChannel = createDataChannel;
        createOffer = async () => ({ sdp, type: 'offer' });
        setLocalDescription = async () => {};
        setRemoteDescription = async () => { if (connect) { this.connectionState = 'connected'; this.onconnectionstatechange?.(); } };
    }
    vi.stubGlobal('RTCPeerConnection', Peer);
    vi.stubGlobal('Audio', class { autoplay = false; srcObject = null; pause() {} play() { return Promise.resolve(); } });
    const fetcher = vi.fn(async (url: string) => url.endsWith('/events')
        ? new Response(new ReadableStream<Uint8Array>({ start: controller => { feed = controller; }, cancel: cancelFeed }),
            { headers: { 'Content-Type': 'application/x-ndjson' } })
        : Response.json(url.endsWith('/start') ? { protocol: 'audio-only-v1', sdp, deadline: Date.now() + 180000 }
            : { ended: url.endsWith('/end') }));
    vi.stubGlobal('fetch', fetcher);
    const chat = { access: { canAct: () => allowed(), demo: () => false }, canReply: computed(() => allowed() && !voiceActive()),
        voiceActive, conversationId, day: signal('2026-10-08'), accountIds: signal<string[] | null>(null), open: vi.fn(async () => {}),
        prepareVoice: vi.fn(async () => ({ conversationId: 'conversation', context: {} })) };
    const coach = { voiceConversationActive: signal(false), preferences: () => ({ voice: 'cedar' }) };
    const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-jwt' } }, error: null })) };
    TestBed.configureTestingModule({ providers: [CoachVoiceService,
        { provide: CoachChatService, useValue: chat }, { provide: LiveCoachService, useValue: coach },
        { provide: SupabaseService, useValue: { client: { auth } } }, { provide: UserSessionService, useValue: { userId: owner } },
        { provide: AiCoachingSettingsService, useValue: { mode } },
    ] });
    const voice = TestBed.inject(CoachVoiceService); TestBed.tick();
    const chunk = async (text: string) => { feed.enqueue(new TextEncoder().encode(text)); await Promise.resolve(); await Promise.resolve(); };
    return { voice, chat, coach, owner, allowed, mode, track, stream, media, fetcher, close, createDataChannel, cancelFeed, chunk,
        closeFeed: () => feed.close(), event: (type: string, extra = {}) => chunk(JSON.stringify({ type, ...extra }) + '\n') };
}
afterEach(async () => { TestBed.resetTestingModule(); await Promise.resolve(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Coach voice call lifecycle', () => {
    it('never opens a microphone on widget creation; explicit start reuses chat/context and fresh authentication', async () => {
        const t = setup(); expect(t.media).not.toHaveBeenCalled(); expect(t.fetcher).not.toHaveBeenCalled();
        await t.voice.start(); expect(t.voice.state()).toBe('listening');
        expect(t.coach.voiceConversationActive()).toBe(true); expect(t.chat.voiceActive()).toBe(true);
        const args = t.fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(args[0]).toContain('/start'); expect(args[1].headers).toMatchObject({ Authorization: 'Bearer test-jwt' });
        expect(JSON.parse(String(args[1].body))).toMatchObject({ protocol: 'audio-only-v1', conversationId: 'conversation', voice: 'cedar', coachingMode: 'standard' });
        expect(t.createDataChannel).not.toHaveBeenCalled();
        expect(t.fetcher.mock.calls[1][0]).toContain('/events');
        expect((t.fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer test-jwt' });
        await t.voice.end(); expect(t.track.stop).toHaveBeenCalledOnce(); expect(t.close).toHaveBeenCalledOnce();
        expect(t.cancelFeed).toHaveBeenCalledOnce();
        expect(t.chat.open).toHaveBeenCalledWith('conversation'); expect(t.coach.voiceConversationActive()).toBe(false);
    });
    it('mutes only the microphone and updates listening/thinking/speaking from real events', async () => {
        const t = setup(); await t.voice.start(); t.voice.toggleMute(); expect(t.track.enabled).toBe(false);
        t.voice.toggleMute(); expect(t.track.enabled).toBe(true);
        await t.event('response.created'); expect(t.voice.state()).toBe('thinking');
        await t.event('output_audio_buffer.started'); expect(t.voice.state()).toBe('speaking');
        await t.event('response.output_audio_transcript.delta', { delta: 'Review sizing.' }); expect(t.voice.reply()).toBe('Review sizing.');
        await t.event('conversation.item.truncated'); expect(t.voice.reply()).toContain('interrupted');
        await t.event('input_audio_buffer.speech_started'); expect(t.voice.state()).toBe('listening');
        await t.voice.end();
    });
    it('handles split display events and keeps a healthy feed beyond the handshake timeout', async () => {
        vi.useFakeTimers(); const t = setup(); await t.voice.start();
        await t.chunk('{"type":"response.output_audio_transcript.delta","delta":"Hel');
        expect(t.voice.reply()).toBe(''); await t.chunk('lo"}\n'); expect(t.voice.reply()).toBe('Hello');
        await vi.advanceTimersByTimeAsync(31000);
        expect(t.voice.active()).toBe(true); expect(t.cancelFeed).not.toHaveBeenCalled();
        await t.voice.end();
    });
    it('ends and frees devices when the read-only feed disconnects', async () => {
        const t = setup(); await t.voice.start(); t.closeFeed();
        await vi.waitFor(() => expect(t.voice.active()).toBe(false));
        expect(t.track.stop).toHaveBeenCalledOnce(); expect(t.voice.notice()).toContain('updates disconnected');
    });
    it('rejects a legacy server without opening a provider control channel', async () => {
        const t = setup(); t.fetcher.mockImplementationOnce(async () => Response.json({ sdp: 'v=0', deadline: Date.now() + 180000 }));
        await t.voice.start(); expect(t.voice.error()).toContain('updated server');
        expect(t.createDataChannel).not.toHaveBeenCalled(); expect(t.track.stop).toHaveBeenCalledOnce();
        expect(t.fetcher.mock.calls.some(([url]) => url.endsWith('/events'))).toBe(false);
    });
    it('stops when authenticated display updates cannot connect', async () => {
        const t = setup();
        t.fetcher.mockImplementationOnce(async () => Response.json({ protocol: 'audio-only-v1', sdp: 'v=0', deadline: Date.now() + 180000 }));
        t.fetcher.mockImplementationOnce(async () => Response.json({ error: 'Forbidden' }, { status: 403 }));
        await t.voice.start(); expect(t.voice.error()).toContain('updates could not connect');
        expect(t.voice.active()).toBe(false); expect(t.track.stop).toHaveBeenCalledOnce();
    });
    it('does not reconnect or double start; stops a microphone granted after cancellation', async () => {
        const t = setup(); let grant!: (stream: typeof t.stream) => void;
        t.media.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
        const first = t.voice.start(); await t.voice.start(); expect(t.media).toHaveBeenCalledOnce();
        await t.voice.end(); grant(t.stream); await first;
        expect(t.track.stop).toHaveBeenCalledOnce(); expect(t.fetcher.mock.calls.some(([url]) => url.endsWith('/start'))).toBe(false);
    });
    it('shows permission and server errors, and releases devices without falling back to a hot mic', async () => {
        const t = setup(); t.media.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
        await t.voice.start(); expect(t.voice.error()).toContain('permission was denied'); expect(t.voice.active()).toBe(false);
        t.fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Voice beta limit reached.' }), { status: 429 }));
        await t.voice.start(); expect(t.voice.error()).toContain('limit reached'); expect(t.track.stop).toHaveBeenCalled();
    });
    it('shows a rejected start immediately, even while end cleanup is still waiting', async () => {
        const t = setup(); let release!: () => void;
        t.fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Daily voice allowance reached.' }), { status: 429 }));
        t.fetcher.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(Response.json({ ended: true })); }));
        const starting = t.voice.start();
        await vi.waitFor(() => expect(t.voice.error()).toContain('Daily voice allowance reached'));
        expect(t.voice.state()).toBe('ending'); expect(t.track.stop).toHaveBeenCalled();
        release(); await starting;
        expect(t.voice.error()).toContain('Daily voice allowance reached');
        await t.voice.start(); expect(t.voice.error()).toBe(''); await t.voice.end();
    });
    it('keeps the backend reason for heartbeat errors instead of replacing it with connection lost', async () => {
        vi.useFakeTimers(); const t = setup(); await t.voice.start();
        t.fetcher.mockImplementationOnce(async () => Response.json({ error: 'Voice requires AI access.' }, { status: 403 }));
        await vi.advanceTimersByTimeAsync(10000);
        expect(t.voice.error()).toBe('Voice requires AI access.'); expect(t.voice.active()).toBe(false);
    });
    it('shows the token allowance and quota reason even when WebRTC ends before the heartbeat', async () => {
        const t = setup(); await t.voice.start();
        const usage = { usedTokens: 50020, remainingTokens: 0, limitTokens: 50000, estimatedTokens: 0, resetsAt: '2026-10-10T00:00:00Z' };
        t.fetcher.mockImplementationOnce(async () => Response.json({ ended: true, message: 'Daily voice allowance reached. Text chat is still available.', usage }));
        await t.voice.end('Voice connection lost.');
        expect(t.voice.error()).toContain('Daily voice allowance reached'); expect(t.voice.allowance()).toEqual(usage);
        t.owner.set(null); TestBed.tick(); expect(t.voice.allowance()).toBeNull(); expect(t.voice.error()).toBe('');
    });
    it('ends on logout without loading the previous user chat', async () => {
        const t = setup(); await t.voice.start(); t.owner.set(null); TestBed.tick();
        await t.voice.end(); expect(t.track.stop).toHaveBeenCalled(); expect(t.chat.open).not.toHaveBeenCalled();
        expect(t.voice.active()).toBe(false);
    });
    it.each(['day', 'accounts', 'mode', 'access'])('ends when %s changes instead of silently using stale context', async change => {
        const t = setup(); await t.voice.start();
        if (change === 'day') t.chat.day.set('2026-10-09');
        if (change === 'accounts') t.chat.accountIds.set(['other']);
        if (change === 'mode') t.mode.set('unhinged');
        if (change === 'access') t.allowed.set(false);
        TestBed.tick(); await t.voice.end();
        expect(t.voice.active()).toBe(false); expect(t.track.stop).toHaveBeenCalled();
        expect(t.voice.notice()).toContain('changed');
    });
    it('times out even when signaling succeeds but the audio connection never opens', async () => {
        vi.useFakeTimers(); const t = setup(false); await t.voice.start();
        expect(t.voice.state()).toBe('connecting');
        await vi.advanceTimersByTimeAsync(30000);
        expect(t.voice.active()).toBe(false); expect(t.track.stop).toHaveBeenCalled();
        expect(t.voice.notice()).toContain('timed out');
    });
    it('releases microphone and audio when the widget is destroyed, without reopening its chat', async () => {
        const t = setup(); await t.voice.start(); TestBed.resetTestingModule(); await t.voice.end();
        expect(t.track.stop).toHaveBeenCalled(); expect(t.close).toHaveBeenCalled(); expect(t.chat.open).not.toHaveBeenCalled();
    });
    it('enforces local countdown and stops after a lost heartbeat rather than retrying paid calls', async () => {
        vi.useFakeTimers(); const t = setup(); await t.voice.start();
        t.fetcher.mockRejectedValueOnce(new Error('offline'));
        await vi.advanceTimersByTimeAsync(10000);
        expect(t.voice.active()).toBe(false); expect(t.voice.error()).toContain('connection lost');
        expect(t.media).toHaveBeenCalledOnce();
    });
});
