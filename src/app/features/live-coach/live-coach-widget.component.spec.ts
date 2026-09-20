import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { OpenAiService } from '../../core/services/openai.service';
import { MarketPanelService } from '../market-events/market-panel.service';
import { DEFAULT_LIVE_COACH_PREFERENCES } from './live-coach.models';
import { LiveCoachService } from './live-coach.service';
import { LiveCoachWidgetComponent } from './live-coach-widget.component';

describe('floating Live Coach', () => {
    function setup() {
        const demo = signal(false);
        const paid = signal(true);
        const userId = signal<string | null>('owner-a');
        const preferences = signal({ ...DEFAULT_LIVE_COACH_PREFERENCES });
        const recentComments = signal([{ id: 1, text: 'Opened 3 contracts across 2 accounts.', personalized: false, title: 'Position opened', time: Date.now() }]);
        const masterSound = signal(true);
        const coach = {
            preferences, recentComments, preferencesLoading: signal(false),
            liveState: signal('live'), liveStatus: signal('Live'), liveDetail: signal('Broker data is live.'),
            aiState: signal('ready'), narratorState: signal('idle'), aiAvailable: signal(true),
            sounds: { enabled: masterSound }, paused: computed(() => !masterSound() || !preferences().voiceEnabled),
            syncWarning: signal(false), storageWarning: signal(false), voiceWarning: signal<string | null>(null), error: signal(null), voiceFallback: signal(false),
            setEnabled: vi.fn((enabled: boolean) => preferences.update(p => ({ ...p, enabled }))),
            setVoiceEnabled: vi.fn((voiceEnabled: boolean) => preferences.update(p => ({ ...p, voiceEnabled }))),
            setVoice: vi.fn(), setAiCommentary: vi.fn(), preview: vi.fn(),
        };
        TestBed.configureTestingModule({ providers: [
            provideRouter([]),
            { provide: LiveCoachService, useValue: coach },
            { provide: OpenAiService, useValue: { generateLiveCoachFollowUp: vi.fn() } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: AccessPolicyService, useValue: { demo, canAct: () => !demo() && paid(), promptReason: signal(null) } },
        ] });
        const fixture = TestBed.createComponent(LiveCoachWidgetComponent);
        fixture.detectChanges();
        const component = fixture.componentInstance;
        const root = fixture.nativeElement as HTMLElement;
        const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')]
            .find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
        return { fixture, component, root, button, coach, demo, paid, userId, masterSound };
    }

    beforeEach(() => TestBed.resetTestingModule());

    it('opens and closes without enabling coaching, playing audio or requesting a preview', async () => {
        const { fixture, component, root, coach, button } = setup();
        component.toggle(); fixture.detectChanges(); await fixture.whenStable();
        expect(root.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(false);
        expect(document.activeElement).toBe(button('Close Live Coach'));
        button('Close Live Coach').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();
        expect(component.open()).toBe(false);
        expect(document.activeElement).toBe(root.querySelector('.coach-widget__launcher'));
        expect(coach.setEnabled).not.toHaveBeenCalled();
        expect(coach.preview).not.toHaveBeenCalled();
    });

    it('marks observations read only when expanded and counts new ones when collapsed', () => {
        const { fixture, component, coach } = setup();
        expect(component.unread()).toBe(1);
        component.toggle(); fixture.detectChanges();
        expect(component.unread()).toBe(0);
        component.close(); fixture.detectChanges();
        coach.recentComments.update(items => [{ ...items[0], id: 2 }, ...items]); fixture.detectChanges();
        expect(component.unread()).toBe(1);
        expect(coach.recentComments()).toHaveLength(2);
    });

    it('separates coach and voice controls and never changes master sound', () => {
        const { fixture, component, coach, button, masterSound } = setup();
        component.toggle(); fixture.detectChanges();
        button('Coach off').click(); fixture.detectChanges();
        expect(coach.setEnabled).toHaveBeenCalledWith(true);
        button('Voice on').click(); fixture.detectChanges();
        expect(coach.setVoiceEnabled).toHaveBeenCalledWith(false);
        expect(masterSound()).toBe(true);
        expect(component.status()).toBe('Monitoring · Text only');
        component.close(); fixture.detectChanges();
        expect(coach.preferences().enabled).toBe(true);
    });

    it('reuses the voice selector and links to the existing full settings', () => {
        const { fixture, component, root, button } = setup();
        component.toggle(); fixture.detectChanges();
        button('Coach settings').click(); fixture.detectChanges();
        expect(root.querySelector('app-live-coach-voice-select')).not.toBeNull();
        expect(root.querySelector('a')!.getAttribute('href')).toBe('/account/alerts');
    });

    it('hides real history in demo and never exposes controls to free accounts', () => {
        const { fixture, component, root, demo, paid, coach } = setup();
        component.toggle(); fixture.detectChanges();
        demo.set(true); fixture.detectChanges();
        expect(component.open()).toBe(false);
        component.toggle(); fixture.detectChanges();
        expect(root.textContent).not.toContain('Opened 3 contracts');
        expect(component.comments()).toEqual([]);
        component.toggleCoach();
        expect(coach.setEnabled).not.toHaveBeenCalled();
        demo.set(false); paid.set(false); fixture.detectChanges();
        expect(root.querySelector('a')!.getAttribute('href')).toContain('/upgrade');
        expect(root.querySelector('.coach-widget__controls')).toBeNull();
    });

    it('closes on owner change or market drawer opening', () => {
        const { fixture, component, userId } = setup();
        component.toggle(); fixture.detectChanges();
        userId.set('owner-b'); fixture.detectChanges();
        expect(component.open()).toBe(false);
        component.toggle(); fixture.detectChanges();
        TestBed.inject(MarketPanelService).show(); fixture.detectChanges();
        expect(component.open()).toBe(false);
    });

    it('shows connection loss and AI fallback honestly', () => {
        const { fixture, component, coach, root } = setup();
        coach.preferences.update(p => ({ ...p, enabled: true }));
        coach.liveState.set('disconnected'); coach.liveStatus.set('Reconnect broker');
        coach.liveDetail.set('Reconnect in Integrations to restore monitoring.');
        component.toggle(); fixture.detectChanges();
        expect(component.status()).toBe('Reconnect broker');
        expect(root.textContent).toContain('Reconnect in Integrations');
        coach.aiState.set('fallback'); fixture.detectChanges();
        expect(root.textContent).toContain('Showing factual position updates');
    });
});
