import { Component, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
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
export class TradeEntryComponent {
    private fb = inject(FormBuilder);
    private tradeService = inject(TradeService);
    private authService = inject(AuthService);
    private router = inject(Router);

    tradeForm: FormGroup;
    isSubmitting = signal(false);

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

    constructor() {
        const today = new Date().toISOString().split('T')[0];

        this.tradeForm = this.fb.group({
            symbol: ['', [Validators.required, Validators.pattern(/^[A-Z]{1,5}$/)]],
            assetType: ['stock' as AssetType, Validators.required],
            direction: ['long' as TradeDirection, Validators.required],
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
            notes: ['']
        });

        // Subscribe to form value changes to update P&L
        this.tradeForm.valueChanges.subscribe(() => {
            this.calculatePnL();
        });
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
            this.tradeService.createTrade(formData, currentUser.id);

            // Navigate to journal to see the saved trade
            this.router.navigate(['/journal']);
        } catch (error) {
            console.error('Error creating trade:', error);
        } finally {
            this.isSubmitting.set(false);
        }
    }

    cancel(): void {
        this.router.navigate(['/journal']);
    }

    // Helper to convert symbol to uppercase
    onSymbolInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        input.value = input.value.toUpperCase();
        this.tradeForm.patchValue({ symbol: input.value });
    }
}
