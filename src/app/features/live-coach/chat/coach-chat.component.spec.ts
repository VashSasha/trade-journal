import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveCoachService } from '../live-coach.service';
import { CoachChatComponent } from './coach-chat.component';
import { CoachChatService } from './coach-chat.service';
import { CoachChatObservation, CoachChatTurn } from './coach-chat.model';

function setup() {
    const ai = signal(true);
    const chat = { initialize: vi.fn(), access: { canAct: () => ai() }, conversations: signal([]), conversationId: signal<string | null>(null),
        busy: signal(false), deleting: signal(false), loading: signal(false), listing: signal(false), hasMore: signal(false),
        listError: signal(null), error: signal(null), pending: signal(null), turns: signal<CoachChatTurn[]>([]), draft: signal(''),
        replyTo: signal<CoachChatObservation | null>(null), reply: vi.fn(),
        day: signal('2026-09-28'), accountIds: signal(null), dataReady: signal(false), allowance: signal({ day: '2026-09-28', remaining: 26 }),
        send: vi.fn(), remove: vi.fn(), refreshAllowance: vi.fn(), open: vi.fn(), newConversation: vi.fn(), cancel: vi.fn() };
    const coach = { paused: signal(false), readingSummary: signal(false), readChatSummary: vi.fn(async () => true) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: CoachChatService, useValue: chat }, { provide: LiveCoachService, useValue: coach }] });
    const fixture = TestBed.createComponent(CoachChatComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!;
    return { fixture, root, button, chat, coach, ai };
}
afterEach(() => TestBed.resetTestingModule());
describe('Ask Coach interface', () => {
    it('closes the date/context dropdown on outside click, focus or Escape, but not inside clicks', () => {
        const { fixture, root } = setup();
        const context = root.querySelector<HTMLDetailsElement>('.coach-chat__scope')!;
        const summary = context.querySelector('summary')!;
        context.open = true; context.querySelector('input')!.click(); expect(context.open).toBe(true);
        root.querySelector('textarea')!.click(); expect(context.open).toBe(false);
        context.open = true; root.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); expect(context.open).toBe(false);
        context.open = true;
        context.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges(); expect(context.open).toBe(false); expect(document.activeElement).toBe(summary);
    });
    it('puts live comments and typed exchanges in one timeline with an explicit reply action', () => {
        const { fixture, root, button, chat, coach } = setup();
        const comment = { id: 1, historyId: 'saved', time: Date.parse('2026-09-28T14:00:00Z'), title: 'Position opened', text: 'Opened 2 contracts.', personalized: false };
        fixture.componentRef.setInput('observations', [comment]);
        chat.turns.set([{ id: 'turn', conversation_id: 'thread', prompt: 'What changed?', created_at: '2026-09-28T15:00:00Z',
            answer: { meaning: 'Your size increased.', evidence: 'Captured size.', nextStep: 'Review your plan.' },
            context: { capturedAt: '2026-09-28T15:00:00Z', tradeDate: '2026-09-28', accountIds: null, dataReady: false, summary: null,
                replyTo: { id: 'saved', text: comment.text, title: comment.title, observedAt: '2026-09-28T14:00:00Z', snapshot: null } } }]);
        fixture.detectChanges();
        expect(root.querySelectorAll('.coach-chat__observation')).toHaveLength(1);
        expect(root.querySelectorAll('.coach-chat__answer')).toHaveLength(1);
        expect(root.querySelectorAll('ol > li')).toHaveLength(2);
        expect(root.querySelector('ol > li')!.textContent).toContain('Opened 2 contracts.');
        expect(root.querySelector('blockquote')!.textContent).toContain('Opened 2 contracts.');
        expect(chat.send).not.toHaveBeenCalled(); expect(coach.readChatSummary).not.toHaveBeenCalled();
        button('Reply').click(); expect(chat.reply).toHaveBeenCalledWith(comment);
        expect(document.activeElement).toBe(root.querySelector('textarea'));
        fixture.componentRef.setInput('observations', []); fixture.detectChanges();
        expect(root.querySelectorAll('.coach-chat__observation')).toHaveLength(1); // Original survives reopening.
    });
    it('suggestions fill an editable draft but never send or play audio', () => {
        const { fixture, root, button, chat, coach } = setup();
        button('Review my day').click(); fixture.detectChanges();
        expect(chat.draft()).toBe('Help me review this session.');
        expect(chat.send).not.toHaveBeenCalled(); expect(coach.readChatSummary).not.toHaveBeenCalled();
        root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        expect(chat.send).toHaveBeenCalledTimes(1);
        expect(root.querySelector('textarea')!.maxLength).toBe(1000);
    });
    it('renders saved text safely; reopening is silent and read-aloud is explicit', async () => {
        const { fixture, root, button, chat, coach } = setup();
        chat.turns.set([{ id: 'turn', conversation_id: 'thread', prompt: '<script>bad()</script>', created_at: '2026-09-28T15:00:00Z',
            answer: { meaning: '<img src=x onerror=bad()>', evidence: 'Saved context.', nextStep: 'Review your plan.' },
            context: { capturedAt: '2026-09-28T15:00:00Z', tradeDate: '2026-09-28', accountIds: null, dataReady: false, summary: null } }]);
        fixture.detectChanges();
        expect(root.querySelector('script, img')).toBeNull();
        expect(root.textContent).toContain('<img src=x onerror=bad()>');
        expect(root.querySelector('app-live-coach-answer details')!.hasAttribute('open')).toBe(false);
        expect(coach.readChatSummary).not.toHaveBeenCalled();
        button('Read summary').click(); await fixture.whenStable();
        expect(coach.readChatSummary).toHaveBeenCalledTimes(1);
    });
    it('keeps chat uncluttered and preserves read access after downgrade', () => {
        const { fixture, root, button, chat, ai } = setup();
        expect(root.querySelector('select')).toBeNull();
        expect(root.textContent).not.toContain('allowance');
        chat.conversationId.set('thread'); ai.set(false); fixture.detectChanges();
        expect(root.querySelector('textarea')).toBeNull();
        expect(root.querySelector('a')!.getAttribute('href')).toBe('/account/pricing');
        expect(button('Delete chat')).toBeUndefined();
    });
});
