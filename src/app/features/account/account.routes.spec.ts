import { ACCOUNT_ROUTES } from './account.routes';

describe('settings routes', () => {
    it('keeps every settings section directly linkable', () => {
        const paths = ACCOUNT_ROUTES[0].children?.map(route => route.path);
        expect(paths).toEqual(['', 'profile', 'sign-in', 'plan', 'integrations', 'alerts', 'appearance', 'data']);
    });

    it('gates broker integrations without gating personal settings', () => {
        const children = ACCOUNT_ROUTES[0].children!;
        expect(children.find(route => route.path === 'integrations')?.canActivate).toHaveLength(1);
        expect(children.find(route => route.path === 'alerts')?.canActivate).toBeUndefined();
        expect(children.find(route => route.path === 'profile')?.canActivate).toBeUndefined();
    });
});
