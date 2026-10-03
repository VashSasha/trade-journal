import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, output, viewChild } from '@angular/core';
import { BROKER_CATALOG, BrokerId } from './broker-catalog';

@Component({
    selector: 'app-broker-picker',
    standalone: true,
    templateUrl: './broker-picker.component.html',
    styleUrl: './broker-picker.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrokerPickerComponent {
    readonly brokers = BROKER_CATALOG;
    readonly brokerSelected = output<BrokerId>();
    readonly cancelled = output<void>();
    private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');

    constructor() {
        afterNextRender(() => this.heading()?.nativeElement.focus());
    }
}
