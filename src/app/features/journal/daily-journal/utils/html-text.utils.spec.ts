import { vi } from 'vitest';
import { stripHtml } from './html-text.utils';
import { buildTimelineEntry } from './timeline.utils';

describe('inert journal text extraction', () => {
    it('decodes entities and keeps readable text from formatted notes', () => {
        expect(stripHtml('<p>  Risk <strong>$50</strong>&nbsp;&amp; follow &#39;the plan&#39;\n</p>'))
            .toBe("Risk $50 & follow 'the plan'");
        expect(stripHtml('2 < 3 &amp; 5 > 4')).toBe('2 < 3 & 5 > 4');
        expect(stripHtml('&lt;img src=x onerror=alert(1)&gt;')).toBe('<img src=x onerror=alert(1)>');
    });

    it('handles empty, whitespace-only and malformed HTML', () => {
        expect(stripHtml('')).toBe('');
        expect(stripHtml('<p><br></p>&nbsp;')).toBe('');
        expect(stripHtml('<p>Keep <strong>size')).toBe('Keep size');
    });

    it('does not include script, style or nested template content in coach context', () => {
        expect(stripHtml('<script>bad()</script><style>body{display:none}</style><template>hidden</template><p>My plan</p>'))
            .toBe('My plan');
    });

    it('parses in a template and returns text only, without inserting elements', () => {
        const createElement = vi.spyOn(document, 'createElement');
        const before = document.body.innerHTML;
        try {
            expect(stripHtml('<img src="data:image/png;base64,invalid" onerror="alert(1)"><p>Stay patient</p>'))
                .toBe('Stay patient');
            expect(createElement).toHaveBeenCalledWith('template');
            expect(createElement.mock.calls.every(([tag]) => tag === 'template')).toBe(true);
            expect(document.body.innerHTML).toBe(before);
        } finally { createElement.mockRestore(); }
    });

    it('uses the same conversion for timeline previews', () => {
        const note = {
            id: 'note-1', date: '2026-08-04', content: '',
            preMarketPlan: '<script>bad()</script><p>Wait&nbsp;&amp; review</p>',
            createdAt: '2026-08-04T12:00:00Z', updatedAt: '2026-08-04T12:00:00Z',
        };
        const entry = buildTimelineEntry(new Date('2026-08-04T12:00:00'), note.date, note.date, note, 0, false);
        expect(entry.preview).toBe('Wait & review');
    });
});
