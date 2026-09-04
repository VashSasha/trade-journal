import { Component, inject, signal } from '@angular/core';

import { GoalService } from '../../../../core/services/goal.service';
import { Goal, GoalType } from '../../../../core/models/goal.model';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
    selector: 'app-goals-widget',
    standalone: true,
    imports: [ReactiveFormsModule],
    templateUrl: './goals-widget.component.html',
    styleUrl: './goals-widget.component.scss'
})
export class GoalsWidgetComponent {
    private goalService = inject(GoalService);
    private fb = inject(FormBuilder);

    goals = this.goalService.goals;

    isAdding = signal(false);
    error = signal<string | null>(null);

    goalForm = this.fb.group({
        type: ['monthly_pnl' as GoalType, Validators.required],
        target: [1000, [Validators.required, Validators.min(1)]],
        period: ['month' as 'month' | 'year', Validators.required]
    });

    toggleAdd(): void {
        this.isAdding.set(!this.isAdding());
    }

    deleteGoal(id: string): void {
        this.error.set(null);
        try { this.goalService.deleteGoal(id); }
        catch (err) { this.error.set(err instanceof Error ? err.message : 'Could not remove the goal.'); }
    }

    onSubmit(): void {
        this.error.set(null);
        if (this.goalForm.valid) {
            const { type, target, period } = this.goalForm.value;
            try { this.goalService.addGoal(type!, target!, type === 'yearly_pnl' ? 'year' : period!); }
            catch (err) {
                this.error.set(err instanceof Error ? err.message : 'Could not save the goal.');
                return;
            }
            this.isAdding.set(false);
            this.goalForm.reset({ type: 'monthly_pnl', target: 1000, period: 'month' });
        }
    }

    calculateProgress(goal: Goal): number {
        if (goal.target === 0) return 0;
        const progress = (goal.current / goal.target) * 100;
        return Math.min(Math.max(progress, 0), 100); // Clamp between 0 and 100
    }

    formatValue(value: number, type: GoalType): string {
        if (type === 'win_rate') return `${value.toFixed(1)}%`;
        if (type === 'monthly_trades') return `${value}`;
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    }
}
