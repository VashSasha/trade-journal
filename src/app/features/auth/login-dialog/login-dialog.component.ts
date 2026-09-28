import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LoginComponent } from '../login/login';
import { LoginDialogService } from './login-dialog.service';

@Component({
    selector: 'app-login-dialog',
    standalone: true,
    imports: [LoginComponent],
    templateUrl: './login-dialog.component.html',
    styleUrl: './login-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginDialogComponent {
    readonly state = inject(LoginDialogService);
    private readonly auth = inject(AuthService);
    private readonly router = inject(Router);
    private readonly document = inject(DOCUMENT);
    private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
    private previousOverflow: string | null = null;

    constructor() {
        effect(() => {
            const request = this.state.request();
            const dialog = this.dialog()?.nativeElement;
            if (!dialog) return;
            if (request) {
                if (this.auth.isAuthenticated()) {
                    this.state.close();
                    void this.router.navigateByUrl(request.returnUrl);
                    return;
                }
                if (!dialog.open) {
                    dialog.showModal();
                    this.previousOverflow = this.document.documentElement.style.overflow;
                    this.document.documentElement.style.overflow = 'hidden';
                }
            } else {
                if (dialog.open) dialog.close();
                this.unlockScroll();
            }
        });
        inject(DestroyRef).onDestroy(() => {
            const dialog = this.dialog()?.nativeElement;
            if (dialog?.open) dialog.close();
            this.unlockScroll();
        });
    }

    closeBackdrop(event: MouseEvent): void {
        if (event.target === this.dialog()?.nativeElement) this.state.close();
    }

    onClosed(): void {
        // A queued close event from a previous opening must not dismiss a newly opened dialog.
        if (!this.dialog()?.nativeElement.open) this.state.close();
    }

    containTab(event: KeyboardEvent): void {
        if (event.key !== 'Tab') return;
        const dialog = this.dialog()?.nativeElement;
        if (!dialog?.open) return;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        )).filter(element => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        // Native dialogs may tab into browser chrome at the edges; keep this short flow together.
        if (event.shiftKey && this.document.activeElement === first && last) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && this.document.activeElement === last && first) {
            event.preventDefault();
            first.focus();
        }
    }

    private unlockScroll(): void {
        if (this.previousOverflow === null) return;
        this.document.documentElement.style.overflow = this.previousOverflow;
        this.previousOverflow = null;
    }
}
