import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, output, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { MarketPanelService } from '../market-events/market-panel.service';
import { LiveCoachService } from './live-coach.service';
import { LiveCoachVoiceSelectComponent } from './live-coach-voice-select.component';
import { LiveCoachFollowUpService } from './live-coach-follow-up.service';
import { CoachHistoryService } from './history/coach-history.service';
import { CoachHistoryComponent } from './history/coach-history.component';
import { CoachChatComponent } from './chat/coach-chat.component';
import { CoachChatService } from './chat/coach-chat.service';
import { AiCoachingBadgeComponent } from '../ai-settings/ai-coaching-badge.component';
import { CoachActionsComponent, CoachView } from './coach-actions.component';
import { historyToObservation, SavedCoachObservation } from './history/coach-history.model';

@Component({
    selector: 'app-live-coach-widget',
    standalone: true,
    imports: [RouterLink, LiveCoachVoiceSelectComponent, CoachHistoryComponent, CoachChatComponent, CoachActionsComponent, AiCoachingBadgeComponent],
    providers: [LiveCoachFollowUpService, CoachChatService],
    templateUrl: './live-coach-widget.component.html',
    styleUrl: './live-coach-widget.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveCoachWidgetComponent {
    readonly coach = inject(LiveCoachService);
    readonly history = inject(CoachHistoryService);
    readonly chat = inject(CoachChatService);
    readonly access = inject(AccessPolicyService);
    readonly market = inject(MarketPanelService);
    private readonly session = inject(UserSessionService);
    private readonly injector = inject(Injector);
    private readonly launcher = viewChild<ElementRef<HTMLButtonElement>>('launcher');
    private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
    readonly expandedChange = output<boolean>();
    readonly open = signal(false);
    // Keep the current content mounted through the short closing transition.
    readonly rendered = signal(false);
    private closeTimer: ReturnType<typeof setTimeout> | undefined;
    readonly view = signal<CoachView>('chat');
    readonly enlarged = signal(false);
    readonly heading = computed(() => ({ chat: this.chat.conversationTitle() ?? 'Live Coach', history: 'Coaching history', settings: 'Coach settings' })[this.view()]);
    private readonly seen = signal(0);
    readonly available = computed(() => !!this.session.userId() && this.access.canAct('sync'));
    readonly comments = computed(() => this.available() && !this.access.demo()
        ? this.coach.recentComments().filter(comment => !comment.historyId || !this.history.removed().has(comment.historyId)) : []);
    readonly unread = computed(() => this.comments().filter(comment => comment.id > this.seen()).length);
    readonly status = computed(() => {
        if (this.access.demo()) return 'Demo preview';
        if (!this.available()) return 'Upgrade to enable';
        if (this.coach.preferencesLoading()) return 'Loading preferences';
        if (!this.coach.preferences().enabled) return 'Automatic coaching off';
        if (this.coach.liveState() !== 'live') return this.coach.liveStatus();
        if (this.coach.aiState() === 'thinking') return 'Preparing an observation';
        if (this.coach.narratorState() === 'speaking' && !this.coach.paused()) return 'Speaking';
        return this.coach.paused() ? 'Monitoring · Text only' : 'Monitoring';
    });
    readonly warning = computed(() => {
        if (!this.available()) return null;
        if (this.coach.syncWarning()) return 'Settings could not sync. This browser will retry when online.';
        if (this.coach.storageWarning()) return 'This browser could not save a local copy of your settings.';
        if (this.coach.aiState() === 'fallback') return 'AI commentary is unavailable. Showing factual position updates.';
        if (!this.coach.paused()) return this.coach.voiceWarning() || this.coach.error()
            || (this.coach.voiceFallback() ? 'AI audio could not play. Using the browser voice.' : null);
        return null;
    });

    constructor() {
        inject(DestroyRef).onDestroy(() => this.cancelClose());
        effect(() => {
            this.session.userId();
            this.access.demo();
            untracked(() => { this.close(false); this.seen.set(0); this.enlarged.set(false); });
        });
        effect(() => {
            if (this.market.open() || this.access.promptReason()) untracked(() => this.close(false));
        });
        effect(() => {
            if (this.open() && this.view() === 'chat') this.seen.set(this.comments()[0]?.id ?? 0);
            this.expandedChange.emit(this.open());
        });
    }

    toggle(): void {
        if (this.open()) { this.close(); return; }
        this.cancelClose();
        this.rendered.set(true);
        this.open.set(true);
        void this.chat.resume();
        afterNextRender(() => { if (this.open()) this.closeButton()?.nativeElement.focus(); }, { injector: this.injector });
    }

    replyToSaved(item: SavedCoachObservation): void {
        if (this.chat.reply(historyToObservation(item), item.trade_date)) this.view.set('chat');
    }

    close(restoreFocus = true): void {
        const wasOpen = this.open();
        this.cancelClose();
        this.open.set(false);
        if (wasOpen && restoreFocus) this.launcher()?.nativeElement.focus();
        // Privacy/navigation closes are immediate; never animate a previous user's content.
        if (!wasOpen || !restoreFocus || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            this.finishClose();
        } else {
            this.closeTimer = setTimeout(() => this.finishClose(), 180); // Matches the panel's toggle transition.
        }
    }

    private finishClose(): void {
        this.closeTimer = undefined;
        this.rendered.set(false);
        this.view.set('chat');
    }

    private cancelClose(): void { clearTimeout(this.closeTimer); this.closeTimer = undefined; }
}
