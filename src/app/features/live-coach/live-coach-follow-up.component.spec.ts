import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { OpenAiService } from '../../core/services/openai.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { LiveCoachFollowUpComponent } from './live-coach-follow-up.component';
import { LiveCoachFollowUpService } from './live-coach-follow-up.service';
import { LiveCoachFollowUpAnswer, LiveCoachObservation } from './live-coach.models';
import { LiveCoachService } from './live-coach.service';

const answer: LiveCoachFollowUpAnswer = { meaning: 'Size increased across copied accounts.',
    evidence: 'Four completed trades represent two estimated decisions.', nextStep: 'Compare the sizing with your written plan.' };
const observation: LiveCoachObservation = {
    id: 42, text: 'Opened two contracts across two accounts.', personalized: false, title: 'Position opened', time: Date.parse('2026-09-18T15:00:00Z'),
    snapshot: {
        observation: { kind: 'opened', symbol: 'MNQZ6', direction: 'long', previousQuantity: 0, quantity: 2, accountCount: 2, averagePrice: 23000 },
        session: { tradeDate: '2026-09-18', dailyPnl: 100, weeklyPnl: 200, executionCount: 4, decisionCount: 2, accountCount: 2,
            winRate: 50, consecutiveLosses: 1, recentDecisionPnls: [200, -100], typicalContractsPerAccount: 1, currentContractsPerAccount: 1 },
    },
};

describe('Coach follow-up UI', () => {
    function setup(comment = observation) {
        const paid = signal(true);
        const generate = vi.fn(async (_payload: unknown, _signal: AbortSignal) => answer);
        TestBed.configureTestingModule({ providers: [
            LiveCoachFollowUpService,
            { provide: LiveCoachService, useValue: { recentComments: signal([comment]), aiState: signal('ready'), previewing: signal(false) } },
            { provide: AccessPolicyService, useValue: { demo: signal(false), canAct: paid, requestAction: paid } },
            { provide: UserSessionService, useValue: { userId: signal('owner-a') } },
            { provide: OpenAiService, useValue: { generateLiveCoachFollowUp: generate } },
        ] });
        const fixture = TestBed.createComponent(LiveCoachFollowUpComponent);
        fixture.componentRef.setInput('comment', comment);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)!;
        const settle = async () => { await vi.waitFor(() => expect(TestBed.inject(LiveCoachFollowUpService).pending()).toBeNull()); fixture.detectChanges(); };
        return { fixture, root, button, generate, paid, settle };
    }
    afterEach(() => TestBed.resetTestingModule());

    it('loads only on demand, displays structured context, and reopens a cached answer', async () => {
        const { fixture, root, button, generate, settle } = setup();
        expect(generate).not.toHaveBeenCalled();
        button('Explain this').click(); await settle();
        expect(button('Explain this').getAttribute('aria-expanded')).toBe('true');
        expect(root.querySelector('#coach-answer-42')).not.toBeNull();
        expect([...root.querySelectorAll('dt')].map(el => el.textContent)).toEqual(['What it means', 'Evidence', 'Review next']);
        expect(root.textContent).toContain('Captured session context');
        expect(root.textContent).toContain(answer.evidence);
        button('Explain this').click(); fixture.detectChanges();
        expect(root.querySelector('#coach-answer-42')).toBeNull();
        button('Explain this').click(); await settle();
        expect(generate).toHaveBeenCalledOnce();
        button('Compare with this session').click(); await settle();
        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[1][0]).toEqual(expect.objectContaining({ question: 'compare-session' }));
    });

    it('disables competing requests and cancels without waiting for a stalled provider', async () => {
        const { fixture, root, button, generate, settle } = setup();
        generate.mockReturnValueOnce(new Promise(() => {}));
        button('Explain this').click(); fixture.detectChanges();
        expect(root.textContent).toContain('Reviewing the captured context');
        expect(button('Compare with this session').disabled).toBe(true);
        button('Cancel request').click(); await settle();
        expect(generate.mock.calls[0][1].aborted).toBe(true);
        expect(root.textContent).toContain('Request cancelled');
        expect(button('Compare with this session').disabled).toBe(false);
    });

    it('surfaces failures and retries explicitly; model text cannot create HTML', async () => {
        const { root, button, generate, settle } = setup();
        generate.mockRejectedValueOnce(new Error('Daily Coach allowance reached.'));
        button('Explain this').click(); await settle();
        expect(root.textContent).toContain('Daily Coach allowance reached.');
        expect(generate).toHaveBeenCalledOnce();
        generate.mockResolvedValueOnce({ ...answer, meaning: '<img src=x onerror=alert(1)>' });
        button('Try again').click(); await settle();
        expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(root.querySelector('img')).toBeNull();
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it('offers only explanations without captured numbers and hides questions without access', async () => {
        const { fixture, root, button, paid, generate, settle } = setup({ ...observation, snapshot: undefined });
        expect(button('Compare with this session')).toBeUndefined();
        button('Explain this').click(); await settle();
        expect(root.textContent).toContain('Original message only');
        paid.set(false); fixture.detectChanges();
        expect(root.querySelector('button')).toBeNull();
        expect(generate).toHaveBeenCalledOnce();
    });
});
