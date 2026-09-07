import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AlertAudioService } from './alert-audio.service';
import { CustomAlertSoundMetadata } from './custom-alert-sounds.models';
import { SessionAlertsService } from './session-alerts.service';
import { AlertSoundKind } from './session-alerts.utils';

interface SoundOption {
    kind: AlertSoundKind;
    label: string;
    detail: string;
}

@Component({
    selector: 'app-custom-alert-sound-controls',
    standalone: true,
    templateUrl: './custom-alert-sound-controls.component.html',
    styleUrl: './custom-alert-sound-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomAlertSoundControlsComponent {
    readonly audio = inject(AlertAudioService);
    readonly sounds = inject(SessionAlertsService);
    readonly uploading = signal<AlertSoundKind | null>(null);
    readonly removing = signal<AlertSoundKind | null>(null);
    readonly error = signal<string | null>(null);
    readonly message = signal<string | null>(null);
    readonly busy = computed(() => this.uploading() !== null || this.removing() !== null);
    readonly options: readonly SoundOption[] = [
        { kind: 'open', label: 'Session opening', detail: 'When a reference session starts' },
        { kind: 'close', label: 'Session closing', detail: 'When a reference session ends' },
        { kind: 'target', label: 'Target reached', detail: 'Daily or weekly profit milestones' },
        { kind: 'risk', label: 'Risk warning', detail: 'Loss, overtrading, and market-event warnings' },
    ];
    readonly acceptedAudio = '.mp3,.wav,.ogg,.oga,.webm,.m4a,.aac,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/aac';

    custom(kind: AlertSoundKind): CustomAlertSoundMetadata | null {
        return this.audio.customSounds()[kind];
    }

    async chooseFile(kind: AlertSoundKind, event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || this.busy() || this.audio.customSoundsLoading()) return;
        this.uploading.set(kind);
        this.error.set(null);
        this.message.set(null);
        try {
            const saved = await this.audio.installCustomSound(kind, file);
            this.message.set(`${saved.name} is now used for ${this.option(kind).label.toLowerCase()} alerts.`);
            await this.sounds.preview(kind);
        } catch (error) {
            this.error.set(error instanceof Error ? error.message : 'The custom sound could not be saved.');
        } finally {
            this.uploading.set(null);
        }
    }

    async reset(kind: AlertSoundKind): Promise<void> {
        if (this.busy() || this.audio.customSoundsLoading()) return;
        this.removing.set(kind);
        this.error.set(null);
        this.message.set(null);
        try {
            await this.audio.removeCustomSound(kind);
            this.message.set(`${this.option(kind).label} restored to the built-in sound.`);
        } catch (error) {
            this.error.set(error instanceof Error ? error.message : 'The custom sound could not be removed.');
        } finally {
            this.removing.set(null);
        }
    }

    test(kind: AlertSoundKind): void {
        if (!this.busy() && !this.audio.customSoundsLoading()) void this.sounds.preview(kind);
    }

    fileDetails(sound: CustomAlertSoundMetadata): string {
        const kilobytes = Math.max(1, Math.round(sound.size / 1024));
        return `${sound.duration.toFixed(1)} sec · ${kilobytes} KB`;
    }

    private option(kind: AlertSoundKind): SoundOption {
        return this.options.find(option => option.kind === kind)!;
    }
}
