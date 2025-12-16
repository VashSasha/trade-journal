import { Component, signal, inject, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TradeService } from '../../../core/services/trade.service';
import { AuthService } from '../../../core/services/auth.service';
import { AssetType, TradeDirection } from '../../../core/models/trade.model';

@Component({
    selector: 'app-trade-entry',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './trade-entry.html',
    styleUrl: './trade-entry.scss'
})
export class TradeEntryComponent implements OnInit {
    private fb = inject(FormBuilder);
    private tradeService = inject(TradeService);
    private authService = inject(AuthService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    tradeForm: FormGroup;
    isSubmitting = signal(false);
    isEditMode = signal(false);
    editingTradeId: string | null = null;

    // P&L as a signal that updates when form changes
    estimatedPnL = signal<{ gross: number; net: number; percent: number } | null>(null);

    // Asset types for dropdown
    assetTypes: AssetType[] = ['stock', 'option', 'forex', 'futures', 'crypto'];

    // Common setups
    commonSetups = [
        'Breakout',
        'Reversal',
        'Trend Following',
        'Support/Resistance',
        'Moving Average Cross',
        'VWAP',
        'Gap Fill',
        'Earnings Play',
        'Custom'
    ];

    // Emotions
    commonEmotions = [
        'Confident',
        'Hesitant',
        'FOMO',
        'Revenge',
        'Disciplined',
        'Anxious',
        'Tilt',
        'Patient',
        'Impulsive'
    ];

    constructor() {
        const today = new Date().toISOString().split('T')[0];

        this.tradeForm = this.fb.group({
            symbol: ['', [Validators.required, Validators.pattern(/^[A-Z]{1,5}$/)]],
            assetType: ['stock' as AssetType, Validators.required],
            direction: ['long' as TradeDirection, Validators.required],
            status: ['open', Validators.required], // Add status control to toggle missed
            entryDate: [today, Validators.required],
            entryTime: [''],
            entryPrice: [null, [Validators.required, Validators.min(0.01)]],
            quantity: [null, [Validators.required, Validators.min(1)]],
            exitDate: [''],
            exitTime: [''],
            exitPrice: [null, Validators.min(0.01)],
            fees: [0, Validators.min(0)],
            setup: [''],
            tags: [[]],
            emotions: [[]],
            notes: ['']
        });

        // Subscribe to form value changes to update P&L
        this.tradeForm.valueChanges.subscribe(() => {
            this.calculatePnL();
        });
    }

    ngOnInit(): void {
        this.route.paramMap.subscribe(params => {
            const id = params.get('id');
            if (id) {
                this.isEditMode.set(true);
                this.editingTradeId = id;
                this.loadTrade(id);
            }
        });
    }

    private loadTrade(id: string): void {
        const trade = this.tradeService.getTradeById(id);
        if (trade) {
            this.tradeForm.patchValue({
                symbol: trade.symbol,
                assetType: trade.assetType,
                direction: trade.direction,
                status: trade.status === 'missed' ? 'missed' : trade.status, // Preserve 'missed' or map to current
                entryDate: this.formatDateForInput(trade.entryDate),
                entryPrice: trade.entryPrice,
                quantity: trade.quantity,
                exitDate: trade.exitDate ? this.formatDateForInput(trade.exitDate) : '',
                exitPrice: trade.exitPrice,
                fees: trade.fees,
                setup: trade.setup,
                notes: trade.notes,
                tags: trade.tags,
                emotions: trade.emotions || []
            });
            // Recalculate P&L after patching
            this.calculatePnL();
        } else {
            this.router.navigate(['/journal']);
        }
    }

    private formatDateForInput(dateString: string): string {
        return new Date(dateString).toISOString().split('T')[0];
    }

    private calculatePnL(): void {
        const entry = this.tradeForm.get('entryPrice')?.value;
        const exit = this.tradeForm.get('exitPrice')?.value;
        const quantity = this.tradeForm.get('quantity')?.value;
        const direction = this.tradeForm.get('direction')?.value;
        const fees = this.tradeForm.get('fees')?.value || 0;

        if (!entry || !exit || !quantity) {
            this.estimatedPnL.set(null);
            return;
        }

        const multiplier = direction === 'long' ? 1 : -1;
        const priceDiff = (exit - entry) * multiplier;
        const grossPnL = priceDiff * quantity;
        const netPnL = grossPnL - fees;
        const pnlPercent = (priceDiff / entry) * 100;

        this.estimatedPnL.set({
            gross: grossPnL,
            net: netPnL,
            percent: pnlPercent
        });
    }

    onSubmit(): void {
        if (this.tradeForm.invalid) {
            this.tradeForm.markAllAsTouched();
            return;
        }

        this.isSubmitting.set(true);

        const currentUser = this.authService.currentUser();
        if (!currentUser) {
            this.isSubmitting.set(false);
            return;
        }

        try {
            const formData = this.tradeForm.value;

            if (this.isEditMode() && this.editingTradeId) {
                this.tradeService.updateTrade(this.editingTradeId, formData);
                this.router.navigate(['/journal', this.editingTradeId]);
            } else {
                this.tradeService.createTrade(formData, currentUser.id);
                this.router.navigate(['/journal']);
            }
        } catch (error) {
            console.error('Error saving trade:', error);
        } finally {
            this.isSubmitting.set(false);
        }
    }

    cancel(): void {
        if (this.isEditMode() && this.editingTradeId) {
            this.router.navigate(['/journal', this.editingTradeId]);
        } else {
            this.router.navigate(['/journal']);
        }
    }

    // Helper to convert symbol to uppercase
    onSymbolInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        input.value = input.value.toUpperCase();
        this.tradeForm.patchValue({ symbol: input.value });
    }

    toggleEmotion(emotion: string): void {
        const currentEmotions = this.tradeForm.get('emotions')?.value as string[];
        if (currentEmotions.includes(emotion)) {
            this.tradeForm.patchValue({
                emotions: currentEmotions.filter(e => e !== emotion)
            });
        } else {
            this.tradeForm.patchValue({
                emotions: [...currentEmotions, emotion]
            });
        }
    }

    isEmotionSelected(emotion: string): boolean {
        const currentEmotions = this.tradeForm.get('emotions')?.value as string[] || [];
        return currentEmotions.includes(emotion);
    }
}
