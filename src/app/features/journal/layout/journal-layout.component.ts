import { Component } from '@angular/core';

import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
    selector: 'app-journal-layout',
    standalone: true,
    imports: [RouterOutlet, RouterLink, RouterLinkActive],
    templateUrl: './journal-layout.component.html',
    styleUrl: './journal-layout.component.scss'
})
export class JournalLayoutComponent { }
