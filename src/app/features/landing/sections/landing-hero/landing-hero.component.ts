import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'app-landing-hero',
    standalone: true,
    imports: [],
    templateUrl: './landing-hero.component.html',
    styleUrl: './landing-hero.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingHeroComponent {}
