import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
    selector: 'app-tradovate-settings',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './tradovate-settings.component.html',
    styles: []
})
export class TradovateSettingsComponent {
    private fb = inject(FormBuilder);
    private router = inject(Router);

    configForm: FormGroup;
    isSaved = signal(false);
    showSecret = signal(false);

    constructor() {
        const savedConfig = localStorage.getItem('tradovate_config');
        const initialValues = savedConfig ? JSON.parse(savedConfig) : { apiKey: '', apiSecret: '' };

        this.configForm = this.fb.group({
            apiKey: [initialValues.apiKey, [Validators.required]],
            apiSecret: [initialValues.apiSecret, [Validators.required]]
        });
    }

    toggleSecret(): void {
        this.showSecret.update(v => !v);
    }

    onSubmit(): void {
        if (this.configForm.valid) {
            localStorage.setItem('tradovate_config', JSON.stringify(this.configForm.value));
            this.isSaved.set(true);
            setTimeout(() => this.isSaved.set(false), 3000);
        }
    }

    back(): void {
        this.router.navigate(['/journal']);
    }
}
