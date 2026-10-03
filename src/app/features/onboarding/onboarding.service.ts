import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { TradeService } from '../../core/services/trade.service';
import { UserDataService } from '../../core/services/user-data/user-data.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { OnboardingProgress, parseOnboardingProgress } from './onboarding.model';

/** Shared by the dashboard invitation and the route-backed setup checklist. */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly access = inject(AccessPolicyService);
    private readonly trades = inject(TradeService);
    private readonly userData = inject(UserDataService);
    private readonly loadedFor = signal<string | null>(null);
    private readonly state = signal(parseOnboardingProgress(null));
    private generation = 0;
    private readonly offered = signal(false);
    private pendingClose: Partial<OnboardingProgress> | null = null;

    readonly dialogOpen = signal(false);
    readonly progress = this.state.asReadonly();
    readonly loading = signal(false);
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);
    readonly ready = computed(() => !!this.session.userId() && !this.access.demo()
        && this.loadedFor() === this.session.userId() && !this.loading());
    readonly dataLoaded = this.userData.dataLoaded;
    readonly hasTrades = computed(() => !this.access.demo() && this.dataLoaded()
        && this.trades.trades().some(trade => trade.userId === this.session.userId()));
    readonly completedCount = computed(() => Number(this.hasTrades() || this.progress().accountsReviewed)
        + Number(this.progress().templatesReviewed) + Number(this.progress().alertsReviewed)
        + Number(this.progress().journalReviewed));
    readonly complete = computed(() => this.completedCount() === 4);
    readonly shouldOfferGuide = computed(() => this.ready() && this.dataLoaded() && !this.hasTrades()
        && !this.progress().started && !this.progress().dismissed && !this.offered());
    readonly showInvitation = computed(() => this.ready() && this.dataLoaded()
        && !this.progress().dismissed && !this.complete()
        // Established workspaces are never forced back through onboarding.
        && (this.progress().started || !this.hasTrades()));

    constructor() {
        effect(() => {
            const owner = this.session.userId();
            const demo = this.access.demo();
            untracked(() => {
                this.generation++;
                this.dialogOpen.set(false);
                this.offered.set(false);
                this.pendingClose = null;
                this.loadedFor.set(null);
                this.state.set(parseOnboardingProgress(null));
                this.loading.set(false);
                this.saving.set(false);
                this.error.set(null);
                if (owner && !demo) void this.load();
            });
        });
    }

    openGuide(): void {
        if (!this.session.userId() || this.access.demo()) return;
        this.offered.set(true);
        this.dialogOpen.set(true);
    }

    closeGuide(dismiss = true): void {
        if (!this.dialogOpen()) return;
        this.dialogOpen.set(false);
        const patch = { started: true, ...(dismiss ? { dismissed: true } : {}) };
        // Closing stays immediate, even while a checkbox save is in flight.
        if (this.saving()) this.pendingClose = patch;
        else void this.update(patch);
    }

    async load(): Promise<void> {
        if (!this.session.userId() || this.access.demo() || this.loading() || this.saving()) return;
        const scope = this.access.capture();
        const generation = this.generation;
        const current = () => generation === this.generation && this.access.isCurrent(scope);
        this.loading.set(true);
        this.error.set(null);
        try {
            const { data, error } = await this.client.from('user_settings').select('prefs')
                .eq('user_id', scope.userId).abortSignal(scope.signal).maybeSingle();
            if (!current()) return;
            if (error) throw error;
            this.state.set(parseOnboardingProgress(data?.prefs?.['onboarding']));
            this.loadedFor.set(scope.userId);
        } catch {
            if (current()) this.error.set('Couldn’t load setup progress. Try again when you’re online.');
        } finally {
            if (current()) this.loading.set(false);
        }
    }

    async update(patch: Partial<OnboardingProgress>): Promise<void> {
        if (!this.ready() || this.saving() || !this.access.canAct('save')) return;
        const scope = this.access.capture();
        const generation = this.generation;
        const current = () => generation === this.generation && this.access.isCurrent(scope);
        this.saving.set(true);
        this.error.set(null);
        try {
            const { data, error } = await this.client.rpc('set_my_onboarding_progress', { p_patch: patch })
                .abortSignal(scope.signal);
            if (!current()) return;
            if (error) throw error;
            this.state.set(parseOnboardingProgress(data));
        } catch {
            // Don't pretend a failed save will follow the user to another device.
            if (current()) this.error.set('Couldn’t save setup progress. Your changes weren’t saved; please try again.');
        } finally {
            if (current()) {
                this.saving.set(false);
                const pending = this.pendingClose;
                this.pendingClose = null;
                if (pending) void this.update(pending);
            }
        }
    }
}
