export const ALERT_SOUND_KINDS = [
    'open', 'close', 'target', 'risk', 'dailyProfit', 'weeklyProfit', 'dailyLoss', 'weeklyLoss',
    'dailyTrades', 'dailyProfitOpen', 'marketEvent', 'positionOpened', 'positionIncreased',
    'positionReduced', 'positionClosed', 'positionReversed',
] as const;
export type AlertSoundKind = typeof ALERT_SOUND_KINDS[number];
export type BaseAlertSoundKind = 'open' | 'close' | 'target' | 'risk';

/** Existing group-level uploads/choices remain defaults for more specific cues. */
export const SOUND_FALLBACKS: Partial<Record<AlertSoundKind, BaseAlertSoundKind>> = {
    dailyProfit: 'target', weeklyProfit: 'target', dailyProfitOpen: 'target',
    dailyLoss: 'risk', weeklyLoss: 'risk', dailyTrades: 'risk', marketEvent: 'risk',
};
/** Retired cues: retain persisted keys/uploads for compatibility, never play. */
export const POSITION_SOUND_KINDS: readonly AlertSoundKind[] = [
    'positionOpened', 'positionIncreased', 'positionReduced', 'positionClosed', 'positionReversed',
];

/** Visible triggers only; target/risk remain internal for legacy saved sounds. */
export const ALERT_SOUND_OPTIONS: readonly { kind: AlertSoundKind; label: string; detail: string }[] = [
    { kind: 'open', label: 'Session opening', detail: 'When a tracked session starts' },
    { kind: 'close', label: 'Session closing', detail: 'When a tracked session ends' },
    { kind: 'dailyProfit', label: 'Daily profit target', detail: 'Realized profit reaches your daily target' },
    { kind: 'weeklyProfit', label: 'Weekly profit target', detail: 'Realized profit reaches your weekly target' },
    { kind: 'dailyProfitOpen', label: 'Target with open P&L', detail: 'Daily target touched including unrealized profit' },
    { kind: 'dailyLoss', label: 'Daily loss limit', detail: 'Your daily loss guardrail is reached' },
    { kind: 'weeklyLoss', label: 'Weekly loss limit', detail: 'Your weekly loss guardrail is reached' },
    { kind: 'dailyTrades', label: 'Daily trade limit', detail: 'Your grouped-trade limit is reached. Scale-ins, partial exits and matching copies count once when the history supports grouping.' },
    { kind: 'marketEvent', label: 'Upcoming economic event', detail: 'Before a scheduled news release' },
];
