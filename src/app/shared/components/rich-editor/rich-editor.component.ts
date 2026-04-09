import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { QuillModule } from 'ngx-quill';

const DEFAULT_MODULES = {
    toolbar: [
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'header': 1 }, { 'header': 2 }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
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
    @Input() modules: any = DEFAULT_MODULES;
    @Input() placeholder = '';
    @Input() styles: any = {};
    @Input() quillClass = '';

    private quillInstance = signal<any>(null);
    toolbarVisible = signal(false);
    toolbarTop = signal(0);
    toolbarLeft = signal(0);
    fmt = signal<Record<string, any>>({});
    colorPickerOpen = signal(false);

    readonly highlightColors = HIGHLIGHT_COLORS;

    onEditorCreated(quill: any): void {
        this.quillInstance.set(quill);
        quill.on('selection-change', (range: any) => {
            if (range && range.length > 0) {
                this.fmt.set(quill.getFormat(range));
                this.updateToolbarPosition();
                this.toolbarVisible.set(true);
            } else {
                this.toolbarVisible.set(false);
                this.colorPickerOpen.set(false);
            }
        });
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
        this.colorPickerOpen.update(v => !v);
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

    formatLink(): void {
        const q = this.quillInstance();
        if (!q) return;
        const current = this.fmt();
        if (current['link']) {
            q.format('link', false, 'user');
            this.fmt.set({ ...current, link: false });
        } else {
            const url = prompt('Enter URL:');
            if (url) {
                q.format('link', url, 'user');
                this.fmt.set({ ...current, link: url });
            }
        }
    }
}
