import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { OpenAiService } from '../../core/services/openai.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { LiveCoachFollowUpAnswer, LiveCoachObservation } from './live-coach.models';
import { LiveCoachService } from './live-coach.service';
import { LiveCoachFollowUpService } from './live-coach-follow-up.service';
import { coachQuestions, readCoachFollowUp } from './live-coach-follow-up.utils';

const answer: LiveCoachFollowUpAnswer = {
    meaning: 'This was a copied entry across five accounts.',
    evidence: 'Twenty completed journal trades represent four grouped decisions.',
    nextStep: 'Review the decision sequence against your written plan.',
};
function observation(id = 1): LiveCoachObservation {
    return { id, text: 'Opened 5 contracts across 5 accounts.', time: Date.parse('2026-09-18T15:00:00Z'), personalized: false, title: 'Position opened',
        snapshot: {
            observation: { kind: 'opened', symbol: 'MNQZ6', direction: 'long', previousQuantity: 0, quantity: 5, accountCount: 5, averagePrice: 23000 },
            session: { tradeDate: '2026-09-18', dailyPnl: 200, weeklyPnl: 600, executionCount: 20, decisionCount: 4,
                accountCount: 5, winRate: 50, consecutiveLosses: 1, recentDecisionPnls: [300, -100],
                typicalContractsPerAccount: 1, currentContractsPerAccount: 1 },
        },
    };
}

describe('Live Coach follow-ups', () => {
    function setup() {
        const comments = signal<readonly LiveCoachObservation[]>([observation(), observation(2)]);
        const userId = signal<string | null>('owner-a');
        const demo = signal(false);
        const allowed = signal(true);
        const thinking = signal('ready');
        const generate = vi.fn(async (_payload: unknown, _signal: AbortSignal) => answer);
        TestBed.configureTestingModule({ providers: [
            LiveCoachFollowUpService,
            { provide: LiveCoachService, useValue: { recentComments: comments, aiState: thinking, previewing: signal(false) } },
            { provide: AccessPolicyService, useValue: { demo, canAct: () => allowed() && !demo(), requestAction: () => allowed() && !demo() } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: OpenAiService, useValue: { generateLiveCoachFollowUp: generate } },
        ] });
        const service = TestBed.inject(LiveCoachFollowUpService);
        TestBed.tick();
        return { service, comments, userId, demo, allowed, thinking, generate };
    }
    afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

    it('does nothing on mount, sends only the captured snapshot, and reuses completed answers', async () => {
        const { service, generate } = setup();
        expect(generate).not.toHaveBeenCalled();
        await service.ask(1, 'compare-session');
        expect(generate).toHaveBeenCalledExactlyOnceWith({ question: 'compare-session', comment: observation().text,
            observedAt: '2026-09-18T15:00:00.000Z', snapshot: observation().snapshot }, expect.any(AbortSignal));
        expect(service.state(1, 'compare-session')).toEqual({ status: 'ready', answer });
        await service.ask(1, 'compare-session');
        expect(generate).toHaveBeenCalledOnce();
    });

    it('prevents concurrent/repeated clicks, but does not invalidate a review when a newer position arrives', async () => {
        const { service, generate, comments } = setup();
        let resolve!: (answer: LiveCoachFollowUpAnswer) => void;
        generate.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const request = service.ask(1, 'explain');
        await service.ask(1, 'explain'); await service.ask(2, 'explain');
        comments.update(items => [observation(3), ...items]); TestBed.tick();
        resolve(answer); await request;
        expect(generate).toHaveBeenCalledOnce();
        expect(service.state(1, 'explain')).toEqual({ status: 'ready', answer });
    });

    it.each(['logout', 'switch', 'demo', 'downgrade'] as const)('discards late answers on %s', async change => {
        const { service, generate, userId, demo, allowed } = setup();
        let resolve!: (answer: LiveCoachFollowUpAnswer) => void;
        generate.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const request = service.ask(1, 'explain');
        const signal = generate.mock.calls[0][1];
        if (change === 'demo') demo.set(true);
        else if (change === 'downgrade') allowed.set(false);
        else userId.set(change === 'logout' ? null : 'owner-b');
        TestBed.tick(); resolve(answer); await request;
        expect(signal.aborted).toBe(true);
        expect(service.state(1, 'explain')).toBeUndefined();
        expect(service.pending()).toBeNull();
    });

    it('clears evicted history and cancels requests for evicted observations', async () => {
        const { service, comments, generate } = setup();
        await service.ask(1, 'explain');
        generate.mockReturnValueOnce(new Promise(() => {}));
        const pending = service.ask(2, 'explain');
        comments.set([]); TestBed.tick(); await pending;
        expect(service.state(1, 'explain')).toBeUndefined();
        expect(service.state(2, 'explain')).toBeUndefined();
        expect(service.pending()).toBeNull();
    });

    it('surfaces quota/plan errors and allows an explicit retry without automatically retrying', async () => {
        const { service, generate } = setup();
        generate.mockRejectedValueOnce(new Error('Live Coach AI daily limit reached (30 comments).'));
        await service.ask(1, 'explain');
        expect(service.state(1, 'explain')).toEqual({ status: 'error', message: 'Live Coach AI daily limit reached (30 comments).' });
        expect(generate).toHaveBeenCalledOnce();
        await service.ask(1, 'explain');
        expect(service.state(1, 'explain')?.status).toBe('ready');
    });

    it('cancels a stalled request at a bounded deadline', async () => {
        vi.useFakeTimers();
        const { service, generate } = setup();
        generate.mockReturnValueOnce(new Promise(() => {}));
        const request = service.ask(1, 'explain');
        await vi.advanceTimersByTimeAsync(20_000); await request;
        expect(generate.mock.calls[0][1].aborted).toBe(true);
        expect(service.state(1, 'explain')).toEqual({ status: 'error', message: 'This answer took too long. Please try again.' });
        expect(service.pending()).toBeNull();
    });

    it('allows text-only explanations for guardrails but not fabricated session comparisons', async () => {
        const { service, comments, generate } = setup();
        comments.set([{ ...observation(), snapshot: undefined, text: 'Daily target touched including estimated open profit.' }]); TestBed.tick();
        await service.ask(1, 'compare-session');
        expect(generate).not.toHaveBeenCalled();
        await service.ask(1, 'explain');
        expect(generate.mock.calls[0][0]).toEqual(expect.objectContaining({ snapshot: null, question: 'explain' }));
        expect(coachQuestions({ ...observation(), snapshot: undefined })).toEqual(['explain']);
    });

    it('does not request AI while live commentary is being prepared or permission is denied', async () => {
        const { service, thinking, allowed, generate } = setup();
        thinking.set('thinking'); await service.ask(1, 'explain');
        expect(service.state(1, 'explain')?.status).toBe('error');
        thinking.set('ready'); allowed.set(false); TestBed.tick();
        await service.ask(1, 'explain');
        expect(generate).not.toHaveBeenCalled();
    });

    it('rejects malformed or oversized replies at the client boundary', () => {
        for (const invalid of [null, 'text', [], { ...answer, meaning: '' }, { ...answer, evidence: 'x'.repeat(421) }]) {
            expect(readCoachFollowUp(invalid)).toBeNull();
        }
        expect(readCoachFollowUp({ ...answer, extra: 'ignored' })).toEqual(answer);
    });
});
