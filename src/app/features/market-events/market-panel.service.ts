import { Injectable, signal } from '@angular/core';

export type MarketPanelTab = 'calendar' | 'news' | 'alerts';

/** App-wide state for the market-awareness drawer mounted in the authenticated shell. */
@Injectable({ providedIn: 'root' })
export class MarketPanelService {
    readonly open = signal(false);
    readonly activeTab = signal<MarketPanelTab>('calendar');

    show(tab: MarketPanelTab = 'calendar'): void {
        this.activeTab.set(tab);
        this.open.set(true);
    }

    toggle(tab: MarketPanelTab = 'calendar'): void {
        if (this.open() && this.activeTab() === tab) {
            this.close();
            return;
        }
        this.show(tab);
    }

    close(): void {
        this.open.set(false);
    }
}
