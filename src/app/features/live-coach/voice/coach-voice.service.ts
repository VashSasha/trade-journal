import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserSessionService } from '../../../core/services/user-session.service';
import { AiCoachingSettingsService } from '../../ai-settings/ai-coaching-settings.service';
import { CoachChatService } from '../chat/coach-chat.service';
import { LiveCoachService } from '../live-coach.service';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ending';
type VoiceAllowance = { usedTokens: number; remainingTokens: number; limitTokens: number; estimatedTokens: number; resetsAt: string };
class VoiceRequestError extends Error {}

/** Component-scoped call; audio and credentials never enter localStorage. */
@Injectable()
export class CoachVoiceService {
    private readonly chat = inject(CoachChatService);
    private readonly coach = inject(LiveCoachService);
    private readonly auth = inject(SupabaseService).client.auth;
    private readonly session = inject(UserSessionService);
    private readonly tone = inject(AiCoachingSettingsService);
    private readonly document = inject(DOCUMENT);
    readonly configured = !!environment.coachVoiceUrl;
    readonly supported = typeof RTCPeerConnection !== 'undefined' && !!globalThis.navigator?.mediaDevices?.getUserMedia;
    readonly state = signal<VoiceState>('idle');
    readonly active = computed(() => this.state() !== 'idle');
    readonly muted = signal(false);
    readonly remaining = signal(180);
    readonly notice = signal('');
    readonly error = signal('');
    readonly allowance = signal<VoiceAllowance | null>(null);
    readonly heard = signal('');
    readonly reply = signal('');
    private pc: RTCPeerConnection | null = null;
    private stream: MediaStream | null = null;
    private audio: HTMLAudioElement | null = null;
    private controller: AbortController | null = null;
    private call: { id: string; conversationId: string | null; owner: string; deadline: number } | null = null;
    private timer: ReturnType<typeof setInterval> | undefined;
    private connectingTimer: ReturnType<typeof setTimeout> | undefined;
    private heartbeatBusy = false;
    private destroyed = false;
    private revision = 0;
    private endPromise: Promise<void> | null = null;
    private allowanceOwner: string | null = null;

    constructor() {
        const stop = () => { void this.end('Voice ended.'); };
        const hidden = () => { if (this.document.hidden) stop(); };
        this.document.addEventListener('visibilitychange', hidden);
        this.document.defaultView?.addEventListener('pagehide', stop);
        effect(() => {
            const owner = this.session.userId(), allowed = this.chat.access.canAct('ai'), demo = this.chat.access.demo();
            const day = this.chat.day(), accounts = JSON.stringify(this.chat.accountIds()), mode = this.tone.mode();
            // A scope/style change ends rather than silently discussing the previous snapshot.
            untracked(() => {
                if (owner !== this.allowanceOwner) { this.allowance.set(null); this.error.set(''); this.allowanceOwner = owner; }
                if (this.call && (owner !== this.call.owner || !allowed || demo || this.scope !== `${day}|${accounts}|${mode}`))
                    void this.end('Voice ended because your account, context or coaching preference changed.');
            });
        });
        inject(DestroyRef).onDestroy(() => {
            this.destroyed = true;
            this.document.removeEventListener('visibilitychange', hidden);
            this.document.defaultView?.removeEventListener('pagehide', stop);
            void this.end();
        });
    }
    private scope = '';

    async start(): Promise<void> {
        if (this.active() || !this.chat.canReply() || !this.configured) return;
        if (!this.supported) { this.notice.set('Voice needs microphone access in a supported HTTPS browser.'); return; }
        const revision = ++this.revision;
        const owner = this.session.userId();
        if (!owner) return;
        this.scope = `${this.chat.day()}|${JSON.stringify(this.chat.accountIds())}|${this.tone.mode()}`;
        this.state.set('connecting'); this.notice.set(''); this.error.set(''); this.heard.set(''); this.reply.set(''); this.muted.set(false); this.remaining.set(180);
        this.chat.voiceActive.set(true); this.coach.voiceConversationActive.set(true);
        this.call = { id: crypto.randomUUID(), conversationId: null, owner, deadline: Date.now() + 35000 };
        this.controller = new AbortController();
        this.connectingTimer = setTimeout(() => { void this.end('Voice connection timed out. Try again.'); }, 30000);
        try {
            // Request only after an explicit click. A late permission grant after Cancel is stopped immediately.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            if (!this.current(revision)) { stream.getTracks().forEach(track => track.stop()); return; }
            this.stream = stream;
            const prepared = await this.chat.prepareVoice(this.controller.signal);
            if (!this.current(revision)) return;
            this.call!.conversationId = prepared.conversationId;
            const pc = this.pc = new RTCPeerConnection();
            this.audio = new Audio(); this.audio.autoplay = true;
            pc.ontrack = event => {
                if (!this.current(revision) || !this.audio) return;
                this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
                void this.audio.play().catch(() => { void this.end('Your browser blocked voice playback. Try starting the call again.'); });
            };
            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
                track.onended = () => { if (this.current(revision)) void this.end('Microphone disconnected.'); };
            });
            pc.onconnectionstatechange = () => {
                if (this.current(revision) && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) void this.end('Voice connection lost. You can continue typing.');
            };
            const channel = pc.createDataChannel('oai-events');
            channel.onmessage = event => { if (this.current(revision)) this.receive(event.data); };
            channel.onopen = () => {
                if (this.current(revision)) { clearTimeout(this.connectingTimer); this.state.set('listening'); }
            };
            const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
            const result = await this.request('start', { ...prepared, sessionId: this.call!.id, sdp: offer.sdp,
                voice: this.coach.preferences().voice, coachingMode: this.tone.mode() }, this.controller.signal);
            if (!this.current(revision)) return;
            if (typeof result['sdp'] !== 'string' || typeof result['deadline'] !== 'number') throw new Error('Invalid voice connection response.');
            this.call!.deadline = result['deadline'];
            this.remaining.set(Math.max(0, Math.ceil((this.call!.deadline - Date.now()) / 1000)));
            await pc.setRemoteDescription({ type: 'answer', sdp: result['sdp'] });
            if (!this.current(revision)) return;
            let ticks = 0;
            this.timer = setInterval(() => {
                if (!this.call) return;
                this.remaining.set(Math.max(0, Math.ceil((this.call.deadline - Date.now()) / 1000)));
                if (this.remaining() <= 0) void this.end('Voice time limit reached. You can continue typing.');
                else if (++ticks % 10 === 0) void this.heartbeat();
            }, 1000);
        } catch (error) {
            if (this.current(revision)) await this.end(error instanceof DOMException && error.name === 'NotAllowedError'
                ? 'Microphone permission was denied. Allow it in your browser, then try again.'
                : error instanceof Error ? error.message : 'Could not start voice. You can still type.', true);
        }
    }

    toggleMute(): void {
        this.muted.update(value => !value);
        this.stream?.getAudioTracks().forEach(track => { track.enabled = !this.muted(); });
    }

    private receive(raw: unknown): void {
        if (typeof raw !== 'string' || raw.length > 100000) return;
        let event;
        try { event = JSON.parse(raw); } catch { return; }
        if (event.type === 'input_audio_buffer.speech_started') { this.state.set('listening'); this.reply.set(''); }
        if (event.type === 'response.created') this.reply.set('');
        if (event.type === 'input_audio_buffer.speech_stopped' || event.type === 'response.created') this.state.set('thinking');
        if (event.type === 'output_audio_buffer.started') this.state.set('speaking');
        if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared') this.state.set('listening');
        if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') this.heard.set(event.transcript.slice(0, 4000));
        if (event.type === 'response.output_audio_transcript.delta' && typeof event.delta === 'string') this.reply.update(text => (text + event.delta).slice(0, 4000));
        if (event.type === 'conversation.item.truncated') this.reply.set('Reply interrupted.');
        if (event.type === 'error') void this.end('Voice encountered an error. You can continue in text chat.');
    }

    private async heartbeat(): Promise<void> {
        if (!this.call || this.heartbeatBusy || this.state() === 'ending') return;
        this.heartbeatBusy = true;
        const id = this.call.id;
        try {
            const result = await this.request('heartbeat', { sessionId: id }, this.controller?.signal);
            if (this.call?.id !== id) return;
            if (result['saving']) this.notice.set('Transcript saving is delayed. Keep this chat to check back.');
            if (result['ended']) await this.end(typeof result['message'] === 'string' ? result['message'] : 'Voice ended. You can continue typing.', this.allowance()?.remainingTokens === 0);
        } catch (error) {
            if (this.call?.id === id) await this.end(error instanceof VoiceRequestError ? error.message : 'Voice connection lost. Please try again.', true);
        }
        finally { this.heartbeatBusy = false; }
    }

    end(message = '', isError = false): Promise<void> {
        // Surface failures before network cleanup/history loading can delay the UI.
        if (isError) { this.error.set(message); message = ''; }
        else if (message) this.notice.set(message);
        if (this.endPromise) return this.endPromise;
        if (!this.call) return Promise.resolve();
        this.endPromise = this.finish(message).finally(() => { this.endPromise = null; });
        return this.endPromise;
    }

    private async finish(message: string): Promise<void> {
        const call = this.call!; this.call = null; ++this.revision;
        this.state.set('ending'); this.controller?.abort(); this.controller = null;
        clearInterval(this.timer);
        clearTimeout(this.connectingTimer);
        this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = null;
        if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.ontrack = null; this.pc.close(); } this.pc = null;
        if (this.audio) { this.audio.pause(); this.audio.srcObject = null; } this.audio = null;
        this.coach.voiceConversationActive.set(false);
        try {
            // No old-user token or chat reload after logout/account switch; server lease still expires.
            if (this.session.userId() === call.owner) {
                const result = await this.request('end', { sessionId: call.id });
                // The provider may close WebRTC before the next heartbeat can explain a quota stop.
                if (this.session.userId() === call.owner && typeof result['message'] === 'string') {
                    if (this.allowance()?.remainingTokens === 0) { this.error.set(result['message']); message = ''; }
                    else if (!this.error()) message = result['message'];
                }
            }
        } catch { message ||= 'Call ended locally. The server will close it automatically; transcript saving may be delayed.'; }
        finally {
            this.chat.voiceActive.set(false); this.state.set('idle'); this.muted.set(false); this.notice.set(message);
            if (!this.destroyed && this.session.userId() === call.owner && call.conversationId === this.chat.conversationId() && call.conversationId)
                await this.chat.open(call.conversationId);
        }
    }

    private current(revision: number): boolean { return !this.destroyed && revision === this.revision && !!this.call; }
    private async request(action: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
        const owner = this.session.userId();
        const { data, error } = await this.auth.getSession();
        if (error || !data.session) throw new Error('Your session expired. Please sign in again.');
        const response = await fetch(`${environment.coachVoiceUrl}/${action}`, { method: 'POST',
            headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            signal: AbortSignal.any([AbortSignal.timeout(action === 'start' ? 25000 : 10000), ...(signal ? [signal] : [])]), keepalive: action === 'end' });
        const result = await response.json().catch(() => null);
        const usage = result?.usage;
        if (owner === this.session.userId() && usage && ['usedTokens', 'remainingTokens', 'limitTokens', 'estimatedTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
            && typeof usage.resetsAt === 'string' && Number.isFinite(Date.parse(usage.resetsAt))) this.allowance.set(usage);
        if (!response.ok) throw new VoiceRequestError(typeof result?.error === 'string' ? result.error : 'Voice is unavailable. Please try again later.');
        return result ?? {};
    }
}
