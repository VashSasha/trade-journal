import { ALERT_SOUND_KINDS, AlertSoundKind, SOUND_FALLBACKS } from './alert-sound-kinds';

/** Public, versioned assets. Only selected clips are fetched by the audio engine. */
export const ALERT_SOUND_PRESETS = [
    { id: 'stock-market-bell', name: 'Stock market bell', group: 'Bells', seconds: 4.5 },
    { id: 'thinkorswim-bell', name: 'Thinkorswim bell', group: 'Bells', seconds: 3.1 },
    { id: 'happy-whistle', name: 'Happy whistle', group: 'Reactions', seconds: 8.1 },
    { id: 'hell-yeah', name: 'Hell yeah', group: 'Reactions', seconds: 2.7 },
    { id: 'oh-no', name: 'Oh no', group: 'Reactions', seconds: 2.7 },
    { id: 'come-on-man', name: 'Come on, man', group: 'Voices', seconds: 1.2 },
    { id: 'female-voice', name: 'Female voice', group: 'Voices', seconds: 1.1 },
    { id: 'game-over', name: 'Game over', group: 'Voices', seconds: 2.1 },
    { id: 'no-more-running', name: 'No more running', group: 'Demon voices', seconds: 2.2 },
    { id: 'demonic-laughter', name: 'Demonic laughter', group: 'Demon voices', seconds: 3.3 },
] as const;

export type AlertSoundPresetId = typeof ALERT_SOUND_PRESETS[number]['id'];
export type AlertSoundSelection = 'default' | 'custom' | 'silent' | 'inherit' | AlertSoundPresetId;
export type AlertSoundSelections = Partial<Record<AlertSoundKind, AlertSoundSelection>>;

export function isAlertSoundPreset(value: unknown): value is AlertSoundPresetId {
    return ALERT_SOUND_PRESETS.some(preset => preset.id === value);
}

export function isAlertSoundSelection(value: unknown): value is AlertSoundSelection {
    return value === 'default' || value === 'custom' || value === 'silent' || value === 'inherit' || isAlertSoundPreset(value);
}

export function normalizeSoundSelections(value: unknown): AlertSoundSelections | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const selections: AlertSoundSelections = {};
    for (const kind of ALERT_SOUND_KINDS) {
        const choice = (value as Record<string, unknown>)[kind];
        if (Object.hasOwn(value, kind) && isAlertSoundSelection(choice)) selections[kind] = choice;
    }
    return Object.keys(selections).length ? selections : undefined;
}

export function soundSelection(kind: AlertSoundKind, selections: AlertSoundSelections | undefined, hasUpload: boolean): AlertSoundSelection {
    // Retain explicit choices and existing uploads; an unconfigured cue is opt-in.
    return selections?.[kind] ?? (hasUpload ? 'custom' : SOUND_FALLBACKS[kind] ? 'inherit' : 'silent');
}

/** Resolve legacy shared choices without rewriting preferences or copying private uploads. */
export function resolveSoundSelection(
    kind: AlertSoundKind, selections: AlertSoundSelections | undefined,
    hasUpload: (kind: AlertSoundKind) => boolean, override?: AlertSoundSelection,
): { kind: AlertSoundKind; selection: Exclude<AlertSoundSelection, 'inherit'> } {
    let selection = override ?? soundSelection(kind, selections, hasUpload(kind));
    if (selection === 'inherit') {
        kind = SOUND_FALLBACKS[kind] ?? kind;
        selection = soundSelection(kind, selections, hasUpload(kind));
    }
    return { kind, selection: selection === 'inherit' ? 'silent' : selection };
}

export function alertSoundAssetPath(id: AlertSoundPresetId): string {
    return `sounds/library-v1/${id}.mp3`;
}
