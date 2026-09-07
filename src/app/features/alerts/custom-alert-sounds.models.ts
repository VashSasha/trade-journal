import { AlertSoundKind } from './session-alerts.utils';

export const ALERT_SOUND_KINDS: readonly AlertSoundKind[] = ['open', 'close', 'target', 'risk'];
export const MAX_CUSTOM_SOUND_BYTES = 3 * 1024 * 1024;
export const MAX_CUSTOM_SOUND_SECONDS = 10;

export interface CustomAlertSoundMetadata {
    kind: AlertSoundKind;
    name: string;
    mimeType: string;
    size: number;
    duration: number;
    updatedAt: string;
}

export interface StoredCustomAlertSound extends CustomAlertSoundMetadata {
    id: string;
    owner: string;
    bytes: ArrayBuffer;
    /** False only for files saved by the browser-local implementation. */
    cloudSynced: boolean;
}

export type CustomAlertSoundMap = Record<AlertSoundKind, CustomAlertSoundMetadata | null>;

const AUDIO_TYPES = new Set([
    'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/ogg',
    'audio/wav', 'audio/wave', 'audio/webm', 'audio/x-m4a', 'audio/x-wav',
]);
const AUDIO_EXTENSIONS = new Set(['aac', 'm4a', 'mp3', 'oga', 'ogg', 'wav', 'webm']);
const EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
    aac: 'audio/aac', m4a: 'audio/mp4', mp3: 'audio/mpeg', oga: 'audio/ogg',
    ogg: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm',
};

export function emptyCustomAlertSoundMap(): CustomAlertSoundMap {
    return { open: null, close: null, target: null, risk: null };
}

export function customSoundFileError(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
    if (!file.size) return 'Choose a non-empty audio file.';
    if (file.size > MAX_CUSTOM_SOUND_BYTES) return 'Audio files must be 3 MB or smaller.';
    if (!customSoundMimeType(file)) {
        return 'Use an MP3, WAV, OGG, WebM, M4A, or AAC audio file.';
    }
    return null;
}

export function customSoundMimeType(file: Pick<File, 'name' | 'type'>): string | null {
    const mimeType = file.type.toLowerCase();
    if (AUDIO_TYPES.has(mimeType)) return mimeType;
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    return AUDIO_EXTENSIONS.has(extension) ? EXTENSION_MIME_TYPES[extension] ?? null : null;
}

export function safeCustomSoundName(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\]/g, '-').trim().slice(0, 100)
        || 'Custom sound';
}

export function parseCustomAlertSoundMetadata(value: unknown): CustomAlertSoundMetadata | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<CustomAlertSoundMetadata>;
    const mimeType = typeof record.name === 'string' && typeof record.mimeType === 'string'
        ? customSoundMimeType({ name: record.name, type: record.mimeType })
        : null;
    if (typeof record.kind !== 'string' || !ALERT_SOUND_KINDS.includes(record.kind as AlertSoundKind)
        || typeof record.name !== 'string' || !record.name.trim()
        || !mimeType
        || typeof record.size !== 'number' || !Number.isFinite(record.size) || record.size <= 0
        || record.size > MAX_CUSTOM_SOUND_BYTES || typeof record.duration !== 'number'
        || !Number.isFinite(record.duration) || record.duration <= 0 || record.duration > MAX_CUSTOM_SOUND_SECONDS
        || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) return null;
    return {
        kind: record.kind as AlertSoundKind,
        name: safeCustomSoundName(record.name),
        mimeType,
        size: record.size,
        duration: record.duration,
        updatedAt: new Date(record.updatedAt).toISOString(),
    };
}

export function parseStoredCustomAlertSound(value: unknown, owner: string): StoredCustomAlertSound | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<StoredCustomAlertSound>;
    const metadata = parseCustomAlertSoundMetadata(record);
    if (record.owner !== owner || !metadata || !(record.bytes instanceof ArrayBuffer) || !record.bytes.byteLength
        || record.bytes.byteLength > MAX_CUSTOM_SOUND_BYTES || metadata.size !== record.bytes.byteLength) return null;
    const kind = metadata.kind;
    return {
        id: `${owner}:${kind}`,
        owner,
        ...metadata,
        size: record.bytes.byteLength,
        bytes: record.bytes,
        cloudSynced: record.cloudSynced === true,
    };
}

export function metadataMap(records: readonly StoredCustomAlertSound[]): CustomAlertSoundMap {
    const result = emptyCustomAlertSoundMap();
    for (const record of records) {
        if (!ALERT_SOUND_KINDS.includes(record.kind)) continue;
        result[record.kind] = {
            kind: record.kind,
            name: safeCustomSoundName(record.name),
            mimeType: record.mimeType.slice(0, 100),
            size: record.size,
            duration: record.duration,
            updatedAt: record.updatedAt,
        };
    }
    return result;
}
