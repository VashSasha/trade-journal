import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { AiCoachingMode, hasCoachingConsent } from './ai-coaching-settings.model';

const CHANGE_KEY = 'nvzn_ai_coaching_changed:';

/** Shared by all AI surfaces. Consent is authoritative in the DB, never an offline opt-in. */
@Injectable({ providedIn: 'root' })
export class AiCoachingSettingsService {
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    readonly access = inject(AccessPolicyService);
    private readonly view = inject(DOCUMENT).defaultView;
    private readonly savedUnhinged = signal(false);
    private readonly loadedFor = signal<string | null>(null);
    readonly loading = signal(false);
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);
    readonly revision = signal(0);
    readonly ready = computed(() => !!this.session.userId() && this.loadedFor() === this.session.userId() && !this.access.demo());
    readonly enabled = computed(() => this.ready() && this.savedUnhinged());
    readonly active = computed(() => this.enabled() && this.access.canAct('ai'));
    readonly mode = computed<AiCoachingMode>(() => this.active() ? 'unhinged' : 'standard');
    private generation = 0;
    private used = false;
    private request: Promise<void> | null = null;
    private requestController = new AbortController();
    get requestSignal(): AbortSignal { return this.requestController.signal; }

    constructor() {
        let owner = this.session.userId(), demo = this.access.demo();
        effect(() => {
            const nextOwner = this.session.userId(), nextDemo = this.access.demo();
            if (owner === nextOwner && demo === nextDemo) return;
            owner = nextOwner; demo = nextDemo;
            untracked(() => {
                this.generation++; this.request = null; this.loadedFor.set(null); this.savedUnhinged.set(false);
                this.loading.set(false); this.saving.set(false); this.error.set(null); this.interrupt();
                if (this.used) void this.load();
            });
        });
        const refresh = () => { if (this.used && !this.saving()) void this.load(true); };
        const storage = (event: StorageEvent) => {
            if (event.key !== CHANGE_KEY + this.session.userId() || !this.used) return;
            this.interrupt();
            if (this.saving()) return;
            // Discard any read started before another tab changed consent.
            this.generation++; this.request = null; this.loadedFor.set(null); this.apply(false);
            refresh();
        };
        this.view?.addEventListener('focus', refresh);
        this.view?.addEventListener('online', refresh);
        this.view?.addEventListener('storage', storage);
        inject(DestroyRef).onDestroy(() => {
            this.requestController.abort();
            this.view?.removeEventListener('focus', refresh); this.view?.removeEventListener('online', refresh);
            this.view?.removeEventListener('storage', storage);
        });
    }

    load(force = false): Promise<void> {
        this.used = true;
        if (!this.session.userId() || this.access.demo() || this.saving()) return Promise.resolve();
        if (this.request) return this.request;
        if (!force && this.ready()) return Promise.resolve();
        const scope = this.access.capture(), revision = ++this.generation;
        const current = () => revision === this.generation && this.session.isCurrent(scope) && !this.access.demo();
        this.loading.set(true); this.error.set(null);
        return this.request = (async () => {
            try {
                const { data, error } = await this.client.from('ai_coaching_preferences')
                    .select('unhinged,consent_version,consented_at').eq('user_id', scope.userId)
                    .abortSignal(AbortSignal.any([scope.signal, AbortSignal.timeout(10_000)])).maybeSingle();
                if (!current()) return;
                if (error) throw error;
                this.apply(hasCoachingConsent(data)); this.loadedFor.set(scope.userId);
            } catch {
                if (current()) {
                    this.apply(false); this.loadedFor.set(null);
                    this.error.set('Couldn’t load your AI preferences. New requests use Standard tone until verified.');
                }
            } finally { if (current()) { this.loading.set(false); this.request = null; } }
        })();
    }

    async setUnhinged(enabled: boolean, accepted = false): Promise<boolean> {
        if (!this.ready() || this.loading() || this.saving() || (enabled && (!accepted || !this.access.canAct('ai')))) return false;
        const scope = this.access.capture(), revision = ++this.generation;
        const current = () => revision === this.generation && this.session.isCurrent(scope) && !this.access.demo();
        this.saving.set(true); this.error.set(null); this.interrupt();
        try {
            const { data, error } = await this.client.rpc('set_my_ai_coaching_mode', { p_unhinged: enabled, p_accept_terms: accepted })
                .abortSignal(AbortSignal.any([scope.signal, AbortSignal.timeout(10_000)]));
            if (!current()) return false;
            if (error || !data || data.unhinged !== enabled || hasCoachingConsent(data) !== enabled) throw error ?? new Error('Unconfirmed setting');
            this.apply(enabled);
            try { this.view?.localStorage.setItem(CHANGE_KEY + scope.userId, crypto.randomUUID()); } catch { /* DB remains authoritative. */ }
            return true;
        } catch {
            if (current()) {
                // A lost save acknowledgement has an unknown outcome. Never guess consent.
                this.apply(false); this.loadedFor.set(null);
                this.error.set('Couldn’t confirm the change. Reload preferences to check the saved mode before trying again.');
            }
            return false;
        } finally { if (current()) this.saving.set(false); }
    }

    private apply(enabled: boolean): void {
        if (enabled !== this.savedUnhinged()) { this.savedUnhinged.set(enabled); this.interrupt(); }
    }
    private interrupt(): void {
        this.requestController.abort(); this.requestController = new AbortController(); this.revision.update(value => value + 1);
    }
}
