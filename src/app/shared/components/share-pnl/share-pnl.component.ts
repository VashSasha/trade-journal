import { Component, computed, ElementRef, HostListener, Input, OnDestroy, signal, ViewChild } from '@angular/core';

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
  @Input({required: true}) pnl!: number;
  @Input({required: true}) stats!: SharePnlStats;
  @Input() date?: string;
  @Input() context: 'journal' | 'dashboard' = 'dashboard';

  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly isOpen = signal(false);
  readonly activeTab = signal<'image' | 'text'>('image');
  readonly layoutMode = signal<'full' | 'clean'>('full');
  readonly feedback = signal<string | null>(null);
  private feedbackTimer?: ReturnType<typeof setTimeout>;

  readonly isPnlPositive = computed(() => this.pnl >= 0);

  readonly formattedDate = computed(() => {
    if (!this.date) return null;
    return new Date(this.date + 'T12:00:00')
      .toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'});
  });

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
      const a = document.createElement('a');
      a.href = url;
      a.download = `nvzn-pnl-${this.date ?? 'summary'}.png`;
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
    const sign = this.pnl >= 0 ? '+' : '';
    const pnlFmt = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(this.pnl);
    const wr = this.stats.winRate.toFixed(1);
    const trades = this.stats.totalTrades;
    const w = this.stats.winners;
    const l = this.stats.losers;
    const pts = this.stats.totalPoints;
    const ptsFmt = pts !== undefined ? ` (${pts >= 0 ? '+' : ''}${pts.toFixed(2)} pts)` : '';
    const datePart = this.formattedDate() ? ` ${this.formattedDate()}` : '';

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

    // Canvas card is always dark-themed (share card for social media)
    ctx.fillStyle = '#070b15';
    ctx.fillRect(0, 0, W, H);

    const isPositive = this.pnl >= 0;
    const pnlColor = isPositive ? '#00E0D3' : '#ef4444';
    const gradientColor = isPositive ? '16,185,129' : '239,68,68';
    const pnlText = (isPositive ? '+' : '') +
      new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(this.pnl);

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

      // Date below
      if (this.date) {
        ctx.fillStyle = this.cssVar('--color-text-muted');
        ctx.font = '400 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.formattedDate() ?? '', W / 2, H / 2 + 120);
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
      ctx.fillText(this.context === 'journal' ? 'Daily Journal' : 'Dashboard Summary', W - 48, 64);
      ctx.textAlign = 'left';
      // ── Full layout: P&L left + stats grid right ──────────────────────────
      ctx.fillStyle = this.cssVar('--color-text-secondary');
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText('NET P&L:', 48, H / 2 - 24);

      ctx.fillStyle = pnlColor;
      ctx.font = 'bold 84px system-ui, sans-serif';
      ctx.fillText(pnlText, 48, H / 2 + 64);

      if (this.date) {
        ctx.fillStyle = this.cssVar('--color-text-muted');
        ctx.font = '400 20px system-ui, sans-serif';
        ctx.fillText(this.formattedDate() ?? '', 48, H / 2 + 120);
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
        {label: 'WIN RATE', value: `${this.stats.winRate.toFixed(1)}%`},
        {label: 'TRADES', value: String(this.stats.totalTrades)},
        {label: 'WINNERS', value: String(this.stats.winners)},
        {label: 'LOSERS', value: String(this.stats.losers)},
      ];
      if (this.stats.totalPoints !== undefined) {
        statsItems.push({
          label: 'POINTS',
          value: (this.stats.totalPoints >= 0 ? '+' : '') + this.stats.totalPoints.toFixed(2)
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
