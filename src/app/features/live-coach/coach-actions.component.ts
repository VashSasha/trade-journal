import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { CoachChatService } from './chat/coach-chat.service';
import { LiveCoachService } from './live-coach.service';

export type CoachView = 'chat' | 'history' | 'settings';

/** One disclosure for secondary actions; normal buttons retain native keyboard navigation. */
@Component({
    selector: 'app-coach-actions', standalone: true, imports: [RouterLink],
    templateUrl: './coach-actions.component.html', styleUrl: './coach-actions.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachActionsComponent {
    readonly chat = inject(CoachChatService);
    readonly coach = inject(LiveCoachService);
    readonly access = inject(AccessPolicyService);
    readonly navigate = output<CoachView>();
    readonly currentView = input<CoachView>('chat');
    readonly open = signal(false);
    readonly confirming = signal(false);
    private readonly element = inject(ElementRef<HTMLElement>);
    private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

    toggle(): void { this.open.update(value => !value); this.confirming.set(false); }
    close(restoreFocus = false): void {
        this.open.set(false); this.confirming.set(false);
        if (restoreFocus) this.trigger()?.nativeElement.focus();
    }
    show(view: CoachView): void { this.navigate.emit(view); this.close(true); }
    start(): void { this.chat.newConversation(); this.show('chat'); }
    choose(id: string): void { void this.chat.open(id); this.show('chat'); }
    refresh(): void { if (this.chat.conversationId()) void this.chat.open(this.chat.conversationId()!); this.show('chat'); }
    async remove(): Promise<void> { await this.chat.remove(); this.show('chat'); }
    @HostListener('document:click', ['$event']) outside(event: MouseEvent): void {
        if (!this.element.nativeElement.contains(event.target as Node)) this.close();
    }
    @HostListener('focusout', ['$event']) blur(event: FocusEvent): void {
        if (event.relatedTarget && !this.element.nativeElement.contains(event.relatedTarget as Node)) this.close();
    }
    escape(event: Event): void { if (this.open()) { event.stopPropagation(); this.close(true); } }
}
