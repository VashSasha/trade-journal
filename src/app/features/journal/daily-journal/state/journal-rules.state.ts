import { Injectable, inject, signal } from '@angular/core';
import { DailyJournalService } from '../../../../core/services/daily-journal.service';
import { JournalFormState } from './journal-form.state';
import { DemoModeService } from '../../../../core/services/demo-mode.service';

@Injectable()
export class JournalRulesState {
    private journalService = inject(DailyJournalService);
    private form = inject(JournalFormState);
    private demo = inject(DemoModeService);

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
        if (!this.demo.requireAccount('save')) return;
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
        if (!this.demo.requireAccount('save')) return;
        const rule = this.customRules()[index];
        const checked = new Set(this.form.checkedRules());
        checked.delete(rule);
        this.form.checkedRules.set(checked);
        this.journalService.deleteRule(index);
    }

    addRule(): void {
        if (!this.demo.requireAccount('save')) return;
        const text = this.newRuleText().trim();
        if (!text) return;
        this.journalService.addRule(text);
        this.newRuleText.set('');
        this.showAddRule.set(false);
    }

    dragFromIndex = signal<number | null>(null);
    dragOverIndex = signal<number | null>(null);

    onDragStart(index: number): void {
        this.dragFromIndex.set(index);
        this.dragOverIndex.set(null);
    }

    // Use dragenter (fires once) — more stable than dragover (fires continuously)
    onDragEnter(index: number): void {
        if (this.dragFromIndex() !== null && this.dragFromIndex() !== index) {
            this.dragOverIndex.set(index);
        }
    }

    onDrop(toIndex: number): void {
        const from = this.dragFromIndex();
        if (from !== null && from !== toIndex) {
            this.journalService.swapRules(from, toIndex);
        }
        this.dragFromIndex.set(null);
        this.dragOverIndex.set(null);
    }

    onDragEnd(): void {
        this.dragFromIndex.set(null);
        this.dragOverIndex.set(null);
    }
}
