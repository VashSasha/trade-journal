import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { OpenAiService } from '../../core/services/openai.service';
import { MarketPanelService } from '../market-events/market-panel.service';
import { DEFAULT_LIVE_COACH_PREFERENCES } from './live-coach.models';
import { LiveCoachService } from './live-coach.service';
import { LiveCoachWidgetComponent } from './live-coach-widget.component';
import { CoachHistoryService } from './history/coach-history.service';
import { CoachChatService } from './chat/coach-chat.service';

describe('floating Live Coach', () => {
    function setup() {
        const demo = signal(false);
        const paid = signal(true);
        const userId = signal<string | null>('owner-a');
        const preferences = signal({ ...DEFAULT_LIVE_COACH_PREFERENCES });
        const recentComments = signal([{ id: 1, text: 'Opened 3 contracts across 2 accounts.', personalized: false, title: 'Position opened', time: Date.now() }]);
        const masterSound = signal(true);
        const history = { canReview: computed(() => !!userId() && !demo()), removed: signal(new Set()),
            failedCount: signal(0), pendingCount: signal(0), items: signal([]), date: signal(''), loading: signal(false),
            error: signal(null), hasMore: signal(false), deleting: signal(null), load: vi.fn(), saveAnswer: vi.fn(), retrySaves: vi.fn() };
        const coach = {
            preferences, recentComments, preferencesLoading: signal(false),
            liveState: signal('live'), liveStatus: signal('Live'), liveDetail: signal('Broker data is live.'),
            aiState: signal('ready'), narratorState: signal('idle'), aiAvailable: signal(true),
            sounds: { enabled: masterSound }, paused: computed(() => !masterSound() || !preferences().voiceEnabled),
            syncWarning: signal(false), storageWarning: signal(false), voiceWarning: signal<string | null>(null), error: signal(null), voiceFallback: signal(false),
            setEnabled: vi.fn((enabled: boolean) => preferences.update(p => ({ ...p, enabled }))),
            setVoiceEnabled: vi.fn((voiceEnabled: boolean) => preferences.update(p => ({ ...p, voiceEnabled }))),
            setVoice: vi.fn(), setAiCommentary: vi.fn(), preview: vi.fn(), readingSummary: signal(false),
        };
        const chat = { canReview: history.canReview, access: { canAct: () => paid() },
            conversations: signal([{ id: 'saved-chat', title: 'My session', created_at: '2026-09-28' }]), conversationId: signal<string | null>(null),
            busy: signal(false), deleting: signal(false), loading: signal(false), listing: signal(false), hasMore: signal(false),
            listError: signal<string | null>(null), error: signal(null), pending: signal(null), turns: signal([]), draft: signal(''),
            replyTo: signal(null), reply: vi.fn(),
            day: signal('2026-09-28'), accountIds: signal(null), dataReady: signal(false), allowance: signal(null), allowanceLoading: signal(false),
            send: vi.fn(), remove: vi.fn(), refreshAllowance: vi.fn(), invalidateAllowance: vi.fn(), loadConversations: vi.fn(),
            open: vi.fn(), newConversation: vi.fn(), cancel: vi.fn() };
        TestBed.configureTestingModule({ providers: [
            provideRouter([]),
            { provide: CoachHistoryService, useValue: history },
            { provide: LiveCoachService, useValue: coach },
            { provide: OpenAiService, useValue: { generateLiveCoachFollowUp: vi.fn() } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: AccessPolicyService, useValue: { demo, canAct: () => !demo() && paid(), promptReason: signal(null) } },
        ] });
        TestBed.overrideComponent(LiveCoachWidgetComponent, { add: { providers: [{ provide: CoachChatService, useValue: chat }] } });
        const fixture = TestBed.createComponent(LiveCoachWidgetComponent);
        fixture.detectChanges();
        const component = fixture.componentInstance;
        const root = fixture.nativeElement as HTMLElement;
        const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')]
            .find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
        const menu = () => { button('More Coach actions').click(); fixture.detectChanges(); };
        return { fixture, component, root, button, coach, demo, paid, userId, masterSound, history, chat, menu };
    }

    beforeEach(() => TestBed.resetTestingModule());
    afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); vi.unstubAllGlobals(); });


    it('opens and closes without enabling coaching, playing audio or requesting a preview', async () => {
        const { fixture, component, root, coach, button } = setup();
        component.toggle(); fixture.detectChanges(); await fixture.whenStable();
        expect(root.querySelector('[role="dialog"]')!.getAttribute('aria-hidden')).toBe('false');
        expect(document.activeElement).toBe(button('Close Live Coach'));
        button('Close Live Coach').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();
        expect(component.open()).toBe(false);
        expect(document.activeElement).toBe(root.querySelector('.coach-widget__launcher'));
        expect(coach.setEnabled).not.toHaveBeenCalled();
        expect(coach.preview).not.toHaveBeenCalled();
    });

    it('keeps content through the closing animation but immediately disables interaction', () => {
        vi.useFakeTimers();
        const { fixture, component, root, chat } = setup();
        const panel = root.querySelector('[role="dialog"]')!;
        expect(panel.hasAttribute('inert')).toBe(true);
        expect(root.querySelector('app-coach-chat')).toBeNull();
        component.toggle(); fixture.detectChanges();
        expect(panel.classList.contains('coach-widget__panel--open')).toBe(true);
        expect(panel.hasAttribute('inert')).toBe(false);
        const input = root.querySelector('textarea');
        component.close(); fixture.detectChanges();
        expect(panel.getAttribute('aria-hidden')).toBe('true');
        expect(panel.hasAttribute('inert')).toBe(true);
        expect(root.querySelector('textarea')).toBe(input);
        vi.advanceTimersByTime(180); fixture.detectChanges();
        expect(root.querySelector('app-coach-chat')).toBeNull();
        expect(chat.send).not.toHaveBeenCalled();
    });

    it('cancels pending close cleanup when quickly reopened without remounting the chat', () => {
        vi.useFakeTimers();
        const { fixture, component, root, chat } = setup();
        component.toggle(); fixture.detectChanges();
        const input = root.querySelector('textarea');
        component.close(); fixture.detectChanges(); vi.advanceTimersByTime(70);
        component.toggle(); fixture.detectChanges(); vi.advanceTimersByTime(200); fixture.detectChanges();
        expect(component.open()).toBe(true); expect(component.rendered()).toBe(true);
        expect(root.querySelector('textarea')).toBe(input);
        expect(chat.loadConversations).not.toHaveBeenCalled();
        expect(chat.refreshAllowance).not.toHaveBeenCalled();
    });

    it('clears content immediately for reduced motion and owner changes', () => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
        const { fixture, component, root, userId } = setup();
        component.toggle(); fixture.detectChanges(); component.close(); fixture.detectChanges();
        expect(component.rendered()).toBe(false); expect(root.querySelector('app-coach-chat')).toBeNull();
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
        component.toggle(); fixture.detectChanges(); component.close(); fixture.detectChanges();
        expect(component.rendered()).toBe(true);
        userId.set('other-owner'); fixture.detectChanges();
        expect(component.rendered()).toBe(false); expect(root.querySelector('app-coach-chat')).toBeNull();
    });

    it('opens one combined chat and marks the displayed live observations read', () => {
        const { fixture, component, coach, root } = setup();
        expect(component.unread()).toBe(1);
        component.toggle(); fixture.detectChanges();
        expect(component.view()).toBe('chat');
        expect(component.unread()).toBe(0);
        expect(root.textContent).toContain('Opened 3 contracts');
        component.close(); fixture.detectChanges();
        coach.recentComments.update(items => [{ ...items[0], id: 2 }, ...items]); fixture.detectChanges();
        expect(component.unread()).toBe(1);
        expect(coach.recentComments()).toHaveLength(2);
    });

    it('separates coach and voice controls and never changes master sound', () => {
        const { fixture, component, coach, button, root, masterSound, menu } = setup();
        component.toggle(); fixture.detectChanges();
        expect(button('Automatic coaching')).toBeUndefined();
        menu();
        button('Automatic coaching').click(); fixture.detectChanges();
        expect(coach.setEnabled).toHaveBeenCalledWith(true);
        expect(button('Coach voice')).toBeUndefined(); expect(button('Voice playback')).toBeUndefined();
        button('Coach settings').click(); fixture.detectChanges();
        const voice = root.querySelector<HTMLInputElement>('input[aria-label="Voice playback"]')!;
        expect(voice.checked).toBe(true);
        voice.click(); fixture.detectChanges();
        expect(coach.setVoiceEnabled).toHaveBeenCalledWith(false);
        expect(masterSound()).toBe(true);
        expect(component.status()).toBe('Monitoring · Text only');
        coach.preferences.update(p => ({ ...p, voiceEnabled: true })); fixture.detectChanges();
        expect(voice.checked).toBe(true);
        masterSound.set(false); fixture.detectChanges();
        expect(root.textContent).toContain('Master sound is off.'); expect(voice.checked).toBe(true);
        component.close(); fixture.detectChanges();
        expect(coach.preferences().enabled).toBe(true);
    });

    it('reuses the voice selector and links to the existing full settings', () => {
        const { fixture, component, root, button, menu } = setup();
        component.toggle(); fixture.detectChanges();
        menu();
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
        expect(coach.setEnabled).not.toHaveBeenCalled();
        demo.set(false); paid.set(false); fixture.detectChanges();
        component.toggle(); fixture.detectChanges();
        expect(root.querySelector('a')!.getAttribute('href')).toContain('/account/pricing');
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

    it('loads saved history only on demand and keeps it accessible after downgrade', () => {
        const { fixture, component, paid, history, button, root, menu } = setup();
        expect(history.load).not.toHaveBeenCalled();
        paid.set(false); component.toggle(); fixture.detectChanges();
        menu(); button('Coaching history').click(); fixture.detectChanges();
        expect(component.heading()).toBe('Coaching history');
        expect(root.textContent).toContain('Your conversations are in Saved chats.');
        expect(history.load).toHaveBeenCalledOnce();
        expect(root.querySelector('app-coach-history')).not.toBeNull();
        expect(root.querySelector('.coach-widget__controls')).toBeNull();
    });

    it('expands and shrinks without recreating the chat or changing coaching preferences', () => {
        const { fixture, component, button, root, chat, coach } = setup();
        component.toggle(); fixture.detectChanges();
        const input = root.querySelector('textarea');
        button('Expand Coach').click(); fixture.detectChanges();
        expect(root.querySelector('.coach-widget__panel--expanded')).not.toBeNull();
        expect(root.querySelector('textarea')).toBe(input);
        button('Shrink Coach').click(); fixture.detectChanges();
        expect(component.enlarged()).toBe(false);
        expect(chat.loadConversations).not.toHaveBeenCalled();
        expect(chat.refreshAllowance).not.toHaveBeenCalled();
        expect(coach.setEnabled).not.toHaveBeenCalled();
        expect(root.querySelector('nav')).toBeNull();
    });

    it('reopens without data requests and loads each secondary menu only when expanded', () => {
        vi.useFakeTimers();
        const { fixture, component, root, chat, button, menu } = setup();
        component.toggle(); fixture.detectChanges(); component.close(); fixture.detectChanges();
        vi.advanceTimersByTime(180); fixture.detectChanges();
        component.toggle(); fixture.detectChanges(); menu();
        expect(chat.loadConversations).not.toHaveBeenCalled(); expect(chat.refreshAllowance).not.toHaveBeenCalled();
        const disclosures = [...root.querySelectorAll<HTMLDetailsElement>('#coach-actions-panel details')];
        const saved = disclosures.find(item => item.querySelector('summary')?.textContent?.trim() === 'Saved chats')!;
        saved.open = true; saved.dispatchEvent(new Event('toggle')); fixture.detectChanges();
        expect(chat.loadConversations).toHaveBeenCalledOnce(); expect(chat.refreshAllowance).not.toHaveBeenCalled();
        saved.open = false; saved.dispatchEvent(new Event('toggle'));
        expect(chat.loadConversations).toHaveBeenCalledOnce();
        const usage = disclosures.find(item => item.querySelector('summary')?.textContent?.trim() === 'About & usage')!;
        usage.open = true; usage.dispatchEvent(new Event('toggle')); fixture.detectChanges();
        expect(chat.refreshAllowance).toHaveBeenCalledOnce();
        button('Refresh saved chats').click(); expect(chat.loadConversations).toHaveBeenLastCalledWith(false, true);
        button('Refresh usage').click(); expect(chat.refreshAllowance).toHaveBeenLastCalledWith(true);
    });

    it('adds decorative icons to menu items without replacing their text or state labels', () => {
        const { fixture, component, root, chat, button, menu } = setup();
        component.toggle(); fixture.detectChanges();
        chat.conversationId.set('saved-chat'); chat.hasMore.set(true); chat.listError.set('Could not load chats.');
        menu();
        const checkIcons = () => {
            const items = [...root.querySelectorAll<HTMLElement>('#coach-actions-panel button, #coach-actions-panel summary, #coach-actions-panel a')];
            expect(items.length).toBeGreaterThan(10);
            for (const item of items) {
                const icon = item.querySelector('svg');
                expect(icon?.getAttribute('aria-hidden')).toBe('true');
                expect(icon?.getAttribute('focusable')).toBe('false');
                expect(item.querySelector('.coach-actions__label')?.textContent?.trim()).toBeTruthy();
            }
        };
        checkIcons();
        const automatic = button('Automatic coaching');
        automatic.click(); fixture.detectChanges();
        expect(automatic.getAttribute('aria-pressed')).toBe('true');
        expect(automatic.querySelector('.coach-actions__state')!.textContent).toBe('On');
        expect(button('Coach voice')).toBeUndefined();
        button('Delete chat').click(); fixture.detectChanges(); checkIcons();
        expect(chat.remove).not.toHaveBeenCalled();
        expect(chat.loadConversations).not.toHaveBeenCalled(); expect(chat.refreshAllowance).not.toHaveBeenCalled();
    });

    it('keeps chat actions in one menu and confirms deletion', async () => {
        const { fixture, component, button, root, chat, menu } = setup();
        component.toggle(); fixture.detectChanges(); chat.conversationId.set('saved-chat');
        expect(button('Delete chat')).toBeUndefined();
        menu(); button('Delete chat').click(); fixture.detectChanges();
        expect(chat.remove).not.toHaveBeenCalled();
        button('Keep chat').click(); fixture.detectChanges();
        button('Delete chat').click(); fixture.detectChanges(); button('Confirm delete').click();
        await fixture.whenStable();
        expect(chat.remove).toHaveBeenCalledOnce();
        expect(root.querySelector('#coach-actions-panel')).toBeNull();
    });

    it('closes the menu with Escape before closing the widget, and also on outside click', () => {
        const { fixture, component, button, root, menu } = setup();
        component.toggle(); fixture.detectChanges(); menu();
        button('New chat').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges();
        expect(component.open()).toBe(true); expect(root.querySelector('#coach-actions-panel')).toBeNull();
        expect(document.activeElement).toBe(button('More Coach actions'));
        menu(); root.querySelector('textarea')!.click(); fixture.detectChanges();
        expect(root.querySelector('#coach-actions-panel')).toBeNull();
    });
});
