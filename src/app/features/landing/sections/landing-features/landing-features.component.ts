import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-landing-features',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './landing-features.component.html',
    styleUrl: './landing-features.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingFeaturesComponent {}
