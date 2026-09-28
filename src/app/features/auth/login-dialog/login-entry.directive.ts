import { Directive, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { safeAuthReturnUrl } from '../auth-return-url';
import { LoginDialogService } from './login-dialog.service';

/** Real href for new-tab/modified clicks; ordinary clicks use the landing dialog. */
@Directive({
    selector: 'a[appLoginEntry]',
    standalone: true,
    host: { '[attr.href]': 'href()', '(click)': 'open($event)' },
})
export class LoginEntryDirective {
    private readonly dialog = inject(LoginDialogService, { optional: true });
    private readonly router = inject(Router);
    readonly loginReturnUrl = input('/dashboard');
    readonly href = computed(() => this.router.serializeUrl(this.router.createUrlTree(['/login'], {
        queryParams: { returnUrl: safeAuthReturnUrl(this.loginReturnUrl()) },
    })));

    open(event: MouseEvent): void {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (this.dialog) this.dialog.open(this.loginReturnUrl());
        else void this.router.navigateByUrl(this.href());
    }
}
