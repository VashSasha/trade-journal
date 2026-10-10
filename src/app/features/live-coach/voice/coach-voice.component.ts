import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, signal } from '@angular/core';
import { CoachChatService } from '../chat/coach-chat.service';
import { CoachVoiceService } from './coach-voice.service';

let nextTooltipId = 0;

@Component({
    selector: 'app-coach-voice', standalone: true,
    templateUrl: './coach-voice.component.html', styleUrl: './coach-voice.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachVoiceComponent {
    readonly voice = inject(CoachVoiceService);
    readonly chat = inject(CoachChatService);
    private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly checkedAt = signal(Date.now());
    readonly tooltipOpen = signal(false);
    readonly tooltipId = `coach-voice-tip-${++nextTooltipId}`;
    readonly unavailable = computed(() => {
        if (!this.voice.configured) return 'Voice conversations aren’t available in this environment yet.';
        if (!this.voice.supported) return 'Voice needs a browser with microphone support on HTTPS or localhost.';
        if (this.chat.access.demo()) return 'Leave demo mode to start a voice conversation.';
        if (!this.chat.access.canAct('ai')) return 'Voice conversations require Premium+ or AI access.';
        const usage = this.voice.allowance();
        if (usage?.remainingTokens === 0 && Date.parse(usage.resetsAt) > this.checkedAt()) {
            return `Daily voice allowance reached. Resets at 00:00 UTC on ${usage.resetsAt.slice(0, 10)}. You can still type.`;
        }
        if (this.chat.loading()) return 'Wait for this chat to finish loading.';
        if (this.chat.loadFailed()) return 'Retry loading this chat before starting voice.';
        if (this.chat.deleting()) return 'Wait for the chat to finish deleting.';
        if (this.chat.pending() || this.chat.busy()) return 'Finish or dismiss the current text reply before starting voice.';
        return this.chat.canReply() ? '' : 'Voice is unavailable right now. Sign in or reopen the chat.';
    });
    readonly tooltip = computed(() => {
        if (this.unavailable()) return this.unavailable();
        const usage = this.voice.allowance();
        const remaining = usage && Date.parse(usage.resetsAt) > this.checkedAt()
            ? ` ${usage.remainingTokens.toLocaleString()} tokens left today.` : '';
        return `Start voice conversation.${remaining} Audio goes to OpenAI; transcripts save in this chat.`;
    });
    readonly status = computed(() => {
        const state = this.voice.state();
        if (state === 'connecting') return 'Connecting…';
        if (state === 'ending') return 'Ending…';
        if (this.voice.muted()) return 'Mic muted';
        return state === 'speaking' ? 'Speaking' : state === 'thinking' ? 'Thinking…' : 'Listening';
    });
    readonly timeLeft = computed(() => `${Math.floor(this.voice.remaining() / 60)}:${String(this.voice.remaining() % 60).padStart(2, '0')}`);

    showTooltip(): void { this.checkedAt.set(Date.now()); this.tooltipOpen.set(true); }
    start(): void {
        this.checkedAt.set(Date.now());
        if (this.unavailable()) { this.tooltipOpen.set(true); return; }
        this.tooltipOpen.set(false);
        void this.voice.start();
    }
    @HostListener('keydown.escape', ['$event']) dismissTooltip(event: Event): void {
        if (this.tooltipOpen()) { this.tooltipOpen.set(false); event.stopPropagation(); }
    }
    @HostListener('document:pointerdown', ['$event']) closeOutside(event: PointerEvent): void {
        if (!this.element.nativeElement.contains(event.target as Node)) this.tooltipOpen.set(false);
    }
}
