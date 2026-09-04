import { Renderer } from 'marked';

/** Render task markers without interactive inputs, which Angular correctly strips. */
export function markdownOptionsFactory() {
    const renderer = new Renderer();
    renderer.checkbox = ({ checked }) => checked ? '☑ ' : '☐ ';
    return { gfm: true, breaks: false, renderer };
}
