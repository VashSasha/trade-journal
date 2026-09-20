import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { OpenAiService } from '../../core/services/openai.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { LiveCoachFollowUpAnswer, LiveCoachQuestion } from './live-coach.models';
import { coachQuestions } from './live-coach-follow-up.utils';
import { LiveCoachService } from './live-coach.service';

export type CoachFollowUpState =
    | { status: 'loading' }
    | { status: 'ready'; answer: LiveCoachFollowUpAnswer }
    | { status: 'error'; message: string };

/** Widget-scoped: bounded session history, one explicit request at a time, no autoplay. */
@Injectable()
export class LiveCoachFollowUpService {
    private readonly ai = inject(OpenAiService);
    private readonly coach = inject(LiveCoachService);
    private readonly access = inject(AccessPolicyService);
    private readonly session = inject(UserSessionService);
    private readonly states = signal<Readonly<Record<string, CoachFollowUpState>>>({});
    readonly pending = signal<string | null>(null);
    private controller: AbortController | null = null;
    private generation = 0;

    constructor() {
        effect(() => {
            this.session.userId();
            this.access.demo();
            // Also reset when entitlement changes (without tying review to voice mute).
            this.access.canAct('ai');
            untracked(() => {
                this.cancel();
                this.states.set({});
            });
        });
        effect(() => {
            const ids = new Set(this.coach.recentComments().map(comment => String(comment.id)));
            untracked(() => {
                if (this.pending() && !ids.has(this.pending()!.split(':')[0])) this.cancel();
                this.states.update(states => Object.fromEntries(Object.entries(states).filter(([key]) => ids.has(key.split(':')[0]))));
            });
        });
        inject(DestroyRef).onDestroy(() => this.cancel());
    }

    key(id: number, question: LiveCoachQuestion): string { return `${id}:${question}`; }
    state(id: number, question: LiveCoachQuestion): CoachFollowUpState | undefined { return this.states()[this.key(id, question)]; }

    async ask(id: number, question: LiveCoachQuestion): Promise<void> {
        if (!this.access.requestAction('ai')) return;
        const comment = this.coach.recentComments().find(item => item.id === id);
        if (!comment || !coachQuestions(comment).includes(question)) return;
        const key = this.key(id, question);
        if (this.pending() || this.states()[key]?.status === 'ready') return;
        if (this.coach.aiState() === 'thinking' || this.coach.previewing()) {
            this.setState(key, { status: 'error', message: 'The Coach is preparing a live comment. Try again in a moment.' });
            return;
        }

        const owner = this.session.userId();
        if (!owner) return;
        const generation = ++this.generation;
        const controller = new AbortController();
        this.controller = controller;
        this.pending.set(key);
        this.setState(key, { status: 'loading' });
        let timedOut = false;
        const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
        let onAbort: (() => void) | undefined;
        try {
            const request = this.ai.generateLiveCoachFollowUp({
                question, observedAt: new Date(comment.time).toISOString(), comment: comment.text,
                snapshot: comment.snapshot ? structuredClone(comment.snapshot) : null,
            }, controller.signal);
            const answer = await Promise.race([request, new Promise<never>((_, reject) => {
                onAbort = () => reject(new Error('Follow-up cancelled.'));
                controller.signal.addEventListener('abort', onAbort, { once: true });
            })]);
            if (this.current(generation, owner) && !controller.signal.aborted) this.setState(key, { status: 'ready', answer });
        } catch (error) {
            if (this.current(generation, owner)) this.setState(key, {
                status: 'error', message: timedOut ? 'This answer took too long. Please try again.'
                    : error instanceof Error ? error.message : 'Could not load this answer. Please try again.',
            });
        } finally {
            clearTimeout(deadline);
            if (onAbort) controller.signal.removeEventListener('abort', onAbort);
            if (generation === this.generation) { this.pending.set(null); this.controller = null; }
        }
    }

    cancel(): void {
        this.generation++;
        this.controller?.abort();
        this.controller = null;
        const key = this.pending();
        this.pending.set(null);
        if (key) this.setState(key, { status: 'error', message: 'Request cancelled. You can try again.' });
    }

    private current(generation: number, owner: string): boolean {
        return generation === this.generation && owner === this.session.userId() && this.access.canAct('ai') && !this.access.demo();
    }

    private setState(key: string, state: CoachFollowUpState): void {
        this.states.update(states => ({ ...states, [key]: state }));
    }
}
