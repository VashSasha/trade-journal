import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
    collapsed = signal<boolean>(localStorage.getItem('nav-collapsed') === 'true');

    toggle(): void {
        this.collapsed.update(v => !v);
        localStorage.setItem('nav-collapsed', String(this.collapsed()));
    }
}
