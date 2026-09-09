import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { EconomicCalendarService, EconomicEvent } from '../../core/services/economic-calendar.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { economicEventTimestamp } from '../../core/utils/economic-events';
import { AlertCenterService } from './alert-center.service';
import { SessionAlertsService } from './session-alerts.service';
import { AccountAlertPreferencesService } from './account-alert-preferences.service';
import {
    crossedMarketEventAlerts, MARKET_EVENT_LEADS, MarketEventAlertPreferences,
} from './market-event-alerts.utils';

const FIRED_PREFIX = 'nvzn_market_event_alerts_fired_v1:';
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class MarketEventAlertsService {
    private readonly calendar = inject(EconomicCalendarService);
    private readonly session = inject(UserSessionService);
    private readonly sounds = inject(SessionAlertsService);
    private readonly center = inject(AlertCenterService);
    private readonly accountPreferences = inject(AccountAlertPreferencesService);
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly view = this.document.defaultView;
    readonly preferences = this.accountPreferences.marketEvents;
    readonly preferencesLoading = this.accountPreferences.loading;
    readonly syncWarning = this.accountPreferences.syncWarning;
    readonly storageWarning = this.accountPreferences.storageWarning;
    readonly error = signal<string | null>(null);
    readonly lastAlert = signal<string | null>(null);
    readonly desktopSupported = !!this.notificationApi();
    readonly desktopPermission = signal<NotificationPermission | 'unsupported'>(
        this.notificationApi()?.permission ?? 'unsupported',
    );
    readonly active = computed(() => this.preferences().enabled && !!this.session.userId());
    readonly leadOptions = MARKET_EVENT_LEADS;
    private owner: string | null = null;
    private preferencesSignature = '';
    private previousAt = Date.now();
    private fired = new Set<string>();
    private readonly timer = this.view?.setInterval(() => this.tick(), 10_000);

    constructor() {
        effect(() => {
            const owner = this.session.userId();
            if (owner === this.owner) return;
            this.owner = owner;
            this.fired = this.loadFired(owner);
            this.previousAt = Date.now();
            this.error.set(null);
        });
        effect(() => {
            const preferences = this.preferences();
            const signature = `${preferences.enabled}:${preferences.leadMinutes}:${preferences.highOnly}`;
            if (signature === this.preferencesSignature) return;
            this.preferencesSignature = signature;
            // Loading or changing rules establishes a new baseline and never
            // replays a warning whose threshold passed before this preference.
            this.previousAt = Date.now();
        });
        const onStorage = (event: StorageEvent) => {
            if (!this.owner) return;
            if (event.key === FIRED_PREFIX + this.owner) this.fired = this.loadFired(this.owner);
        };
        this.view?.addEventListener('storage', onStorage);
        this.destroyRef.onDestroy(() => {
            this.view?.clearInterval(this.timer);
            this.view?.removeEventListener('storage', onStorage);
        });
    }

    setEnabled(enabled: boolean): void {
        this.accountPreferences.updateMarketAccount(current => ({ ...current, enabled }));
        this.previousAt = Date.now();
    }

    setLeadMinutes(value: number): void {
        if (!MARKET_EVENT_LEADS.includes(value as typeof MARKET_EVENT_LEADS[number])) return;
        this.accountPreferences.updateMarketAccount(current => ({
            ...current,
            leadMinutes: value as MarketEventAlertPreferences['leadMinutes'],
        }));
        this.previousAt = Date.now();
    }

    setHighOnly(highOnly: boolean): void {
        this.accountPreferences.updateMarketAccount(current => ({ ...current, highOnly }));
        this.previousAt = Date.now();
    }

    async setDesktopNotifications(enabled: boolean): Promise<void> {
        this.error.set(null);
        if (!enabled) {
            this.accountPreferences.updateMarketDevice(current => ({ ...current, desktopNotifications: false }));
            return;
        }
        const api = this.notificationApi();
        if (!api) {
            this.desktopPermission.set('unsupported');
            this.error.set('Desktop notifications are not supported in this browser.');
            return;
        }
        try {
            const permission = await api.requestPermission();
            this.desktopPermission.set(permission);
            const granted = permission === 'granted';
            this.accountPreferences.updateMarketDevice(current => ({ ...current, desktopNotifications: granted }));
            if (!granted) this.error.set('Desktop notification permission was not granted. In-app alerts still work.');
        } catch {
            this.error.set('Desktop notifications could not be enabled. In-app alerts still work.');
        }
    }

    testAlert(): void {
        const text = 'Test warning: high-impact market event in 15 minutes.';
        this.sounds.announce('risk', text);
        this.center.publish({ tone: 'warning', title: 'Market event approaching', text });
        this.lastAlert.set(text);
        if (this.preferences().desktopNotifications) this.notifyDesktop('Market event test', text, 'nvzn-market-test');
    }

    private tick(): void {
        const now = Date.now();
        const previous = this.previousAt;
        this.previousAt = now;
        if (!this.owner || !this.preferences().enabled) return;
        const upcoming = this.calendar.getUpcomingEvents(now, now + 2 * DAY_MS);
        const crossed = crossedMarketEventAlerts(upcoming, previous, now, this.preferences())
            .filter(alert => !this.fired.has(alert.key));
        if (!crossed.length) return;
        for (const alert of crossed) this.fired.add(alert.key);
        this.persistFired();

        const names = crossed.map(alert => alert.event.abbr).join(' + ');
        const first = crossed[0].event;
        const time = this.localTime(first);
        const text = `${names} in ${this.preferences().leadMinutes} minutes (${time}). Consider waiting for volatility to settle before entering.`;
        this.sounds.announce('risk', text);
        this.center.publish({ tone: 'warning', title: 'Market event approaching', text });
        this.lastAlert.set(text);
        if (this.preferences().desktopNotifications) {
            this.notifyDesktop('Market event approaching', text, `nvzn-market-${crossed[0].key}`);
        }
    }

    private localTime(event: EconomicEvent): string {
        return new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        }).format(economicEventTimestamp(event));
    }

    private notifyDesktop(title: string, body: string, tag: string): void {
        const api = this.notificationApi();
        if (!api || api.permission !== 'granted') return;
        try { new api(title, { body, tag }); }
        catch { /* The in-app warning is the reliable fallback. */ }
    }

    private notificationApi(): typeof Notification | null {
        return this.view && 'Notification' in this.view ? this.view.Notification : null;
    }

    private loadFired(owner: string | null): Set<string> {
        if (!owner) return new Set();
        try {
            const value: unknown = JSON.parse(this.view?.localStorage.getItem(FIRED_PREFIX + owner) ?? '[]');
            return new Set(Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(-100) : []);
        } catch { return new Set(); }
    }

    private persistFired(): void {
        if (!this.owner) return;
        const recent = [...this.fired].slice(-100);
        this.fired = new Set(recent);
        try { this.view?.localStorage.setItem(FIRED_PREFIX + this.owner, JSON.stringify(recent)); }
        catch { /* Duplicate suppression remains active in this tab. */ }
    }
}
