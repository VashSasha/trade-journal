import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { LiveCoachAnswerComponent } from '../live-coach-answer.component';
import { CoachHistoryService } from './coach-history.service';
import { SavedCoachObservation } from './coach-history.model';

@Component({
    selector: 'app-coach-history',
    standalone: true,
    imports: [DatePipe, CurrencyPipe, LiveCoachAnswerComponent],
    templateUrl: './coach-history.component.html',
    styleUrl: './coach-history.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachHistoryComponent implements OnInit {
    readonly history = inject(CoachHistoryService);
    readonly replyEnabled = input(false);
    readonly replyBlocked = input(false);
    readonly replyRequested = output<SavedCoachObservation>();
    readonly confirming = signal<string | null>(null);
    ngOnInit(): void { void this.history.load(); }
    async remove(id: string): Promise<void> {
        if (await this.history.remove(id)) this.confirming.set(null);
    }
}
