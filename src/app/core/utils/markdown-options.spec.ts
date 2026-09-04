import { TestBed } from '@angular/core/testing';
import { SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';
import { markdownOptionsFactory } from './markdown-options';

describe('untrusted Markdown', () => {
    it('keeps task markers while removing scripts and event handlers', async () => {
        const html = await marked.parse('- [x] Done\n- [ ] Next\n\n<img src=x onerror="alert(1)"><script>alert(1)</script>', markdownOptionsFactory());
        const safe = TestBed.inject(DomSanitizer).sanitize(SecurityContext.HTML, html)!;
        const rendered = new DOMParser().parseFromString(safe, 'text/html');
        expect(rendered.body.textContent).toContain('☑');
        expect(rendered.body.textContent).toContain('☐');
        expect(safe).not.toContain('onerror');
        expect(safe).not.toContain('<script');
    });
});
