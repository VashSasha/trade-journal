import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveCoachService } from '../live-coach.service';
import { CoachChatComponent } from './coach-chat.component';
import { CoachChatService } from './coach-chat.service';
import { CoachChatObservation, CoachChatTurn, CoachVoiceMessage } from './coach-chat.model';
import { CoachVoiceService } from '../voice/coach-voice.service';

function setup() {
    const ai = signal(true);
    const chat = { access: { canAct: () => ai(), demo: () => false }, conversations: signal([]), conversationId: signal<string | null>(null),
        busy: signal(false), deleting: signal(false), loading: signal(false), listing: signal(false), hasMore: signal(false),
        listError: signal(null), error: signal(null), pending: signal(null), turns: signal<CoachChatTurn[]>([]), voiceMessages: signal<CoachVoiceMessage[]>([]), draft: signal(''),
        replyTo: signal<CoachChatObservation | null>(null), reply: vi.fn(() => true), canReply: signal(true),
        loadFailed: signal(false), notice: signal<string | null>(null), storageWarning: signal(false),
        day: signal('2026-09-28'), accountIds: signal(null), dataReady: signal(false), allowance: signal({ day: '2026-09-28', remaining: 26 }),
        send: vi.fn(), remove: vi.fn(), refreshAllowance: vi.fn(), invalidateAllowance: vi.fn(), open: vi.fn(), newConversation: vi.fn(), cancel: vi.fn() };
    const coach = { paused: signal(false), readingSummary: signal(false), readChatSummary: vi.fn(async () => true) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: CoachChatService, useValue: chat }, { provide: LiveCoachService, useValue: coach }] });
    const voice = { configured: false, supported: true, active: signal(false), state: signal('listening'),
        muted: signal(false), remaining: signal(180), allowance: signal(null), heard: signal(''), reply: signal(''), notice: signal(''),
        error: signal(''), start: vi.fn(), toggleMute: vi.fn(), end: vi.fn(async () => {}) };
    TestBed.overrideComponent(CoachChatComponent, { set: { providers: [{ provide: CoachVoiceService, useValue: voice }] } });
    const fixture = TestBed.createComponent(CoachChatComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!;
    return { fixture, root, button, chat, coach, ai, voice };
}
afterEach(() => TestBed.resetTestingModule());
describe('Ask Coach interface', () => {
    it('keeps idle voice in the composer and active transcripts in the conversation', () => {
        const { fixture, root, voice } = setup();
        expect(root.querySelector('.coach-chat__composer app-coach-voice')).not.toBeNull();
        expect(root.querySelectorAll('app-coach-voice')).toHaveLength(1);
        expect(root.textContent).not.toContain('Talk to Coach');
        voice.active.set(true); voice.heard.set('How was my day?'); voice.reply.set('<b>Review your sizing.</b>');
        fixture.detectChanges();
        expect(root.querySelectorAll('app-coach-voice')).toHaveLength(1);
        expect(root.querySelector('.coach-chat__composer')).toBeNull();
        expect(root.querySelector('.coach-chat__turns')?.textContent).toContain('How was my day?');
        expect(root.querySelector('.coach-chat__turns')?.textContent).toContain('<b>Review your sizing.</b>');
        expect(root.querySelector('.coach-chat__turns b')).toBeNull();
        expect(root.querySelector('app-coach-voice')?.textContent).not.toContain('Review your sizing.');
        voice.active.set(false); fixture.detectChanges();
        expect(root.querySelector('.coach-chat__turns')?.textContent).not.toContain('How was my day?');
        expect(root.querySelector('.coach-chat__composer app-coach-voice')).not.toBeNull();
        expect(voice.start).not.toHaveBeenCalled();
    });
    it('keeps voice failures above the composer, outside the scrollable history', () => {
        const { fixture, root, voice } = setup();
        voice.error.set('Daily voice allowance reached. Text chat is still available.');
        fixture.detectChanges();
        const alert = root.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('Daily voice allowance reached');
        expect(alert.closest('.coach-chat__scroll')).toBeNull();
        expect(root.querySelector('textarea')).not.toBeNull();
    });
    it('renders saved voice safely and ends when hidden, even without component destruction', () => {
        const { fixture, root, chat, voice } = setup();
        chat.voiceMessages.set([{ session_id:'session', item_id:'item', role:'assistant', content:'<img src=x onerror=bad()>',
            interrupted:false, created_at:'2026-10-08T12:00:00Z', context:{capturedAt:'2026-10-08T12:00:00Z', tradeDate:'2026-10-08', accountIds:null, dataReady:false, summary:null} }]);
        fixture.detectChanges(); expect(root.querySelector('img')).toBeNull(); expect(root.textContent).toContain('Coach · voice');
        voice.active.set(true); fixture.detectChanges(); expect(root.querySelector('textarea')).toBeNull();
        fixture.componentRef.setInput('visible', false); fixture.detectChanges(); expect(voice.end).toHaveBeenCalledOnce();
    });
    it('shows a historical reply in the timeline and focuses the composer without sending', async () => {
        const { fixture, root, chat, coach } = setup();
        chat.replyTo.set({ id: 'old', title: 'Position increased', text: 'A saved observation.', observedAt: '2026-09-18T15:00:00Z', snapshot: null });
        fixture.detectChanges(); await fixture.whenStable();
        expect(root.querySelector('.coach-chat__observation')?.textContent).toContain('A saved observation.');
        expect(root.querySelector('.coach-chat__reply-preview')?.textContent).toContain('Sep 18');
        expect(document.activeElement).toBe(root.querySelector('textarea'));
        expect(chat.send).not.toHaveBeenCalled(); expect(coach.readChatSummary).not.toHaveBeenCalled();
    });
    it('offers retry when restoration fails and disables sending until history loads', () => {
        const { fixture, root, button, chat } = setup();
        chat.conversationId.set('saved-chat'); chat.loadFailed.set(true); chat.draft.set('Question');
        fixture.detectChanges();
        expect(button('Send message').disabled).toBe(true); expect(root.querySelector('.coach-chat__intro')).toBeNull();
        button('Retry loading').click(); expect(chat.open).toHaveBeenCalledWith('saved-chat');
        button('New chat').click(); expect(chat.newConversation).toHaveBeenCalledOnce();
        chat.loadFailed.set(false); fixture.detectChanges(); expect(button('Send message').disabled).toBe(false);
    });
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
        expect(button('More details').getAttribute('aria-expanded')).toBe('false');
        expect(coach.readChatSummary).not.toHaveBeenCalled();
        button('Read summary').click(); await fixture.whenStable();
        expect(coach.readChatSummary).toHaveBeenCalledTimes(1);
        expect(chat.invalidateAllowance).toHaveBeenCalledOnce();
        expect(chat.refreshAllowance).not.toHaveBeenCalled();
    });
    it('groups answer controls in one row, with independent full-width disclosures and no automatic requests', () => {
        const { fixture, root, chat, coach, ai } = setup();
        const turn: CoachChatTurn = { id: 'one', conversation_id: 'thread', prompt: 'Review my day.', created_at: '2026-09-28T15:00:00Z',
            answer: { meaning: 'Review your sizing.', evidence: 'Your saved trades.', nextStep: 'Write a plan.' },
            context: { capturedAt: '2026-09-28T15:00:00Z', tradeDate: '2026-09-28', accountIds: null, dataReady: false, summary: null } };
        chat.turns.set([turn, { ...turn, id: 'two' }]); fixture.detectChanges();
        const rows = [...root.querySelectorAll<HTMLElement>('.coach-answer__actions')];
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect([...row.querySelectorAll('button')].map(b => b.textContent!.trim())).toEqual(['More details', 'Read summary', 'Context']);
        }
        const [details, , context] = [...rows[0].querySelectorAll<HTMLButtonElement>('button')];
        const detailsPanel = root.querySelector<HTMLElement>(`#${details.getAttribute('aria-controls')}`)!;
        const contextPanel = root.querySelector<HTMLElement>(`#${context.getAttribute('aria-controls')}`)!;
        expect(detailsPanel.hidden).toBe(true); expect(contextPanel.hidden).toBe(true);
        expect(rows[0].contains(detailsPanel)).toBe(false); expect(rows[0].contains(contextPanel)).toBe(false);
        details.click(); fixture.detectChanges();
        expect(details.getAttribute('aria-expanded')).toBe('true'); expect(detailsPanel.hidden).toBe(false);
        expect(contextPanel.hidden).toBe(true);
        context.click(); fixture.detectChanges();
        expect(contextPanel.hidden).toBe(false); expect(contextPanel.textContent).toContain('All saved accounts');
        details.click(); fixture.detectChanges(); expect(detailsPanel.hidden).toBe(true); expect(contextPanel.hidden).toBe(false);
        expect(rows[1].querySelector('button')!.getAttribute('aria-controls')).not.toBe(details.getAttribute('aria-controls'));
        expect(rows[1].querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
        expect(chat.send).not.toHaveBeenCalled(); expect(chat.refreshAllowance).not.toHaveBeenCalled();
        expect(coach.readChatSummary).not.toHaveBeenCalled();
        ai.set(false); fixture.detectChanges();
        expect([...rows[0].querySelectorAll('button')].map(b => b.textContent!.trim())).toEqual(['More details', 'Context']);
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
