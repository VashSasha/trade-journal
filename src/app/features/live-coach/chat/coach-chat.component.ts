import { DatePipe } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, Injector, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LiveCoachAnswerComponent } from '../live-coach-answer.component';
import { LiveCoachService } from '../live-coach.service';
import { CoachChatService } from './coach-chat.service';
import { CoachChatTurn } from './coach-chat.model';
import { LiveCoachObservation } from '../live-coach.models';

// Both payload keys are explicit so template tooling can resolve them without
// narrowing an intersection through a separate `kind` check. Only one is populated.
type ChatEntry =
    | { key: string; time: number; kind: 'observation'; comment: LiveCoachObservation; turn: null }
    | { key: string; time: number; kind: 'turn'; comment: null; turn: CoachChatTurn };

@Component({
    selector: 'app-coach-chat', standalone: true,
    imports: [DatePipe, FormsModule, RouterLink, LiveCoachAnswerComponent],
    templateUrl: './coach-chat.component.html', styleUrl: './coach-chat.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachChatComponent {
    readonly chat = inject(CoachChatService);
    readonly coach = inject(LiveCoachService);
    readonly observations = input<readonly LiveCoachObservation[]>([]);
    readonly following = signal(true);
    readonly timeline = computed<ChatEntry[]>(() => {
        const turns = this.chat.turns();
        const comments = new Map(this.observations().map(comment => [comment.historyId ?? String(comment.id), comment]));
        // Reopening a saved exchange also brings back the original observation it discussed.
        for (const turn of turns) {
            const original = turn.context.replyTo;
            if (original && !comments.has(original.id)) comments.set(original.id, { id: Date.parse(original.observedAt), historyId: original.id,
                time: Date.parse(original.observedAt), title: original.title, text: original.text, personalized: false, snapshot: original.snapshot ?? undefined });
        }
        return [
            ...[...comments.entries()].map(([id, comment]): ChatEntry => ({ key: `observation-${id}`, kind: 'observation', time: comment.time, comment, turn: null })),
            ...turns.map((turn): ChatEntry => ({ key: `turn-${turn.id}`, kind: 'turn', time: Date.parse(turn.created_at), comment: null, turn })),
        ].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
    });
    readonly speechNotice = signal('');
    readonly contextAccounts = computed(() => this.chat.pending() ? this.chat.pending()!.context.accountIds : this.chat.accountIds());
    readonly starters = [
        { label: 'Review my day', message: 'Help me review this session.' },
        { label: 'Check my sizing', message: 'Has my position size been consistent?' },
        { label: 'Plan a session', message: 'Help me plan my next session.' },
    ];
    private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
    private readonly messageInput = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');
    private readonly context = viewChild<ElementRef<HTMLDetailsElement>>('context');
    private readonly injector = inject(Injector);
    constructor() {
        effect(() => {
            const entries = this.timeline(), pending = this.chat.pending();
            if ((!entries.length && !pending) || !untracked(this.following)) return;
            afterNextRender(() => {
                const element = this.scroll()?.nativeElement;
                if (element) element.scrollTop = element.scrollHeight;
            }, { injector: this.injector });
        });
    }
    focusMessage(): void { this.messageInput()?.nativeElement.focus(); }
    reply(comment: LiveCoachObservation): void { this.chat.reply(comment); this.focusMessage(); }
    trackScroll(element: HTMLElement): void { this.following.set(element.scrollHeight - element.scrollTop - element.clientHeight < 80); }
    latest(): void { const element = this.scroll()?.nativeElement; if (element) element.scrollTop = element.scrollHeight; this.following.set(true); }
    send(): void { this.following.set(true); void this.chat.send(); }
    closeContext(event: Event): void {
        const element = this.context()?.nativeElement;
        if (!element?.open) return;
        element.open = false; element.querySelector('summary')?.focus(); event.stopPropagation();
    }
    @HostListener('document:click', ['$event']) closeContextOutside(event: MouseEvent): void {
        const element = this.context()?.nativeElement;
        if (element?.open && !element.contains(event.target as Node)) element.open = false;
    }
    @HostListener('document:focusin', ['$event']) closeContextOnFocus(event: FocusEvent): void {
        const element = this.context()?.nativeElement;
        if (element?.open && !element.contains(event.target as Node)) element.open = false;
    }
    async read(text: string): Promise<void> {
        this.speechNotice.set('');
        try { if (!await this.coach.readChatSummary(text)) this.speechNotice.set('Audio is muted or busy with a live update. Try again when the Coach is quiet.'); }
        catch { this.speechNotice.set('Could not play this summary.'); }
        finally { this.chat.invalidateAllowance(); }
    }
}
