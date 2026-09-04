import { Component, inject } from '@angular/core';
import { UserDataService } from '../../../core/services/user-data/user-data.service';
import { UserDataRepo } from '../../../core/services/user-data/user-data.repo';

/**
 * Small non-blocking toast shown while the one-time localStorage → Supabase
 * import runs. Renders nothing otherwise, so it can sit anywhere in a layout.
 */
@Component({
    selector: 'app-sync-notice',
    standalone: true,
    templateUrl: './sync-notice.component.html',
    styleUrl: './sync-notice.component.scss'
})
export class SyncNoticeComponent {
    readonly userData = inject(UserDataService);
    readonly repo = inject(UserDataRepo);
    retry(): void { void this.repo.flushQueue().catch(() => undefined); }
}
