import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

@Component({
    selector: 'app-upgrade',
    standalone: true,
    imports: [TitleCasePipe],
    templateUrl: './upgrade.component.html',
    styleUrl: './upgrade.component.scss'
})
export class UpgradeComponent {
    private router = inject(Router);
    auth = inject(AuthService);

    back(): void {
        this.router.navigate(['/dashboard']);
    }
}
