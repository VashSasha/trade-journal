import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountService } from '../../../../core/services/account.service';
import { AccountSelectorComponent } from './account-selector.component';

describe('header account selector', () => {
    function setup() {
        const ids = signal([1, 2]);
        const balance = signal<number | null>(1200);
        const busy = signal(false);
        const account = {
            selectedIds: ids, currentBalance: balance, aggregatedBalance: () => balance() ?? 0,
            accounts: signal([{ id: 1, name: 'Live trading account' }]),
            historicalAccounts: signal([{ id: 2, name: 'Historical evaluation account with a long name' }]),
            accountBalances: signal(new Map([[1, 1000], [2, 200]])),
            staleAsOf: signal<string | null>('2026-09-18T10:00:00Z'), isRefreshing: busy,
            init: vi.fn(), refreshBalances: vi.fn(() => busy.set(true)),
            selectAll: vi.fn(() => ids.set([1, 2])), deselectAll: vi.fn(() => ids.set([])),
            toggle: vi.fn((id: number) => ids.update(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])),
        };
        TestBed.configureTestingModule({ providers: [{ provide: AccountService, useValue: account }] });
        const fixture = TestBed.createComponent(AccountSelectorComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const trigger = root.querySelector<HTMLButtonElement>('.acct-widget__trigger')!;
        const open = async () => { trigger.click(); fixture.detectChanges(); await fixture.whenStable(); };
        return { fixture, root, trigger, account, ids, balance, busy, open };
    }
    afterEach(() => TestBed.resetTestingModule());

    it('shows the selection name or count, preserves zero balances, and labels stored balances', () => {
        const { fixture, root, ids, balance, account } = setup();
        expect(account.init).toHaveBeenCalledOnce();
        expect(root.textContent).toContain('2 accounts selected');
        expect(root.textContent).toContain('$1,200.00');
        expect(root.textContent).toContain('Last known');
        ids.set([2]); balance.set(0); fixture.detectChanges();
        expect(root.textContent).toContain('Historical evaluation account with a long name');
        expect(root.querySelector('.acct-widget__value')?.textContent).toContain('$0.00');
        ids.set([]); fixture.detectChanges();
        expect(root.querySelector('.acct-widget__value')?.textContent?.trim()).toBe('—');
    });

    it('opens from the balance area and restores focus on Escape', async () => {
        const { fixture, root, trigger, open } = setup();
        await open();
        const close = root.querySelector<HTMLButtonElement>('.acct-dropdown__close')!;
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(close);
        expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('account-selection-title');
        close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges();
        expect(root.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps active and historical selection in the existing account service', async () => {
        const { fixture, root, account, ids, open } = setup(); await open();
        const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
        expect(checkboxes).toHaveLength(2);
        expect(checkboxes[1].checked).toBe(true);
        checkboxes[1].click(); fixture.detectChanges();
        expect(account.toggle).toHaveBeenCalledWith(2);
        expect(ids()).toEqual([1]);
        expect(root.textContent).toContain('Historical evaluation account with a long name');
        root.querySelectorAll<HTMLButtonElement>('.acct-dropdown__action')[1].click(); fixture.detectChanges();
        expect(account.deselectAll).toHaveBeenCalledOnce();
        expect(ids()).toEqual([]);
    });

    it('closes when keyboard focus leaves, without stealing focus back', async () => {
        const { fixture, root, trigger, open } = setup(); await open();
        const outside = document.createElement('button'); document.body.append(outside);
        try {
            outside.focus(); fixture.detectChanges();
            expect(root.querySelector('[role="dialog"]')).toBeNull();
            expect(document.activeElement).toBe(outside);
            await open(); document.body.click(); fixture.detectChanges();
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
        } finally { outside.remove(); }
    });

    it('disables both refresh controls while balances are refreshing', async () => {
        const { fixture, root, account, open } = setup(); await open();
        root.querySelector<HTMLButtonElement>('.acct-widget__refresh')!.click(); fixture.detectChanges();
        const buttons = root.querySelectorAll<HTMLButtonElement>('.acct-widget__refresh, .acct-dropdown__action--refresh');
        expect([...buttons].every(button => button.disabled)).toBe(true);
        buttons.forEach(button => button.click());
        expect(account.refreshBalances).toHaveBeenCalledOnce();
    });
});
