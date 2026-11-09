/** Extract text only. Never attach the parsed content to the live document. */
export function stripHtml(html: string): string {
    if (!html) return '';
    // Template contents are inert: event handlers, scripts and resource loads
    // must not run while extracting a saved note or the current editor value.
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, style, template').forEach(node => node.remove());
    return (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
}
