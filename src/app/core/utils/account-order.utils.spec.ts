import { describe, expect, it } from 'vitest';
import { newestAccountsFirst } from './account-order.utils';

describe('account ordering', () => {
    it('orders newest broker dates first, without mutating input', () => {
        const source = [{ id: 9, timestamp: '2026-01-01' }, { id: 2, timestamp: '2026-09-01' }];
        expect(newestAccountsFirst(source).map(a => a.id)).toEqual([2, 9]);
        expect(source[0].id).toBe(9);
    });
    it('uses descending IDs consistently when creation dates are missing or invalid', () => {
        expect(newestAccountsFirst([{ id: 1 }, { id: 4, timestamp: 'invalid' }, { id: 0 }, { id: 3 }]).map(a => a.id))
            .toEqual([4, 3, 1, 0]);
    });
});
