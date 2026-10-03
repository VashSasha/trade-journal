import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { OnboardingService } from './onboarding.service';

@Component({
    selector: 'app-getting-started',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './getting-started.component.html',
    styleUrl: './getting-started.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GettingStartedComponent {
    readonly compact = input(false);
    readonly embedded = input(false);
    readonly setup = inject(OnboardingService);
    readonly access = inject(AccessPolicyService);

    review(field: 'accountsReviewed' | 'templatesReviewed' | 'alertsReviewed' | 'journalReviewed', event: Event): void {
        const checkbox = event.target as HTMLInputElement;
        const checked = checkbox.checked;
        // Keep the control truthful while saving, including on failure.
        checkbox.checked = this.setup.progress()[field];
        void this.setup.update({ started: true, [field]: checked });
    }
}
