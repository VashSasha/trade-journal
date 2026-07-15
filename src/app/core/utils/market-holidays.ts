/** Returns YYYY-MM-DD string for a local Date */
function toDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** If holiday falls on Saturday → Friday; Sunday → Monday */
function observed(date: Date): Date {
    const day = date.getDay();
    if (day === 6) return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    if (day === 0) return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return date;
}

/** Nth occurrence of weekday (0=Sun…6=Sat) in a given month */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
        const date = new Date(year, month, d);
        if (date.getMonth() !== month) break;
        if (date.getDay() === weekday && ++count === n) return date;
    }
    throw new Error(`nthWeekday: ${n}th weekday ${weekday} not found in ${month + 1}/${year}`);
}

/** Last occurrence of weekday in a given month */
function lastWeekday(year: number, month: number, weekday: number): Date {
    for (let d = new Date(year, month + 1, 0).getDate(); d >= 1; d--) {
        const date = new Date(year, month, d);
        if (date.getDay() === weekday) return date;
    }
    throw new Error(`lastWeekday: weekday ${weekday} not found in ${month + 1}/${year}`);
}

/** Easter Sunday via Anonymous Gregorian algorithm */
function easterSunday(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
}

/** NYSE/CME observed market holidays for a given year */
function getUSMarketHolidays(year: number): Set<string> {
    const holidays = new Set<string>();
    const add = (d: Date) => holidays.add(toDateStr(d));

    add(observed(new Date(year, 0, 1)));        // New Year's Day
    add(nthWeekday(year, 0, 1, 3));             // MLK Day (3rd Mon Jan)
    add(nthWeekday(year, 1, 1, 3));             // Presidents' Day (3rd Mon Feb)

    const easter = easterSunday(year);
    add(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2)); // Good Friday

    add(lastWeekday(year, 4, 1));               // Memorial Day (last Mon May)
    if (year >= 2022) add(observed(new Date(year, 5, 19))); // Juneteenth
    add(observed(new Date(year, 6, 4)));        // Independence Day
    add(nthWeekday(year, 8, 1, 1));             // Labor Day (1st Mon Sep)
    add(nthWeekday(year, 10, 4, 4));            // Thanksgiving (4th Thu Nov)
    add(observed(new Date(year, 11, 25)));      // Christmas Day

    return holidays;
}

const cache = new Map<number, Set<string>>();

/**
 * Returns the YYYY-MM-DD trading-session date for a trade's ISO timestamp.
 * CME equity futures roll to the next session at 5 PM local time, so any
 * trade at or after 17:00 local belongs to the NEXT calendar day.
 * Used by the calendar heatmap and journal to match Tradovate's session dates.
 */
export function tradeSessionDateStr(isoDate: string): string {
    const d = new Date(isoDate);
    if (d.getHours() >= 17) {
        const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        return toDateStr(next);
    }
    return toDateStr(d);
}

/** Returns true if the given local date is a weekend or US market holiday */
export function isMarketClosed(date: Date): boolean {
    const dow = date.getDay();
    if (dow === 0 || dow === 6) return true;
    const year = date.getFullYear();
    if (!cache.has(year)) cache.set(year, getUSMarketHolidays(year));
    return cache.get(year)!.has(toDateStr(date));
}
