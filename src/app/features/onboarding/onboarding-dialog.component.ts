import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, untracked, viewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DemoModeService } from '../../core/services/demo-mode.service';
import { GettingStartedComponent } from './getting-started.component';
import { OnboardingService } from './onboarding.service';

@Component({
    selector: 'app-onboarding-dialog',
    standalone: true,
    imports: [GettingStartedComponent],
    templateUrl: './onboarding-dialog.component.html',
    styleUrl: './onboarding-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingDialogComponent {
    readonly setup = inject(OnboardingService);
    private readonly demo = inject(DemoModeService);
    private readonly router = inject(Router);
    private readonly document = inject(DOCUMENT);
    private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
    private previousOverflow: string | null = null;

    constructor() {
        effect(() => {
            if (this.setup.shouldOfferGuide() && !this.demo.transitioning()
                && !this.router.url.startsWith('/account/getting-started')) {
                untracked(() => this.setup.openGuide());
            }
        });
        effect(() => {
            const open = this.setup.dialogOpen();
            const dialog = this.dialog()?.nativeElement;
            if (!dialog) return;
            if (open && !dialog.open) {
                dialog.showModal();
                this.previousOverflow = this.document.documentElement.style.overflow;
                this.document.documentElement.style.overflow = 'hidden';
            } else if (!open) {
                if (dialog.open) dialog.close();
                this.unlockScroll();
            }
        });
        this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
            if (event instanceof NavigationEnd) this.setup.closeGuide(false);
        });
        inject(DestroyRef).onDestroy(() => {
            if (this.dialog()?.nativeElement.open) this.dialog()?.nativeElement.close();
            this.unlockScroll();
        });
    }

    closeBackdrop(event: MouseEvent): void {
        if (event.target === this.dialog()?.nativeElement) this.setup.closeGuide();
    }

    onClosed(): void {
        if (!this.dialog()?.nativeElement.open) this.setup.closeGuide();
    }

    followLink(event: MouseEvent): void {
        if ((event.target as HTMLElement).closest('a[href]')) this.setup.closeGuide(false);
    }

    exploreDemo(): void {
        this.setup.closeGuide();
        void this.demo.enter();
    }

    private unlockScroll(): void {
        if (this.previousOverflow === null) return;
        this.document.documentElement.style.overflow = this.previousOverflow;
        this.previousOverflow = null;
    }
}
