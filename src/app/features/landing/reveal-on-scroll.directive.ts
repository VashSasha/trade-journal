import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * Adds `.reveal` on init and `.reveal--visible` once the element
 * scrolls into view. Pure IntersectionObserver — no dependencies.
 */
@Directive({
    selector: '[appRevealOnScroll]',
    standalone: true
})
export class RevealOnScrollDirective implements OnInit, OnDestroy {
    private el = inject(ElementRef<HTMLElement>);
    private observer?: IntersectionObserver;

    ngOnInit(): void {
        const node = this.el.nativeElement;
        node.classList.add('reveal');

        if (typeof IntersectionObserver === 'undefined') {
            node.classList.add('reveal--visible');
            return;
        }

        this.observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        node.classList.add('reveal--visible');
                        this.observer?.unobserve(node);
                    }
                }
            },
            { threshold: 0.15 }
        );
        this.observer.observe(node);
    }

    ngOnDestroy(): void {
        this.observer?.disconnect();
    }
}
