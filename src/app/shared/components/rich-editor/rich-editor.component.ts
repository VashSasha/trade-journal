import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { QuillModule } from 'ngx-quill';
import Quill from 'quill';

export const QUILL_FULL_MODULES = {
    toolbar: [
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'header': 1 }, { 'header': 2 }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'list': 'check' }],
        [{ 'background': [] }, { 'color': [] }],
        ['link'],
        ['clean']
    ]
};

export const QUILL_COMPACT_MODULES = {
    toolbar: [
        ['bold', 'italic', 'underline'],
        [{ 'header': 1 }, { 'header': 2 }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'list': 'check' }],
        ['link'],
        ['clean']
    ]
};

export const HIGHLIGHT_COLORS = [
    { bg: '#fef08a', label: 'Yellow' },
    { bg: '#86efac', label: 'Green' },
    { bg: '#67e8f9', label: 'Cyan' },
    { bg: '#f9a8d4', label: 'Pink' },
    { bg: '#fdba74', label: 'Orange' },
    { bg: '#c4b5fd', label: 'Purple' },
];

export const TEXT_COLORS = [
    { color: '#ef4444', label: 'Red' },
    { color: '#f97316', label: 'Orange' },
    { color: '#eab308', label: 'Yellow' },
    { color: '#22c55e', label: 'Green' },
    { color: '#3b82f6', label: 'Blue' },
    { color: '#a855f7', label: 'Purple' },
    { color: '#ec4899', label: 'Pink' },
    { color: '#94a3b8', label: 'Gray' },
];

@Component({
    selector: 'app-rich-editor',
    standalone: true,
    imports: [QuillModule, FormsModule],
    templateUrl: './rich-editor.component.html',
    styleUrl: './rich-editor.component.scss'
})
export class RichEditorComponent {
    @Input() value = '';
    @Output() valueChange = new EventEmitter<string>();
    @Input() modules: any = QUILL_FULL_MODULES;
    @Input() placeholder = '';
    @Input() styles: any = {};
    @Input() quillClass = '';

    private quillInstance = signal<any>(null);
    toolbarVisible = signal(false);
    toolbarTop = signal(0);
    toolbarLeft = signal(0);
    fmt = signal<Record<string, any>>({});
    colorPickerOpen = signal(false);
    textColorPickerOpen = signal(false);

    readonly highlightColors = HIGHLIGHT_COLORS;
    readonly textColors = TEXT_COLORS;

    onEditorCreated(quill: any): void {
        this.quillInstance.set(quill);
        this.setupTaskListPaste(quill);
        quill.on('selection-change', (range: any) => {
            if (range && range.length > 0) {
                this.fmt.set(quill.getFormat(range));
                this.updateToolbarPosition();
                this.toolbarVisible.set(true);
            } else {
                this.toolbarVisible.set(false);
                this.colorPickerOpen.set(false);
                this.textColorPickerOpen.set(false);
            }
        });
    }

    /**
     * When a Markdown task list is pasted as plain text — e.g. the AI insight's
     * copied "action points" (`- [ ] step`) — convert it into a real Quill
     * checklist instead of literal text, so it renders as interactive
     * checkboxes and persists as HTML like the rest of the editor.
     */
    private setupTaskListPaste(quill: any): void {
        const TASK_LINE = /^\s*[-*]\s*\[([ xX])\]\s?(.*)$/;

        quill.root.addEventListener('paste', (event: ClipboardEvent) => {
            const text = event.clipboardData?.getData('text/plain') ?? '';
            // Only hijack the paste when it actually looks like a task list;
            // otherwise let Quill handle it normally (preserving rich HTML).
            if (!/^\s*[-*]\s*\[[ xX]\]/m.test(text)) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            const Delta = Quill.import('delta') as any;
            const delta = new Delta();
            for (const line of text.split(/\r?\n/)) {
                const task = line.match(TASK_LINE);
                if (task) {
                    const checked = task[1].toLowerCase() === 'x';
                    delta.insert(task[2]);
                    delta.insert('\n', { list: checked ? 'checked' : 'unchecked' });
                } else {
                    delta.insert(line + '\n');
                }
            }

            const range = quill.getSelection(true);
            quill.updateContents(
                new Delta().retain(range.index).delete(range.length).concat(delta),
                'user'
            );
            quill.setSelection(range.index + delta.length(), 0, 'user');
        }, true);
    }

    private updateToolbarPosition(): void {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const selRect = sel.getRangeAt(0).getBoundingClientRect();
        const top = selRect.top - 48;
        const left = selRect.left + selRect.width / 2;
        this.toolbarTop.set(Math.max(4, top));
        this.toolbarLeft.set(left);
    }

    format(name: string): void {
        const q = this.quillInstance();
        if (!q) return;
        const current = this.fmt();
        const next = !current[name];
        q.format(name, next, 'user');
        this.fmt.set({ ...current, [name]: next });
    }

    toggleColorPicker(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.textColorPickerOpen.set(false);
        this.colorPickerOpen.update(v => !v);
    }

    toggleTextColorPicker(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.colorPickerOpen.set(false);
        this.textColorPickerOpen.update(v => !v);
    }

    applyHighlight(color: string, event: MouseEvent): void {
        event.preventDefault();
        const q = this.quillInstance();
        if (!q) return;
        const current = this.fmt();
        if (current['background'] === color) {
            // Same color clicked — remove highlight and dark text
            q.format('background', false, 'user');
            q.format('color', false, 'user');
            this.fmt.set({ ...current, background: false, color: false });
        } else {
            // Apply highlight with forced dark text so it's readable in both modes
            q.format('background', color, 'user');
            q.format('color', '#1e293b', 'user');
            this.fmt.set({ ...current, background: color, color: '#1e293b' });
        }
        this.colorPickerOpen.set(false);
    }

    formatHeader(level: 1 | 2): void {
        const q = this.quillInstance();
        if (!q) return;
        const current = this.fmt();
        const next = current['header'] === level ? false : level;
        q.format('header', next, 'user');
        this.fmt.set({ ...current, header: next });
    }

    clearFormat(): void {
        const q = this.quillInstance();
        if (!q) return;
        const range = q.getSelection();
        if (range) q.removeFormat(range.index, range.length, 'user');
        this.fmt.set({});
    }

    applyTextColor(color: string | null, event: MouseEvent): void {
        event.preventDefault();
        const q = this.quillInstance();
        if (!q) return;
        const current = this.fmt();
        if (!color || current['color'] === color) {
            q.format('color', false, 'user');
            this.fmt.set({ ...current, color: false });
        } else {
            q.format('color', color, 'user');
            this.fmt.set({ ...current, color });
        }
        this.textColorPickerOpen.set(false);
    }

    formatLink(): void {
        const q = this.quillInstance();
        if (!q) return;
        const current = this.fmt();
        if (current['link']) {
            q.format('link', false, 'user');
            this.fmt.set({ ...current, link: false });
        } else {
            const url = prompt('Enter URL:');
            if (url && /^https?:\/\//i.test(url)) {
                q.format('link', url, 'user');
                this.fmt.set({ ...current, link: url });
            }
        }
    }
}
