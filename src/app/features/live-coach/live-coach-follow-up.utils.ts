import { LiveCoachFollowUpAnswer, LiveCoachObservation, LiveCoachQuestion } from './live-coach.models';

export const COACH_QUESTIONS: Readonly<Record<LiveCoachQuestion, string>> = {
    explain: 'Explain this',
    'compare-session': 'Compare with this session',
};

export function coachQuestions(comment: LiveCoachObservation): LiveCoachQuestion[] {
    return comment.snapshot && comment.snapshot.session.executionCount > 0
        ? ['explain', 'compare-session'] : ['explain'];
}

/** Validate at the client boundary as well; render as text, never model-supplied HTML. */
export function readCoachFollowUp(value: unknown): LiveCoachFollowUpAnswer | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const fields = value as Record<string, unknown>;
    const keys = ['meaning', 'evidence', 'nextStep'] as const;
    if (!keys.every(key => typeof fields[key] === 'string' && fields[key].trim().length > 0 && fields[key].length <= 420)) return null;
    return { meaning: (fields['meaning'] as string).trim(), evidence: (fields['evidence'] as string).trim(), nextStep: (fields['nextStep'] as string).trim() };
}
