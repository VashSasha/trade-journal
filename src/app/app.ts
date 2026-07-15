import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('trade-journal');

  constructor() {
    // Instantiate at the root so the dark class is applied on public
    // pages (landing, login) too — not just inside the app shell.
    inject(ThemeService);
  }
}
