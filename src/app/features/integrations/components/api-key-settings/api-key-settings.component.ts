import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OpenAiService } from '../../../../core/services/openai.service';

/**
 * Self-contained settings widget for the user's Anthropic API key.
 * On web the key is stored server-side via the ai-proxy worker (never persisted
 * in the browser); this widget only ever sends the key once and reads a boolean
 * "configured" status back via OpenAiService.
 */
@Component({
    selector: 'app-api-key-settings',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './api-key-settings.component.html',
    styleUrl: './api-key-settings.component.scss'
})
export class ApiKeySettingsComponent {
    readonly openAi = inject(OpenAiService);

    keyInput = signal('');
    showKey = signal(false);
    saving = signal(false);
    removing = signal(false);
    saved = signal(false);
    error = signal<string | null>(null);

    toggleShow(): void {
        this.showKey.update(v => !v);
    }

    async save(): Promise<void> {
        const key = this.keyInput().trim();
        if (!key) return;

        this.saving.set(true);
        this.error.set(null);
        try {
            await this.openAi.saveApiKey(key);
            this.keyInput.set('');
            this.saved.set(true);
            setTimeout(() => this.saved.set(false), 3000);
        } catch (e: any) {
            this.error.set(e?.message || 'Failed to save key.');
        } finally {
            this.saving.set(false);
        }
    }

    async remove(): Promise<void> {
        this.removing.set(true);
        this.error.set(null);
        try {
            await this.openAi.clearApiKey();
        } catch (e: any) {
            this.error.set(e?.message || 'Failed to remove key.');
        } finally {
            this.removing.set(false);
        }
    }
}
