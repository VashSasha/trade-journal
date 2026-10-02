import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal, viewChild } from '@angular/core';
import { ALERT_SOUND_PRESETS, AlertSoundSelection } from './alert-sound-library';
import { AlertSoundKind } from './session-alerts.utils';
import { SessionAlertsService } from './session-alerts.service';

/** Two distinct actions per option: audition it, or select it. No implicit saves. */
@Component({
    selector: 'app-alert-sound-picker', standalone: true,
    templateUrl: './alert-sound-picker.component.html',
    styleUrl: './alert-sound-picker.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertSoundPickerComponent {
    readonly kind = input.required<AlertSoundKind>();
    readonly label = input.required<string>();
    readonly value = input.required<AlertSoundSelection>();
    readonly uploadedName = input<string | null>(null);
    readonly legacyUploadName = input<string | null>(null);
    readonly disabled = input(false);
    readonly changed = output<AlertSoundSelection>();
    readonly open = signal(false);
    readonly above = signal(false);
    readonly sounds = inject(SessionAlertsService);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
    readonly presets = ALERT_SOUND_PRESETS;

    selectedName(): string {
        if (this.value() === 'silent') return 'Silent';
        if (this.value() === 'inherit') return this.legacyUploadName() ?? 'Upload unavailable';
        if (this.value() === 'default') return 'Default NVZN bell';
        if (this.value() === 'custom') return this.uploadedName() ?? 'Upload unavailable';
        return ALERT_SOUND_PRESETS.find(preset => preset.id === this.value())?.name ?? 'Default NVZN bell';
    }

    toggle(): void {
        if (this.disabled()) return;
        const rect = this.host.nativeElement.getBoundingClientRect();
        const viewHeight = this.host.nativeElement.ownerDocument.defaultView?.innerHeight ?? 800;
        this.above.set(viewHeight - rect.bottom < 380 && rect.top > viewHeight - rect.bottom);
        this.open.update(open => !open);
        if (this.open()) queueMicrotask(() => this.host.nativeElement.querySelector<HTMLButtonElement>('.sound-picker__choice')?.focus());
    }

    select(value: AlertSoundSelection): void {
        if (this.disabled()) return;
        this.changed.emit(value);
        this.close(true);
    }

    preview(value: AlertSoundSelection): void { void this.sounds.preview(this.kind(), value); }
    close(restoreFocus = false): void {
        if (!this.open()) return;
        this.open.set(false);
        if (restoreFocus) this.trigger()?.nativeElement.focus();
    }
@HostListener('document:click', ['$event'])
    outsideClick(event: Event): void {
        if (event.target instanceof Node && !this.host.nativeElement.contains(event.target)) this.close();
    }
    @HostListener('keydown.escape', ['$event'])
    onEscape(event: KeyboardEvent): void { this.close(true); event.stopPropagation(); }
    @HostListener('focusout', ['$event'])
    focusLeft(event: FocusEvent): void {
        if (event.relatedTarget instanceof Node && !this.host.nativeElement.contains(event.relatedTarget)) this.close();
    }
}
