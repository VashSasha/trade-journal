import { DestroyRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { FilterService } from '../../core/services/filter.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { TradovateLivePositionEvent } from '../integrations/tradovate-live/tradovate-live.models';
import { AlertAudioService } from './alert-audio.service';
import { SessionAlertsService } from './session-alerts.service';
import { PositionSoundAlertsService, POSITION_EVENT_SOUNDS } from './position-sound-alerts.service';
import { DEFAULT_SESSION_SOUNDS, SessionSoundPreferences } from './session-alerts.utils';
import { emptyCustomAlertSoundMap } from './custom-alert-sounds.models';

describe('optional position sound alerts', () => {
    function setup(selections: SessionSoundPreferences['selections'] = { positionOpened: 'hell-yeah' }) {
        const preferences = signal({ ...DEFAULT_SESSION_SOUNDS, selections });
        const enabled = signal(true);
        const userId = signal<string | null>('A');
        const state = signal('live');
        const allowed = signal(true);
        const events = signal<TradovateLivePositionEvent[]>([]);
        const filters = signal({ accountSelectionActive: true, accountIds: ['1', '2'] });
        const announce = vi.fn(); const setRequested = vi.fn();
        TestBed.configureTestingModule({ providers: [
            { provide: AccessPolicyService, useValue: { canAct: () => allowed() } },
            { provide: FilterService, useValue: { filters } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: TradovateLiveService, useValue: { state, positionEvents: events, setRequested } },
            { provide: AlertAudioService, useValue: { customSounds: signal(emptyCustomAlertSoundMap()) } },
            { provide: SessionAlertsService, useValue: { preferences, enabled, previewing: signal(false), announce } },
        ] });
        const service = TestBed.inject(PositionSoundAlertsService);
        service.attach(TestBed.inject(DestroyRef)); TestBed.tick();
        const event = (patch: Partial<TradovateLivePositionEvent> = {}): TradovateLivePositionEvent => ({
            eventId: 'one', connectionId: 'broker', accountId: 1, positionId: 3, contractId: 4,
            tradeDate: '2026-10-01', kind: 'opened', direction: 'long', previousQuantity: 0,
            quantity: 1, averagePrice: 100, observedAt: Date.now(), ...patch,
        });
        return { preferences, enabled, userId, state, allowed, events, filters, announce, setRequested, event };
    }
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

    it('does not request monitoring or ring for new triggers until opted in', async () => {
        const ctx = setup({});
        expect(ctx.setRequested).toHaveBeenLastCalledWith('position-sounds', false);
        ctx.events.set([ctx.event()]); TestBed.tick(); await vi.advanceTimersByTimeAsync(1000);
        expect(ctx.announce).not.toHaveBeenCalled();
    });
    it('groups copied-account events and ignores unselected accounts and duplicates', async () => {
        const ctx = setup();
        ctx.events.set([ctx.event(), ctx.event({ eventId: 'two', accountId: 2 }), ctx.event({ eventId: 'other', accountId: 8 })]);
        TestBed.tick(); await vi.advanceTimersByTimeAsync(900);
        expect(ctx.announce).toHaveBeenCalledExactlyOnceWith('positionOpened', 'Position opened.');
        ctx.events.update(events => [...events]); TestBed.tick(); await vi.advanceTimersByTimeAsync(1000);
        expect(ctx.announce).toHaveBeenCalledOnce();
    });
    it('cancels pending cues on mute and does not replay them on unmute', async () => {
        const ctx = setup(); ctx.events.set([ctx.event()]); TestBed.tick();
        ctx.enabled.set(false); TestBed.tick(); await vi.advanceTimersByTimeAsync(1000);
        ctx.enabled.set(true); TestBed.tick(); await vi.advanceTimersByTimeAsync(1000);
        expect(ctx.announce).not.toHaveBeenCalled();
    });
    it('discards pending events on account/owner changes and reconnection', async () => {
        const ctx = setup(); ctx.events.set([ctx.event()]); TestBed.tick();
        ctx.filters.set({ accountSelectionActive: true, accountIds: ['2'] }); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        expect(ctx.announce).not.toHaveBeenCalled();
        ctx.events.set([ctx.event({ eventId: 'two', accountId: 2 })]); TestBed.tick();
        ctx.userId.set('B'); TestBed.tick(); await vi.advanceTimersByTimeAsync(1000);
        expect(ctx.announce).not.toHaveBeenCalled();
        ctx.state.set('reconnecting'); TestBed.tick();
        ctx.events.set([ctx.event({ eventId: 'three', accountId: 2 })]); TestBed.tick();
        ctx.state.set('live'); TestBed.tick(); await vi.advanceTimersByTimeAsync(1000);
        expect(ctx.announce).not.toHaveBeenCalled();
    });
    it('routes every normalized position event to its own cue', async () => {
        const choices = Object.fromEntries(Object.values(POSITION_EVENT_SOUNDS).map(kind => [kind, 'game-over'])) as SessionSoundPreferences['selections'];
        const ctx = setup(choices);
        for (const [kind, sound] of Object.entries(POSITION_EVENT_SOUNDS)) {
            ctx.events.set([ctx.event({ eventId: kind, kind: kind as TradovateLivePositionEvent['kind'] })]);
            TestBed.tick(); await vi.advanceTimersByTimeAsync(900);
            expect(ctx.announce).toHaveBeenLastCalledWith(sound, `Position ${kind}.`);
        }
        expect(ctx.announce).toHaveBeenCalledTimes(5);
    });
    it('ignores stale events and stops monitoring when broker access is unavailable', async () => {
        const ctx = setup();
        ctx.events.set([ctx.event({ observedAt: Date.now() - 6000 })]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000); expect(ctx.announce).not.toHaveBeenCalled();
        ctx.allowed.set(false); TestBed.tick();
        expect(ctx.setRequested).toHaveBeenLastCalledWith('position-sounds', false);
    });
});
