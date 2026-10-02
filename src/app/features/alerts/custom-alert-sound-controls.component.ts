import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AlertAudioService } from './alert-audio.service';
import { CustomAlertSoundMetadata } from './custom-alert-sounds.models';
import { SessionAlertsService } from './session-alerts.service';
import { AlertSoundKind } from './session-alerts.utils';
import { ALERT_SOUND_PRESETS, AlertSoundSelection, isAlertSoundSelection, resolveSoundSelection } from './alert-sound-library';
import { AlertSoundPickerComponent } from './alert-sound-picker.component';
import { ALERT_SOUND_OPTIONS, SOUND_FALLBACKS } from './alert-sound-kinds';

interface SoundOption {
    kind: AlertSoundKind;
    label: string;
    detail: string;
}

@Component({
    selector: 'app-custom-alert-sound-controls',
    standalone: true,
    imports: [AlertSoundPickerComponent],
    templateUrl: './custom-alert-sound-controls.component.html',
    styleUrl: './custom-alert-sound-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'data-sound-controls': '' },
})
export class CustomAlertSoundControlsComponent {
    readonly audio = inject(AlertAudioService);
    readonly sounds = inject(SessionAlertsService);
    readonly uploading = signal<AlertSoundKind | null>(null);
    readonly removing = signal<AlertSoundKind | null>(null);
    readonly error = signal<string | null>(null);
    readonly message = signal<string | null>(null);
    readonly busy = computed(() => this.uploading() !== null || this.removing() !== null);
    readonly options = ALERT_SOUND_OPTIONS;
    readonly acceptedAudio = '.mp3,.wav,.ogg,.oga,.webm,.m4a,.aac,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/aac';

    custom(kind: AlertSoundKind): CustomAlertSoundMetadata | null {
        return this.audio.customSounds()[kind];
    }

    selection(kind: AlertSoundKind): AlertSoundSelection {
        const resolved = this.resolvedSound(kind);
        // Only legacy uploads need their original storage key to audition/select.
        return resolved.selection === 'custom' && resolved.kind !== kind ? 'inherit' : resolved.selection;
    }

    legacyUploadName(kind: AlertSoundKind): string | null {
        const fallback = SOUND_FALLBACKS[kind];
        if (!fallback) return null;
        const resolved = this.resolvedSound(fallback);
        return resolved.selection === 'custom' ? this.custom(resolved.kind)?.name ?? null : null;
    }

    private resolvedSound(kind: AlertSoundKind) {
        return resolveSoundSelection(kind, this.sounds.preferences().selections, key => !!this.custom(key));
    }

    selectionDetail(kind: AlertSoundKind): string {
        const { selection, kind: source } = this.resolvedSound(kind);
        if (selection === 'silent') return 'No sound for this trigger';
        if (selection === 'custom') {
            const file = this.custom(source);
            return file ? this.fileDetails(file) : 'Upload unavailable; using the default bell';
        }
        if (selection === 'default') return 'Original NVZN bell';
        const preset = ALERT_SOUND_PRESETS.find(sound => sound.id === selection);
        return preset ? `${preset.seconds.toFixed(1)} sec · Library sound` : '';
    }

    chooseSound(kind: AlertSoundKind, selection: AlertSoundSelection): void {
        if (this.busy() || this.sounds.preferencesLoading() || !isAlertSoundSelection(selection)) return;
        if (selection === 'custom' && !this.custom(kind)) return;
        if (selection === 'inherit' && !this.legacyUploadName(kind)) return;
        this.sounds.setSound(kind, selection);
        this.error.set(null);
        this.message.set(null);
    }

    async chooseFile(kind: AlertSoundKind, event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || this.busy() || this.audio.customSoundsLoading() || this.sounds.preferencesLoading()) return;
        this.uploading.set(kind);
        this.error.set(null);
        this.message.set(null);
        try {
            const saved = await this.audio.installCustomSound(kind, file);
            this.sounds.setSound(kind, 'custom');
            this.message.set(`${saved.name} is now used for ${this.option(kind).label.toLowerCase()} alerts.`);
            if (this.sounds.enabled()) await this.sounds.preview(kind);
        } catch (error) {
            this.error.set(error instanceof Error ? error.message : 'The custom sound could not be saved.');
        } finally {
            this.uploading.set(null);
        }
    }

    async reset(kind: AlertSoundKind): Promise<void> {
        if (this.busy() || this.audio.customSoundsLoading() || this.sounds.preferencesLoading()) return;
        this.removing.set(kind);
        this.error.set(null);
        this.message.set(null);
        try {
            const wasSelected = this.selection(kind) === 'custom';
            await this.audio.removeCustomSound(kind);
            if (wasSelected) this.sounds.setSound(kind, 'silent');
            this.message.set(`Uploaded sound removed.${wasSelected ? ' This alert is now silent.' : ' Your sound selection is unchanged.'}`);
        } catch (error) {
            this.error.set(error instanceof Error ? error.message : 'The custom sound could not be removed.');
        } finally {
            this.removing.set(null);
        }
    }

    test(kind: AlertSoundKind): void {
        if (this.selection(kind) !== 'silent' && !this.busy() && !this.audio.customSoundsLoading()) void this.sounds.preview(kind);
    }

    fileDetails(sound: CustomAlertSoundMetadata): string {
        const kilobytes = Math.max(1, Math.round(sound.size / 1024));
        return `${sound.duration.toFixed(1)} sec · ${kilobytes} KB`;
    }

    private option(kind: AlertSoundKind): SoundOption {
        return this.options.find(option => option.kind === kind)!;
    }
}
