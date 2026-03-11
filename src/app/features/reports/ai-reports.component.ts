import { Component, inject, signal, OnInit } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { provideMarkdown } from 'ngx-markdown';
import { TradovateService } from '../../core/services/tradovate.service';
import { OpenAiService } from '../../core/services/openai.service';
import { MarkdownComponent } from 'ngx-markdown';

@Component({
    selector: 'app-ai-reports',
    standalone: true,
    imports: [
        
        FormsModule,
        MarkdownComponent
    ],
    providers: [
        provideMarkdown()
    ],
    templateUrl: './ai-reports.component.html'
})
export class AiReportsComponent implements OnInit {
    // Services
    tradovateService = inject(TradovateService);
    openAiService = inject(OpenAiService);

    // UI State
    analysisMode = signal<'screenshot' | 'live'>('screenshot');
    isAnalyzing = signal(false);
    error = signal<string | null>(null);
    prediction = signal<string | null>(null);

    // Screenshot mode
    selectedImage = signal<File | null>(null);
    imagePreview = signal<string | null>(null);

    // Live data mode
    symbol = signal('');
    timeframe = signal('15min');
    lookbackBars = signal(100);

    // API Key
    apiKeyInput = '';

    ngOnInit() {
        // Initialize component
    }

    onImageSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            const file = input.files[0];
            this.selectedImage.set(file);

            // Create preview
            const reader = new FileReader();
            reader.onload = (e) => {
                this.imagePreview.set(e.target?.result as string);
            };
            reader.readAsDataURL(file);
        }
    }

    clearImage() {
        this.selectedImage.set(null);
        this.imagePreview.set(null);
    }

    saveApiKey() {
        if (this.apiKeyInput.trim()) {
            this.openAiService.saveApiKey(this.apiKeyInput.trim());
            this.apiKeyInput = '';
        }
    }

    async analyze() {
        this.isAnalyzing.set(true);
        this.error.set(null);
        this.prediction.set(null);

        try {
            if (this.analysisMode() === 'screenshot') {
                await this.analyzeScreenshot();
            } else {
                await this.analyzeLiveData();
            }
        } catch (err: any) {
            this.error.set(`**Analysis Error**\n\n${err.message || 'An unexpected error occurred'}`);
        } finally {
            this.isAnalyzing.set(false);
        }
    }

    private async analyzeScreenshot() {
        const image = this.selectedImage();
        if (!image) {
            throw new Error('No image selected');
        }

        const base64 = await this.fileToBase64(image);
        //         const prompt = `Analyze this trading chart screenshot${this.symbol() ? ` for ${this.symbol()}` : ''}. Provide:
        // 1. Current market situation and key observations
        // 2. Short-term outlook (next few bars/candles)
        // 3. Key levels to watch
        // 4. Risk considerations

        // Be concise and actionable.`;

        const result = await this.openAiService.analyzeImage(base64, { symbol: this.symbol() }).toPromise();
        console.log(result);
        this.prediction.set(result || 'No analysis provided');
    }

    private async analyzeLiveData() {
        const sym = this.symbol();
        if (!sym) {
            throw new Error('Symbol is required');
        }

        // Fetch market data from Tradovate
        const marketData = await this.tradovateService.getMarketData(
            sym,
            this.timeframe(),
            this.lookbackBars()
        );

        // Use predictMarket method which is designed for market analysis
        const result = await this.openAiService.predictMarket(
            marketData,
            sym,
            this.timeframe()
        ).toPromise();

        this.prediction.set(result || 'No prediction generated');
    }

    private fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                // Remove data URL prefix to get just the base64 string
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    clearPrediction() {
        this.prediction.set(null);
        this.error.set(null);
    }
}
