import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'app-landing-integrations',
    standalone: true,
    templateUrl: './landing-integrations.component.html',
    styleUrl: './landing-integrations.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingIntegrationsComponent {}
