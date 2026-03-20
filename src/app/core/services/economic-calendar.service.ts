import { Injectable } from '@angular/core';
import { EconomicEvent, getEconomicEventsForMonth } from '../utils/economic-events';

export type { EconomicEvent };

@Injectable({ providedIn: 'root' })
export class EconomicCalendarService {
    getEventsForMonth(year: number, month: number): EconomicEvent[] {
        return getEconomicEventsForMonth(year, month);
    }
}
