import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LandingProductPreviewComponent } from '../landing-product-preview/landing-product-preview.component';

@Component({
    selector: 'app-landing-hero',
    standalone: true,
    imports: [RouterLink, LandingProductPreviewComponent],
    templateUrl: './landing-hero.component.html',
    styleUrl: './landing-hero.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingHeroComponent {}
