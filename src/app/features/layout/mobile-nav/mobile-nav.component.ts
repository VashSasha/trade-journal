import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../core/services/auth.service';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { DemoModeService } from '../../../core/services/demo-mode.service';

/** Mobile shell navigation; route guards remain the authority for paid pages. */
@Component({
    selector: 'app-mobile-nav',
    standalone: true,
    imports: [RouterLink, RouterLinkActive],
    templateUrl: './mobile-nav.component.html',
    styleUrl: './mobile-nav.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileNavComponent {
    readonly access = inject(AccessPolicyService);
    readonly demo = inject(DemoModeService);
    readonly auth = inject(AuthService);
    readonly moreOpen = signal(false);
    private readonly router = inject(Router);
    private readonly url = signal(this.router.url);
    readonly moreActive = computed(() => /^\/(account|reports)(\/|[?#]|$)/.test(this.url()));
    private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('moreDialog');

    constructor() {
        const destroyRef = inject(DestroyRef);
        this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
            if (event instanceof NavigationEnd) {
                this.url.set(event.urlAfterRedirects);
                this.closeMore();
            }
        });
        // Don't leave an invisible modal trapping focus after rotating/resizing.
        const desktop = window.matchMedia('(min-width: 701px)');
        const resize = () => { if (desktop.matches) this.closeMore(); };
        desktop.addEventListener('change', resize);
        destroyRef.onDestroy(() => desktop.removeEventListener('change', resize));
    }

    openMore(): void {
        this.dialog().nativeElement.showModal();
        this.moreOpen.set(true);
    }

    closeMore(): void {
        if (!this.moreOpen()) return;
        this.dialog().nativeElement.close();
        this.moreOpen.set(false);
    }

    closeBackdrop(event: MouseEvent): void {
        if (event.target === this.dialog().nativeElement) this.closeMore();
    }

    logout(): void {
        this.closeMore();
        this.auth.logout();
        void this.router.navigate(['/login']);
    }
}
