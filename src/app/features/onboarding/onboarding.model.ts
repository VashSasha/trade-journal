export interface OnboardingProgress {
    started: boolean;
    dismissed: boolean;
    accountsReviewed: boolean;
    alertsReviewed: boolean;
}

export function parseOnboardingProgress(value: unknown): OnboardingProgress {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
        started: row['started'] === true,
        dismissed: row['dismissed'] === true,
        accountsReviewed: row['accountsReviewed'] === true,
        alertsReviewed: row['alertsReviewed'] === true,
    };
}
