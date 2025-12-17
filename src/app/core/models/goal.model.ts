export type GoalType = 'monthly_pnl' | 'yearly_pnl' | 'monthly_trades' | 'win_rate';
export type GoalStatus = 'active' | 'achieved' | 'failed';

export interface Goal {
    id: string;
    type: GoalType;
    label: string;      // User friendly name e.g. "January $5k"
    target: number;
    current: number;
    deadline: string;   // ISO date
    status: GoalStatus;
    period: 'month' | 'year'; // Helper to know when to reset/check
}
