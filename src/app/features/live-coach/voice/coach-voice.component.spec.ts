import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachChatService } from '../chat/coach-chat.service';
import { CoachVoiceComponent } from './coach-voice.component';
import { CoachVoiceService } from './coach-voice.service';

function setup(options: { configured?: boolean; supported?: boolean } = {}) {
    const paid = signal(true), demo = signal(false), state = signal('idle');
    const voice = {
        configured: options.configured ?? true, supported: options.supported ?? true,
        state, active: computed(() => state() !== 'idle'), muted: signal(false), remaining: signal(180),
        allowance: signal<{ remainingTokens: number; resetsAt: string } | null>(null),
        start: vi.fn(), end: vi.fn(), toggleMute: vi.fn(),
    };
    const chat = { access: { canAct: () => paid(), demo }, loading: signal(false), loadFailed: signal(false), deleting: signal(false),
        pending: signal<unknown>(null), busy: signal(false), canReply: signal(true) };
    TestBed.configureTestingModule({ providers: [{ provide: CoachVoiceService, useValue: voice }, { provide: CoachChatService, useValue: chat }] });
    const fixture = TestBed.createComponent(CoachVoiceComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = (label = 'Start voice conversation') => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    return { fixture, root, voice, chat, paid, demo, button };
}
afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

describe('compact voice controls', () => {
    it('renders one labelled icon, with no persistent voice section or automatic start', () => {
        const { root, voice, button } = setup();
        expect(root.querySelectorAll('button')).toHaveLength(1);
        expect(button().textContent?.trim()).toBe('');
        expect(button().querySelector('svg')).not.toBeNull();
        expect(root.querySelector('p, details, section')).toBeNull();
        expect(voice.start).not.toHaveBeenCalled();
        button().click(); expect(voice.start).toHaveBeenCalledOnce();
    });
    it.each([
        [{ configured: false }, 'available in this environment'],
        [{ supported: false }, 'microphone support'],
    ])('explains unavailable environments without removing keyboard/touch access', (options, reason) => {
        const { fixture, root, voice, button } = setup(options);
        expect(button().disabled).toBe(false);
        expect(button().getAttribute('aria-disabled')).toBe('true');
        button().click(); fixture.detectChanges();
        expect(root.querySelector('.coach-voice__tooltip--open')?.textContent).toContain(reason);
        expect(voice.start).not.toHaveBeenCalled();
    });
    it('explains access, demo, loading, failure and pending-reply restrictions', () => {
        const { fixture, root, voice, chat, paid, demo, button } = setup();
        const check = (reason: string) => {
            fixture.detectChanges(); button().click(); fixture.detectChanges();
            expect(root.querySelector('.coach-voice__tooltip--open')?.textContent).toContain(reason);
            expect(button().getAttribute('aria-disabled')).toBe('true');
            expect(voice.start).not.toHaveBeenCalled();
        };
        paid.set(false); check('Premium+'); paid.set(true);
        demo.set(true); check('demo mode'); demo.set(false);
        chat.loading.set(true); check('finish loading'); chat.loading.set(false);
        chat.loadFailed.set(true); check('Retry loading'); chat.loadFailed.set(false);
        chat.deleting.set(true); check('finish deleting'); chat.deleting.set(false);
        chat.pending.set({}); check('current text reply'); chat.pending.set(null);
        chat.busy.set(true); check('current text reply'); chat.busy.set(false);
        chat.canReply.set(false); check('Sign in or reopen');
    });
    it('supports hover, keyboard focus, Escape and tapping outside the tooltip', () => {
        const { fixture, root, button } = setup({ configured: false });
        const open = () => root.querySelector('.coach-voice__tooltip--open');
        root.querySelector('.coach-voice__trigger')!.dispatchEvent(new Event('pointerenter')); fixture.detectChanges(); expect(open()).not.toBeNull();
        button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges(); expect(open()).toBeNull();
        button().focus(); fixture.detectChanges(); expect(open()).not.toBeNull();
        expect(button().getAttribute('aria-describedby')).toBe(root.querySelector('[role="tooltip"]')!.id);
        button().blur(); fixture.detectChanges(); expect(open()).toBeNull();
        button().click(); fixture.detectChanges(); expect(open()).not.toBeNull();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); fixture.detectChanges(); expect(open()).toBeNull();
    });
    it('unlocks an exhausted allowance after UTC reset without fetching or requiring a reload', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T23:59:00Z'));
        const { fixture, root, voice, button } = setup();
        voice.allowance.set({ remainingTokens: 0, resetsAt: '2026-10-10T00:00:00Z' });
        fixture.detectChanges(); button().click(); fixture.detectChanges();
        expect(root.querySelector('[role="tooltip"]')?.textContent).toContain('Daily voice allowance reached');
        expect(voice.start).not.toHaveBeenCalled();
        vi.setSystemTime(new Date('2026-10-10T00:00:01Z'));
        button().click(); fixture.detectChanges();
        expect(button().getAttribute('aria-disabled')).toBe('false');
        expect(voice.start).toHaveBeenCalledOnce();
    });
    it('shows only a compact status/timer with mute and end controls during a call', () => {
        const { fixture, root, voice, button } = setup();
        voice.state.set('connecting'); voice.remaining.set(75); fixture.detectChanges();
        expect(root.textContent).toContain('Connecting…'); expect(root.textContent).toContain('1:15');
        expect(root.querySelectorAll('button')).toHaveLength(2);
        expect(button('Mute microphone').disabled).toBe(true);
        expect(button('End voice conversation').disabled).toBe(false);
        voice.state.set('listening'); fixture.detectChanges(); button('Mute microphone').click(); expect(voice.toggleMute).toHaveBeenCalledOnce();
        voice.muted.set(true); fixture.detectChanges(); expect(root.textContent).toContain('Mic muted');
        expect(button('Unmute microphone').getAttribute('aria-pressed')).toBe('true');
        button('End voice conversation').click(); expect(voice.end).toHaveBeenCalledOnce();
        voice.state.set('ending'); fixture.detectChanges(); expect(button('End voice conversation').disabled).toBe(true);
    });
});
