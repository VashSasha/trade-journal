import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'app-landing-hero',
    standalone: true,
    imports: [],
    templateUrl: './landing-hero.component.html',
    styleUrl: './landing-hero.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingHeroComponent {
    /**
     * PLACEHOLDER — replace with the real Discord member count before deploy.
     * Kept as a literal token (never an invented number).
     */
    readonly membersPlaceholder = '1';
}
