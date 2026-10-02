import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, OnInit, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UserSessionService } from '../../core/services/user-session.service';
import { AiCoachingSettingsService } from './ai-coaching-settings.service';

@Component({
    selector: 'app-coaching-tone', standalone: true, imports: [RouterLink],
    templateUrl: './coaching-tone.component.html', styleUrl: './coaching-tone.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachingToneComponent implements OnInit {
    readonly settings = inject(AiCoachingSettingsService);
    private readonly session = inject(UserSessionService);
    readonly confirming = signal(false);
    readonly accepted = signal(false);
    private readonly consent = viewChild<ElementRef<HTMLInputElement>>('consent');
    private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('toggle');
    constructor() {
        effect(() => {
            this.session.userId(); this.settings.access.demo();
            untracked(() => { this.confirming.set(false); this.accepted.set(false); });
        });
        effect(() => { if (this.confirming()) this.consent()?.nativeElement.focus(); });
    }
    ngOnInit(): void { void this.settings.load(); }
    async requestToggle(): Promise<void> {
        if (!this.settings.ready() || this.settings.loading() || this.settings.saving()) return;
        if (this.settings.enabled()) { await this.settings.setUnhinged(false); return; }
        if (!this.settings.access.canAct('ai')) return;
        this.accepted.set(false); this.confirming.set(true);
    }
    cancel(): void {
        if (this.settings.saving()) return;
        this.confirming.set(false); this.accepted.set(false); this.toggle()?.nativeElement.focus();
    }
    async confirm(): Promise<void> {
        if (!this.accepted()) return;
        if (await this.settings.setUnhinged(true, true)) this.cancel();
    }
}
