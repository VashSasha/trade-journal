import { ALERT_SOUND_PRESETS, alertSoundAssetPath, normalizeSoundSelections, resolveSoundSelection } from './alert-sound-library';
import { normalizeSoundPreferences } from './session-alerts.utils';

describe('alert sound library', () => {
    it('has ten unique, versioned local assets within the duration limit', () => {
        expect(new Set(ALERT_SOUND_PRESETS.map(p => p.id)).size).toBe(10);
        for (const preset of ALERT_SOUND_PRESETS) {
            expect(preset.seconds).toBeLessThanOrEqual(10);
            expect(alertSoundAssetPath(preset.id)).toMatch(/^sounds\/library-v1\/[a-z-]+\.mp3$/);
        }
    });
    it('accepts only known choices and semantic alert types', () => {
        expect(normalizeSoundSelections({ open: 'stock-market-bell', risk: 'custom', target: 'default' }))
            .toEqual({ open: 'stock-market-bell', risk: 'custom', target: 'default' });
        expect(normalizeSoundSelections({ open: 'https://untrusted/audio', close: {}, other: 'hell-yeah' })).toBeUndefined();
        expect(normalizeSoundSelections(['hell-yeah'])).toBeUndefined();
    });
    it('preserves absent legacy selections and valid choices while normalizing other preferences', () => {
        const legacy = { volume: 45, opens: true, closes: true, armed: false };
        expect(normalizeSoundPreferences(legacy)).toEqual(legacy);
        expect(normalizeSoundPreferences({ ...legacy, selections: { open: 'game-over' } })?.selections)
            .toEqual({ open: 'game-over' });
    });
    it('resolves shared uploads using the original storage kind and respects individual overrides', () => {
        const hasUpload = (kind: string) => kind === 'risk';
        expect(resolveSoundSelection('dailyLoss', undefined, hasUpload)).toEqual({ kind: 'risk', selection: 'custom' });
        expect(resolveSoundSelection('dailyLoss', { dailyLoss: 'silent' }, hasUpload)).toEqual({ kind: 'dailyLoss', selection: 'silent' });
        expect(resolveSoundSelection('dailyLoss', { risk: 'game-over' }, hasUpload)).toEqual({ kind: 'risk', selection: 'game-over' });
        expect(resolveSoundSelection('dailyLoss', { dailyLoss: 'default' }, hasUpload)).toEqual({ kind: 'dailyLoss', selection: 'default' });
    });
    it('preserves defaults and lets previews override the resolved selection without mutation', () => {
        expect(resolveSoundSelection('dailyProfit', undefined, () => false)).toEqual({ kind: 'target', selection: 'default' });
        expect(resolveSoundSelection('positionOpened', undefined, () => false)).toEqual({ kind: 'positionOpened', selection: 'silent' });
        const selections = { risk: 'silent' } as const;
        expect(resolveSoundSelection('dailyLoss', selections, () => false, 'hell-yeah')).toEqual({ kind: 'dailyLoss', selection: 'hell-yeah' });
        expect(selections).toEqual({ risk: 'silent' });
    });
});
