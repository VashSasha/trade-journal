import { Component, computed, ElementRef, HostListener, OnDestroy, signal, ViewChild, inject, input, DOCUMENT } from '@angular/core';

export interface SharePnlStats {
  winRate: number;
  totalTrades: number;
  winners: number;
  losers: number;
  totalPoints?: number;
}

@Component({
  selector: 'app-share-pnl',
  standalone: true,
  imports: [],
  templateUrl: './share-pnl.component.html',
  styleUrl: './share-pnl.component.scss'
})
export class SharePnlComponent implements OnDestroy {
  private document = inject(DOCUMENT);

  // Signal-based inputs — required so computed() below actually tracks them.
  // Plain @Input() properties are just class fields, not signals; a computed()
  // that reads one evaluates once on first access and then never re-runs when
  // Angular later assigns a new value to that field (no dependency was ever
  // registered). That silently froze the share card on whatever value was
  // active the first time it was opened — e.g. the dashboard's date range
  // label never updating after a filter change.
  pnl = input.required<number>();
  stats = input.required<SharePnlStats>();
  date = input<string>();
  /**
   * Pre-formatted period label for share contexts that cover a range rather
   * than a single day (e.g. the dashboard, whose P&L reflects whatever
   * FilterService date range is active — "All Time", "Jan 1 – Jan 31, 2026").
   * Takes precedence over `date` when both would otherwise apply.
   */
  dateLabel = input<string>();
  context = input<'journal' | 'dashboard'>('dashboard');

  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly isOpen = signal(false);
  readonly activeTab = signal<'image' | 'text'>('image');
  readonly layoutMode = signal<'full' | 'clean'>('full');
  readonly feedback = signal<string | null>(null);
  private feedbackTimer?: ReturnType<typeof setTimeout>;

  readonly isPnlPositive = computed(() => this.pnl() >= 0);

  readonly formattedDate = computed(() => {
    const date = this.date();
    if (!date) return null;
    return new Date(date + 'T12:00:00')
      .toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'});
  });

  /** What the card actually displays: an explicit range label (dashboard) wins
   *  over a single-day date (journal). Null when neither is provided. */
  readonly displayDateLabel = computed(() => this.dateLabel() ?? this.formattedDate());

  readonly templates = computed(() => this.buildTextTemplates());

  open(): void {
    this.isOpen.set(true);
    this.activeTab.set('image');
    setTimeout(() => this.drawCanvas(), 0);
  }

  closeModal(): void {
    this.isOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.closeModal();
  }

  async downloadPng(): Promise<void> {
    const canvas = this.canvasRef.nativeElement;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = this.document.createElement('a');
      a.href = url;
      a.download = `nvzn-pnl-${this.date() ?? 'summary'}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
    this.showFeedback('Image downloaded!');
  }

  async copyImage(): Promise<void> {
    try {
      const canvas = this.canvasRef.nativeElement;
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png')
      );
      await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
      this.showFeedback('Image copied!');
    } catch {
      this.showFeedback('Copy failed — use Download instead');
    }
  }

  async copyText(body: string): Promise<void> {
    await navigator.clipboard.writeText(body);
    this.showFeedback('Copied!');
  }

  async discordCopy(): Promise<void> {
    const t = this.templates().find(t => t.label === 'Discord');
    if (t) await this.copyText(t.body);
  }

  instagramAction(): void {
    this.downloadPng();
    const caption = this.templates()[0].body;
    navigator.clipboard.writeText(caption).catch(() => {
    });
    this.showFeedback('Image saved — open Instagram to post. Caption copied!');
  }

  switchTab(tab: 'image' | 'text'): void {
    this.activeTab.set(tab);
    if (tab === 'image') {
      setTimeout(() => this.drawCanvas(), 0);
    }
  }

  switchLayout(mode: 'full' | 'clean'): void {
    this.layoutMode.set(mode);
    setTimeout(() => this.drawCanvas(), 0);
  }

  private buildTextTemplates(): { label: string; body: string }[] {
    const pnl = this.pnl();
    const stats = this.stats();
    const sign = pnl >= 0 ? '+' : '';
    const pnlFmt = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(pnl);
    const wr = stats.winRate.toFixed(1);
    const trades = stats.totalTrades;
    const w = stats.winners;
    const l = stats.losers;
    const pts = stats.totalPoints;
    const ptsFmt = pts !== undefined ? ` (${pts >= 0 ? '+' : ''}${pts.toFixed(2)} pts)` : '';
    const label = this.displayDateLabel();
    const datePart = label ? ` ${label}` : '';

    return [
      {
        label: 'Achievement',
        body: `🔥 Trading results${datePart}:\nNet P&L: ${sign}${pnlFmt} | Win Rate: ${wr}% | ${w}/${w + l} trades profitable\nNVZN Trading Journal`
      },
      {
        label: 'Stats',
        body: `📊 Day summary: ${sign}${pnlFmt}${ptsFmt} | Win rate: ${wr}% | Powered by NVZN Trading`
      },
      {
        label: 'Discord',
        body: `\`\`\`\n📈 NVZN Trading${datePart}\nNet P&L : ${sign}${pnlFmt}\nWin Rate: ${wr}%\nTrades  : ${trades} (${w}W / ${l}L)${pts !== undefined ? `\nPoints  : ${pts >= 0 ? '+' : ''}${pts.toFixed(2)}` : ''}\n\`\`\``
      }
    ];
  }

  private cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  private async drawCanvas(): Promise<void> {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const isClean = this.layoutMode() === 'clean';
    const W = isClean ? 550 : 1000;
    const H = isClean ? 400 : 580;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const pnl = this.pnl();
    const stats = this.stats();

    // Canvas card is always dark-themed (share card for social media)
    ctx.fillStyle = '#070b15';
    ctx.fillRect(0, 0, W, H);

    const isPositive = pnl >= 0;
    const pnlColor = isPositive ? '#00E0D3' : '#8B2635';
    const gradientColor = isPositive ? '16,185,129' : '139,38,53';
    const pnlText = (isPositive ? '+' : '') +
      new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(pnl);

    // Radial gradient overlay — color matches P&L direction
    const grad = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.5, W * 0.7);
    grad.addColorStop(0, `rgba(${gradientColor},0.08)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (isClean) {
      // ── Clean layout: square, logo centered top, P&L centered ─────────────

      // Logo centered at top
      try {
        const logo = await this.loadImage('./NVZN_Trading_logo.png');
        const logoH = 240;
        const logoW = Math.min(600, (logo.width / logo.height) * logoH);
        ctx.drawImage(logo, (W - logoW) / 2, 0, logoW, logoH);
      } catch {
        ctx.fillStyle = this.cssVar('--color-accent');
        ctx.font = 'bold 24px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NVZN TRADING', W / 2, 120);
        ctx.textAlign = 'left';
      }

      // NET P&L label
      ctx.fillStyle = this.cssVar('--color-text-secondary');
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('NET P&L:', W / 3, H / 2 + 10 );

      // P&L value
      ctx.fillStyle = pnlColor;
      ctx.font = 'bold 60px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pnlText, W / 2, H / 2 + 62);

      // Date/period below
      if (this.displayDateLabel()) {
        ctx.fillStyle = this.cssVar('--color-text-muted');
        ctx.font = '400 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.displayDateLabel() ?? '', W / 2, H / 2 + 120);
      }
      ctx.textAlign = 'left';
    } else {
      // ── Full layout: logo top-left, P&L left, stats grid right ───────────

      // Logo top-left
      try {
        const logo = await this.loadImage('./NVZN_Trading_logo.png');
        const logoH = 350;
        const logoW = Math.min(1200, (logo.width / logo.height) * logoH);
        ctx.drawImage(logo, 30, 0, logoW, logoH);
      } catch {
        ctx.fillStyle = this.cssVar('--color-accent');
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.fillText('NVZN TRADING', 48, 80);
      }

      // Context label (top-right)
      ctx.fillStyle = this.cssVar('--color-text-muted');
      ctx.font = '500 15px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(this.context() === 'journal' ? 'Daily Journal' : 'Dashboard Summary', W - 48, 64);
      ctx.textAlign = 'left';
      // ── Full layout: P&L left + stats grid right ──────────────────────────
      ctx.fillStyle = this.cssVar('--color-text-secondary');
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText('NET P&L:', 48, H / 2 - 24);

      ctx.fillStyle = pnlColor;
      ctx.font = 'bold 84px system-ui, sans-serif';
      ctx.fillText(pnlText, 48, H / 2 + 64);

      if (this.displayDateLabel()) {
        ctx.fillStyle = this.cssVar('--color-text-muted');
        ctx.font = '400 20px system-ui, sans-serif';
        ctx.fillText(this.displayDateLabel() ?? '', 48, H / 2 + 120);
      }

      // Vertical divider
      const divX = Math.round(W * 0.58);
      ctx.strokeStyle = this.cssVar('--color-border');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(divX, 80);
      ctx.lineTo(divX, H - 70);
      ctx.stroke();

      // Stats grid (right column)
      const statsX = divX + 56;
      const statsItems: { label: string; value: string }[] = [
        {label: 'WIN RATE', value: `${stats.winRate.toFixed(1)}%`},
        {label: 'TRADES', value: String(stats.totalTrades)},
        {label: 'WINNERS', value: String(stats.winners)},
        {label: 'LOSERS', value: String(stats.losers)},
      ];
      if (stats.totalPoints !== undefined) {
        statsItems.push({
          label: 'POINTS',
          value: (stats.totalPoints >= 0 ? '+' : '') + stats.totalPoints.toFixed(2)
        });
      }

      const colW = (W - statsX - 48) / 2;
      const rowH = 94;
      const startY = H / 2 - (Math.ceil(statsItems.length / 2) * rowH) / 2;

      statsItems.forEach((item, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = statsX + col * colW;
        const y = startY + row * rowH;

        ctx.fillStyle = this.cssVar('--color-text-primary');
        ctx.font = 'bold 34px system-ui, sans-serif';
        ctx.fillText(item.value, x, y + 34);

        ctx.fillStyle = this.cssVar('--color-text-secondary');
        ctx.font = '500 13px system-ui, sans-serif';
        ctx.fillText(item.label, x, y + 56);
      });
    }

    // Bottom watermark bar
    ctx.fillStyle = '#080e1a';
    ctx.fillRect(0, H - 56, W, 56);

    ctx.fillStyle = this.cssVar('--color-text-muted');
    ctx.font = '400 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NVZN Trading Journal  •  Trade smarter, not harder', W / 2, H - 21);
    ctx.textAlign = 'left';
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  private showFeedback(msg: string): void {
    this.feedback.set(msg);
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => this.feedback.set(null), 3000);
  }

  ngOnDestroy(): void {
    clearTimeout(this.feedbackTimer);
  }
}
