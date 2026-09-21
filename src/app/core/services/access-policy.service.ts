import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { UserOperation, UserSessionService } from './user-session.service';
import { cacheSuspended, workspaceSignal } from './user-data/user-data.cache';
import { isPaidPlan } from '../models/user.model';

export type PaidFeature = 'analytics' | 'ai' | 'broker';
export type WorkspaceAction = 'save' | 'connect' | 'sync' | 'ai';

/** Shared UX policy. Backend entitlements remain authoritative for paid APIs. */
@Injectable({ providedIn: 'root' })
export class AccessPolicyService {
    private auth = inject(AuthService);
    private session = inject(UserSessionService);
    readonly demo = cacheSuspended;
    readonly paid = computed(() => isPaidPlan(this.auth.plan()));
    readonly ai = computed(() => this.auth.aiAccess());
    readonly promptReason = signal<WorkspaceAction | null>(null);

    canPreview(feature: PaidFeature): boolean { return feature !== 'broker'; }

    canOpen(feature: PaidFeature): boolean {
        return this.demo() ? this.canPreview(feature) : this.auth.isAuthenticated() && (feature === 'ai' ? this.ai() : this.paid());
    }

    canAct(action: WorkspaceAction): boolean {
        return !this.demo() && this.auth.isAuthenticated() && (action === 'save' || (action === 'ai' ? this.ai() : this.paid()));
    }

    requestAction(action: WorkspaceAction): boolean {
        if (this.canAct(action)) return true;
        this.promptReason.set(action);
        return false;
    }

    assertAction(action: WorkspaceAction): void {
        if (this.canAct(action)) return;
        if (this.demo()) throw new Error('This is a demo preview. Switch to your workspace to use real data.');
        throw new Error(this.auth.isAuthenticated() ? 'Upgrade to use this feature.' : 'Please sign in first.');
    }

    /** Invalidated on either a user change or a real/demo workspace change. */
    capture(): UserOperation {
        const scope = this.session.capture();
        return { userId: scope.userId, signal: AbortSignal.any([scope.signal, workspaceSignal()]) };
    }

    isCurrent(scope: UserOperation): boolean { return this.session.isCurrent(scope); }
    assertCurrent(scope: UserOperation): void { this.session.assertCurrent(scope); }

    featureForUrl(url: string): PaidFeature | null {
        const path = url.split(/[?#]/)[0];
        if (/^\/analytics(?:\/|;|$)/.test(path)) return 'analytics';
        if (/^\/reports(?:\/|;|$)/.test(path)) return 'ai';
        if (/^\/settings(?:\/|;|$)/.test(path) || /^\/account\/integrations(?:\/|;|$)/.test(path)) return 'broker';
        return null;
    }
}
