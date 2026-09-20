import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { LiveCoachObservation, LiveCoachQuestion } from './live-coach.models';
import { LiveCoachFollowUpService } from './live-coach-follow-up.service';
import { COACH_QUESTIONS, coachQuestions } from './live-coach-follow-up.utils';

@Component({
    selector: 'app-live-coach-follow-up',
    standalone: true,
    imports: [DatePipe],
    templateUrl: './live-coach-follow-up.component.html',
    styleUrl: './live-coach-follow-up.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveCoachFollowUpComponent {
    readonly comment = input.required<LiveCoachObservation>();
    readonly followUps = inject(LiveCoachFollowUpService);
    readonly access = inject(AccessPolicyService);
    readonly labels = COACH_QUESTIONS;
    readonly questions = computed(() => coachQuestions(this.comment()));
    readonly selected = signal<LiveCoachQuestion | null>(null);
    readonly current = computed(() => this.selected() ? this.followUps.state(this.comment().id, this.selected()!) : undefined);

    select(question: LiveCoachQuestion): void {
        if (question === this.selected()) { this.selected.set(null); return; }
        this.selected.set(question);
        void this.followUps.ask(this.comment().id, question);
    }

    retry(): void {
        if (this.selected()) void this.followUps.ask(this.comment().id, this.selected()!);
    }
}
