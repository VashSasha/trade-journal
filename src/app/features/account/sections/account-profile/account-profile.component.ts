import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { AuthService } from '../../../../core/services/auth.service';
import { AccountService } from '../../account.service';

/** Profile section: edit display name, view email (read-only), avatar + plan. */
@Component({
    selector: 'app-account-profile',
    standalone: true,
    imports: [FormsModule, TitleCasePipe],
    templateUrl: './account-profile.component.html',
    styleUrl: './account-profile.component.scss'
})
export class AccountProfileComponent {
    private auth = inject(AuthService);
    private account = inject(AccountService);

    readonly user = this.auth.currentUser;

    displayName = signal('');
    saving = signal(false);
    saveError = signal<string | null>(null);
    saved = signal(false);

    private seeded = false;

    constructor() {
        // Seed the input from the current name once it's available; don't
        // clobber an in-progress edit.
        effect(() => {
            const u = this.user();
            if (u && !this.seeded) {
                this.displayName.set(u.name);
                this.seeded = true;
            }
        });
    }

    async save(): Promise<void> {
        const name = this.displayName().trim();
        if (!name) {
            this.saveError.set('Display name cannot be empty.');
            return;
        }
        this.saving.set(true);
        this.saveError.set(null);
        this.saved.set(false);
        try {
            await this.account.updateDisplayName(name);
            this.saved.set(true);
            setTimeout(() => this.saved.set(false), 2500);
        } catch (err: any) {
            this.saveError.set(err?.message || 'Could not save your name. Please try again.');
        } finally {
            this.saving.set(false);
        }
    }
}
