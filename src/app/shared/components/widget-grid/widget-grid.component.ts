import { Component, ElementRef, forwardRef, inject } from '@angular/core';
import { GridstackComponent } from 'gridstack/dist/angular';

/** Angular owns the host DOM; Gridstack only owns layout and drag/resize resources. */
@Component({
    selector: 'app-widget-grid',
    standalone: true,
    template: `
        @if (isEmpty) { <ng-content select="[empty-content]" /> }
        <ng-template #container />
        <ng-content />
    `,
    styles: [':host { display: block; }'],
    providers: [{ provide: GridstackComponent, useExisting: forwardRef(() => WidgetGridComponent) }],
})
export class WidgetGridComponent extends GridstackComponent {
    constructor() { super(inject(ElementRef)); }

    override ngOnDestroy(): void {
        // Angular detaches @if/router views before destroy hooks run. The default
        // Gridstack destroy(true) tries to remove that detached host a second time.
        this.unhookEvents(this._grid);
        this._grid?.destroy(false);
        this._grid = undefined;
        super.ngOnDestroy();
    }
}
