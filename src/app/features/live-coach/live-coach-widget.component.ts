import { DatePipe } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, output, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { MarketPanelService } from '../market-events/market-panel.service';
import { LiveCoachService } from './live-coach.service';
import { LiveCoachVoiceSelectComponent } from './live-coach-voice-select.component';
import { LiveCoachFollowUpComponent } from './live-coach-follow-up.component';
import { LiveCoachFollowUpService } from './live-coach-follow-up.service';

@Component({
    selector: 'app-live-coach-widget',
    standalone: true,
    imports: [DatePipe, RouterLink, LiveCoachVoiceSelectComponent, LiveCoachFollowUpComponent],
    providers: [LiveCoachFollowUpService],
    templateUrl: './live-coach-widget.component.html',
    styleUrl: './live-coach-widget.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveCoachWidgetComponent {
    readonly coach = inject(LiveCoachService);
    readonly access = inject(AccessPolicyService);
    readonly market = inject(MarketPanelService);
    private readonly session = inject(UserSessionService);
    private readonly injector = inject(Injector);
    private readonly launcher = viewChild<ElementRef<HTMLButtonElement>>('launcher');
    private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
    readonly expandedChange = output<boolean>();
    readonly open = signal(false);
    readonly settings = signal(false);
    private readonly seen = signal(0);
    readonly available = computed(() => !!this.session.userId() && this.access.canAct('sync'));
    readonly comments = computed(() => this.available() && !this.access.demo() ? this.coach.recentComments() : []);
    readonly unread = computed(() => this.comments().filter(comment => comment.id > this.seen()).length);
    readonly status = computed(() => {
        if (this.access.demo()) return 'Demo preview';
        if (!this.available()) return 'Upgrade to enable';
        if (this.coach.preferencesLoading()) return 'Loading preferences';
        if (!this.coach.preferences().enabled) return 'Coach is off';
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
        effect(() => {
            this.session.userId();
            this.access.demo();
            untracked(() => { this.close(false); this.seen.set(0); });
        });
        effect(() => {
            if (this.market.open() || this.access.promptReason()) untracked(() => this.close(false));
        });
        effect(() => {
            if (this.open()) this.seen.set(this.comments()[0]?.id ?? 0);
            this.expandedChange.emit(this.open());
        });
    }

    toggle(): void {
        if (this.open()) { this.close(); return; }
        this.open.set(true);
        afterNextRender(() => { if (this.open()) this.closeButton()?.nativeElement.focus(); }, { injector: this.injector });
    }

    close(restoreFocus = true): void {
        const wasOpen = this.open();
        this.open.set(false);
        this.settings.set(false);
        if (wasOpen && restoreFocus) this.launcher()?.nativeElement.focus();
    }

    toggleCoach(): void {
        if (this.available()) this.coach.setEnabled(!this.coach.preferences().enabled);
    }

    toggleVoice(): void {
        if (this.available()) this.coach.setVoiceEnabled(!this.coach.preferences().voiceEnabled);
    }
}
