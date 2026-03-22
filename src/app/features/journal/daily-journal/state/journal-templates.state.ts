import { Injectable, computed, inject, signal } from '@angular/core';
import { DailyJournalService } from '../../../../core/services/daily-journal.service';
import { JournalTemplate } from '../../../../core/models/daily-journal.model';
import { JournalFormState } from './journal-form.state';

@Injectable()
export class JournalTemplatesState {
    private journalService = inject(DailyJournalService);
    private form = inject(JournalFormState);

    templates = this.journalService.templates;

    openDropdown = signal<'pre-market' | 'post-market' | 'notes' | null>(null);
    templatePanelOpen = signal(false);
    templatePanelContext = signal<'pre-market' | 'post-market' | 'notes' | null>(null);
    selectedTemplate = signal<JournalTemplate | null>(null);
    isEditingTemplate = signal(false);
    isCreatingTemplate = signal(false);
    editTemplateName = signal('');
    editTemplateContent = signal('');

    panelTemplates = computed(() => {
        const ctx = this.templatePanelContext();
        if (!ctx) return this.templates();
        const type = ctx === 'notes' ? 'notes' : 'plan';
        return this.templates().filter(t => t.type === type);
    });

    toggleDropdown(context: 'pre-market' | 'post-market' | 'notes'): void {
        this.openDropdown.set(this.openDropdown() === context ? null : context);
    }

    openPanel(context: 'pre-market' | 'post-market' | 'notes'): void {
        this.templatePanelContext.set(context);
        this.templatePanelOpen.set(true);
        this.isEditingTemplate.set(false);
        this.isCreatingTemplate.set(false);
        const first = this.panelTemplates()[0] ?? null;
        this.selectedTemplate.set(first);
    }

    closePanel(): void {
        this.templatePanelOpen.set(false);
        this.isEditingTemplate.set(false);
        this.isCreatingTemplate.set(false);
        this.selectedTemplate.set(null);
    }

    selectTemplate(template: JournalTemplate): void {
        this.selectedTemplate.set(template);
        this.isEditingTemplate.set(false);
        this.isCreatingTemplate.set(false);
    }

    loadTemplate(template: JournalTemplate, context: 'pre-market' | 'post-market' | 'notes'): void {
        if (context === 'pre-market') this.form.preMarketPlan.set(template.content);
        else if (context === 'post-market') this.form.postMarketReview.set(template.content);
        else this.form.noteContent.set(template.content);
        this.openDropdown.set(null);
    }

    useSelectedTemplate(): void {
        const tpl = this.selectedTemplate();
        const ctx = this.templatePanelContext();
        if (!tpl || !ctx) return;
        if (ctx === 'pre-market') this.form.preMarketPlan.set(tpl.content);
        else if (ctx === 'post-market') this.form.postMarketReview.set(tpl.content);
        else this.form.noteContent.set(tpl.content);
        this.closePanel();
    }

    startEdit(): void {
        const tpl = this.selectedTemplate();
        if (!tpl) return;
        this.editTemplateName.set(tpl.name);
        this.editTemplateContent.set(tpl.content);
        this.isEditingTemplate.set(true);
        this.isCreatingTemplate.set(false);
    }

    saveEdit(): void {
        const tpl = this.selectedTemplate();
        const name = this.editTemplateName().trim();
        const content = this.editTemplateContent();
        if (!tpl || !name) return;
        this.journalService.updateTemplate(tpl.id, name, content);
        const updated = this.templates().find(t => t.id === tpl.id);
        this.selectedTemplate.set(updated ?? null);
        this.isEditingTemplate.set(false);
    }

    cancelEdit(): void {
        this.isEditingTemplate.set(false);
        this.isCreatingTemplate.set(false);
    }

    startCreate(): void {
        const ctx = this.templatePanelContext();
        let content = '';
        if (ctx === 'pre-market') content = this.form.preMarketPlan();
        else if (ctx === 'post-market') content = this.form.postMarketReview();
        else content = this.form.noteContent();

        this.editTemplateName.set('');
        this.editTemplateContent.set(content);
        this.isCreatingTemplate.set(true);
        this.isEditingTemplate.set(false);
        this.selectedTemplate.set(null);
    }

    confirmCreate(): void {
        const name = this.editTemplateName().trim();
        const content = this.editTemplateContent();
        const ctx = this.templatePanelContext();
        if (!name || !ctx) return;
        const type: 'plan' | 'notes' = ctx === 'notes' ? 'notes' : 'plan';
        const created = this.journalService.saveTemplate(name, type, content);
        this.selectedTemplate.set(created);
        this.isCreatingTemplate.set(false);
    }

    deleteSelected(): void {
        const tpl = this.selectedTemplate();
        if (!tpl) return;
        this.journalService.deleteTemplate(tpl.id);
        const remaining = this.panelTemplates()[0] ?? null;
        this.selectedTemplate.set(remaining);
        this.isEditingTemplate.set(false);
    }

    recentTemplates(context: 'pre-market' | 'post-market' | 'notes'): JournalTemplate[] {
        const type = context === 'notes' ? 'notes' : 'plan';
        return this.templates()
            .filter(t => t.type === type)
            .slice(-4)
            .reverse();
    }

    typeLabel(context: string): string {
        if (context === 'pre-market') return 'Pre-Market Plan';
        if (context === 'post-market') return 'Post-Market Review';
        return 'Notes';
    }
}
