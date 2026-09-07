import { describe, expect, it } from 'vitest';
import {
    customSoundFileError, customSoundMimeType, emptyCustomAlertSoundMap, metadataMap, parseCustomAlertSoundMetadata,
    parseStoredCustomAlertSound, safeCustomSoundName,
} from './custom-alert-sounds.models';

describe('custom alert sound validation', () => {
    it('accepts supported audio and rejects empty, oversized, or unrelated files', () => {
        expect(customSoundFileError({ name: 'bell.mp3', size: 1200, type: 'audio/mpeg' })).toBeNull();
        expect(customSoundFileError({ name: 'bell.wav', size: 1200, type: '' })).toBeNull();
        expect(customSoundFileError({ name: 'empty.mp3', size: 0, type: 'audio/mpeg' })).toContain('non-empty');
        expect(customSoundFileError({ name: 'huge.mp3', size: 4 * 1024 * 1024, type: 'audio/mpeg' })).toContain('3 MB');
        expect(customSoundFileError({ name: 'notes.txt', size: 1200, type: 'text/plain' })).toContain('MP3');
        expect(customSoundMimeType({ name: 'bell.wav', type: '' })).toBe('audio/wav');
    });

    it('sanitizes filenames and maps only known semantic cues', () => {
        expect(safeCustomSoundName('../\u0000my-bell.mp3')).toBe('..-my-bell.mp3');
        expect(metadataMap([{
            id: 'A:open', owner: 'A', kind: 'open', name: 'bell.mp3', mimeType: 'audio/mpeg',
            size: 1, duration: 1.2, updatedAt: '2026-09-06T00:00:00.000Z', bytes: new ArrayBuffer(1),
            cloudSynced: true,
        }]).open?.name).toBe('bell.mp3');
        expect(emptyCustomAlertSoundMap()).toEqual({ open: null, close: null, target: null, risk: null });
    });

    it('rejects malformed or cross-user IndexedDB records', () => {
        const record = {
            id: 'A:risk', owner: 'A', kind: 'risk', name: 'warning.wav', mimeType: 'audio/wav',
            size: 8, duration: 2, updatedAt: '2026-09-06T00:00:00.000Z', bytes: new ArrayBuffer(8),
            cloudSynced: true,
        };
        expect(parseStoredCustomAlertSound(record, 'A')?.kind).toBe('risk');
        expect(parseStoredCustomAlertSound({ ...record, cloudSynced: undefined }, 'A')?.cloudSynced).toBe(false);
        expect(parseStoredCustomAlertSound(record, 'B')).toBeNull();
        expect(parseStoredCustomAlertSound({ ...record, duration: 99 }, 'A')).toBeNull();
        expect(parseStoredCustomAlertSound({ ...record, bytes: 'not-a-buffer' }, 'A')).toBeNull();
        expect(parseStoredCustomAlertSound({ ...record, size: 7 }, 'A')).toBeNull();
    });

    it('normalizes cloud metadata and rejects unsupported metadata', () => {
        const metadata = {
            kind: 'target', name: 'goal.mp3', mimeType: 'audio/mpeg', size: 800,
            duration: 1.5, updatedAt: '2026-09-06T00:00:00.000Z',
        };
        expect(parseCustomAlertSoundMetadata(metadata)).toEqual(metadata);
        expect(parseCustomAlertSoundMetadata({ ...metadata, name: 'goal.txt', mimeType: 'text/plain' })).toBeNull();
        expect(parseCustomAlertSoundMetadata({ ...metadata, kind: 'unknown' })).toBeNull();
    });
});
