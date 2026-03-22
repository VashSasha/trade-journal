import { Injectable, inject, signal } from '@angular/core';
import { DailyJournalService } from '../../../../core/services/daily-journal.service';
import { JournalFormState } from './journal-form.state';

@Injectable()
export class JournalRulesState {
    private journalService = inject(DailyJournalService);
    private form = inject(JournalFormState);

    customRules = this.journalService.customRules;

    showManageRules = signal(false);
    editingRuleIndex = signal<number | null>(null);
    editingRuleText = signal('');
    showAddRule = signal(false);
    newRuleText = signal('');

    toggleManage(): void {
        this.showManageRules.set(!this.showManageRules());
        this.editingRuleIndex.set(null);
        this.showAddRule.set(false);
    }

    startEdit(index: number): void {
        this.editingRuleIndex.set(index);
        this.editingRuleText.set(this.customRules()[index]);
    }

    saveEdit(): void {
        const index = this.editingRuleIndex();
        const text = this.editingRuleText().trim();
        if (index !== null && text) {
            this.journalService.updateRule(index, text);
        }
        this.editingRuleIndex.set(null);
        this.editingRuleText.set('');
    }

    cancelEdit(): void {
        this.editingRuleIndex.set(null);
        this.editingRuleText.set('');
    }

    deleteRule(index: number): void {
        const rule = this.customRules()[index];
        const checked = new Set(this.form.checkedRules());
        checked.delete(rule);
        this.form.checkedRules.set(checked);
        this.journalService.deleteRule(index);
    }

    addRule(): void {
        const text = this.newRuleText().trim();
        if (!text) return;
        this.journalService.addRule(text);
        this.newRuleText.set('');
        this.showAddRule.set(false);
    }
}
