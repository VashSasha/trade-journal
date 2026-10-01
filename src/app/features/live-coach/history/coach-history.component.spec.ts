import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachHistoryComponent } from './coach-history.component';
import { CoachHistoryService } from './coach-history.service';
import { SavedCoachObservation } from './coach-history.model';

const saved: SavedCoachObservation = {
    id: 'test-id', observed_at: '2026-09-18T15:00:00Z', trade_date: '2026-09-18', title: 'Position opened',
    content: '<img src=x onerror=alert(1)>', personalized: false, snapshot: null,
    explanation: { meaning: 'Copied entry.', evidence: 'Five accounts.', nextStep: 'Review your plan.' }, session_comparison: null,
};

function setup() {
    const history = { items: signal<SavedCoachObservation[]>([saved]), loading: signal(false), error: signal<string | null>(null),
        date: signal(''), hasMore: signal(false), deleting: signal<string | null>(null), load: vi.fn(), remove: vi.fn(async () => true) };
    TestBed.configureTestingModule({ providers: [{ provide: CoachHistoryService, useValue: history }] });
    const fixture = TestBed.createComponent(CoachHistoryComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
    return { fixture, root, history, button };
}
afterEach(() => TestBed.resetTestingModule());

describe('Coach history UI', () => {
    it('offers an optional reply action without fetching, sending or creating conversations', () => {
        const { fixture, button, history } = setup();
        expect(button('Reply in chat')).toBeUndefined();
        const reply = vi.fn(); fixture.componentInstance.replyRequested.subscribe(reply);
        fixture.componentRef.setInput('replyEnabled', true); fixture.detectChanges();
        button('Reply in chat').click(); expect(reply).toHaveBeenCalledWith(saved);
        fixture.componentRef.setInput('replyBlocked', true); fixture.detectChanges(); expect(button('Reply in chat').disabled).toBe(true);
        expect(history.load).toHaveBeenCalledOnce(); expect(history.remove).not.toHaveBeenCalled();
    });
    it('renders saved text and structured answers without HTML execution or AI/audio dependencies', () => {
        const { root, history } = setup();
        expect(history.load).toHaveBeenCalledOnce();
        expect(root.textContent).toContain(saved.content);
        expect(root.querySelector('img')).toBeNull();
        expect(root.querySelector('audio')).toBeNull();
        expect(root.textContent).toContain('Copied entry.');
        expect(root.textContent).toContain('Five accounts.');
    });
    it('requires confirmation, preserves the row on failure, and disables duplicate delete clicks', async () => {
        const { root, history, fixture, button } = setup();
        button('Delete').click(); fixture.detectChanges();
        expect(history.remove).not.toHaveBeenCalled();
        expect(root.textContent).toContain('Trades, journal notes and quoted copies in chats stay unchanged');
        button('Keep').click(); fixture.detectChanges();
        expect(history.remove).not.toHaveBeenCalled();
        button('Delete').click(); fixture.detectChanges();
        history.remove.mockResolvedValueOnce(false);
        button('Delete permanently').click(); await fixture.whenStable(); fixture.detectChanges();
        expect(history.remove).toHaveBeenCalledExactlyOnceWith(saved.id);
        expect(button('Delete permanently')).toBeDefined();
        history.deleting.set(saved.id); fixture.detectChanges();
        expect(button('Deleting…').disabled).toBe(true);
    });
    it('has filter, loading, failure, empty and older-page controls', () => {
        const { root, history, fixture, button } = setup();
        const input = root.querySelector('input')!;
        input.value = '2026-09-19'; input.dispatchEvent(new Event('change'));
        expect(history.load).toHaveBeenCalledWith('2026-09-19');
        history.hasMore.set(true); fixture.detectChanges(); button('Load older observations').click();
        expect(history.load).toHaveBeenCalledWith('', true);
        history.loading.set(true); fixture.detectChanges(); expect(button('Refresh').disabled).toBe(true);
        history.loading.set(false); history.items.set([]); history.date.set('2026-09-19'); fixture.detectChanges();
        expect(root.textContent).toContain('No observations for this day');
        history.date.set(''); fixture.detectChanges();
        expect(root.textContent).toContain('No coaching observations yet.');
        history.error.set('Could not load saved history. Try again.'); fixture.detectChanges();
        expect(root.querySelector('[role="alert"]')?.textContent).toContain('Could not load');
    });
});
