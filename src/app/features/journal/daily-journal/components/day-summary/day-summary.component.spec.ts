import { TestBed } from '@angular/core/testing';
import { Component, Input, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { EquityData } from '../../../../../shared/components/equity-curve-chart/equity-curve-chart.component';
import { Observable, of, Subscriber } from 'rxjs';
import { vi } from 'vitest';
import { Trade } from '../../../../../core/models/trade.model';
import { AccountSettingsService } from '../../../../../core/services/account-settings.service';
import { AccessPolicyService } from '../../../../../core/services/access-policy.service';
import { DailyJournalService } from '../../../../../core/services/daily-journal.service';
import { FilterService } from '../../../../../core/services/filter.service';
import { OpenAiService } from '../../../../../core/services/openai.service';
import { TradeService } from '../../../../../core/services/trade.service';
import { AiAnalysisService, SavedAnalysis } from '../saved-analyses/ai-analysis.service';
import { DaySummaryComponent } from './day-summary.component';

const MAIN_REVIEW = `## Verdict
**B+** — You followed the plan.

## What worked
- Entries stayed selective.

## What cost you
- The final decision was late.

## Tomorrow's focus
- [ ] Stop after the planned window`;

const DEEPER_REVIEW = 'The final entry arrived after your strongest trading window, so the extra risk did not add a new edge.';

@Component({ selector: 'app-equity-curve-chart', standalone: true, template: '' })
class ChartProbe {
    @Input() equityData!: EquityData;
    @Input() baseline = 0;
    updates = 0;
    ngOnChanges(): void { this.updates++; }
}

function trade(id: string, accountId: string): Trade {
    return {
        id,
        userId: 'user',
        symbol: 'MNQU6',
        assetType: 'futures',
        direction: 'long',
        entryDate: '2026-08-04T14:30:00.000Z',
        exitDate: '2026-08-04T14:35:00.000Z',
        entryPrice: 23_000,
        exitPrice: 23_010,
        quantity: 1,
        pnl: 20,
        netPnl: 18,
        fees: 2,
        source: 'tradovate',
        accountId,
        status: 'closed',
        createdAt: '2026-08-04T14:30:00.000Z',
        updatedAt: '2026-08-04T14:35:00.000Z',
    };
}

describe('DaySummaryComponent AI persistence', () => {
    it('does not redraw for unrelated UI/AI updates, but refreshes when trades or account balances change', () => {
        const startingBalance = signal(50_000);
        TestBed.configureTestingModule({ providers: [
            { provide: AccountSettingsService, useValue: { startingBalance } },
            ...[AccessPolicyService, OpenAiService, AiAnalysisService, DailyJournalService, TradeService, FilterService]
                .map(provide => ({ provide, useValue: {} })),
        ] }).overrideComponent(DaySummaryComponent, { set: {
            imports: [ChartProbe], template: '<app-equity-curve-chart [equityData]="equityData" [baseline]="chartBase" />',
        } });
        const fixture = TestBed.createComponent(DaySummaryComponent), component = fixture.componentInstance;
        fixture.componentRef.setInput('trades', [trade('one', 'account-a')]); fixture.detectChanges();
        const chart = fixture.debugElement.query(By.directive(ChartProbe)).componentInstance as ChartProbe;
        const initial = component.equityData;
        component.copiedFocus.set(true); fixture.detectChanges();
        component.insightState.set({ status: 'streaming', content: 'New chunk', error: null }); fixture.detectChanges();
        fixture.detectChanges(); expect(chart.updates).toBe(1); expect(component.equityData).toBe(initial);
        fixture.componentRef.setInput('trades', [trade('two', 'account-b'), trade('three', 'account-b')]); fixture.detectChanges();
        expect(chart.updates).toBe(2); expect(component.stats.totalTrades).toBe(2);
        fixture.componentRef.setInput('startBalance', 25_000); fixture.detectChanges(); expect(chart.updates).toBe(3);
        startingBalance.set(100_000); fixture.detectChanges(); expect(chart.updates).toBe(3); // Explicit historical balance wins.
        fixture.componentRef.setInput('startBalance', undefined); fixture.detectChanges(); expect(chart.updates).toBe(4);
        startingBalance.set(50_000); fixture.detectChanges(); expect(chart.updates).toBe(5);
        fixture.destroy();
    });
    it('auto-saves the short review and updates the same row with the deeper review', async () => {
        const saveAnalysis = vi.fn(async (date: string, content: string): Promise<SavedAnalysis> => ({
            id: 'analysis-1', date, content, createdAt: '2026-08-04T15:00:00.000Z',
        }));
        const updateAnalysis = vi.fn(async (id: string, content: string): Promise<SavedAnalysis> => ({
            id, date: '2026-08-04', content, createdAt: '2026-08-04T15:00:00.000Z',
        }));
        const streamAnalysis = vi.fn()
            .mockReturnValueOnce(of(MAIN_REVIEW))
            .mockReturnValueOnce(of(DEEPER_REVIEW));

        TestBed.configureTestingModule({
            imports: [DaySummaryComponent],
            providers: [
                { provide: AccountSettingsService, useValue: { startingBalance: () => 50_000 } },
                { provide: AccessPolicyService, useValue: {
                    demo: () => false,
                    requestAction: () => true,
                    paid: () => true,
                } },
                { provide: OpenAiService, useValue: { streamAnalysis } },
                { provide: AiAnalysisService, useValue: {
                    latestAnalysisBefore: vi.fn().mockResolvedValue(null),
                    saveAnalysis,
                    updateAnalysis,
                } },
                { provide: DailyJournalService, useValue: {
                    getNoteForDate: () => undefined,
                    customRules: () => [],
                } },
                { provide: TradeService, useValue: { trades: () => [] } },
                { provide: FilterService, useValue: { filterTradesIgnoreDateRange: () => [] } },
            ],
        }).overrideComponent(DaySummaryComponent, { set: { template: '' } });

        const fixture = TestBed.createComponent(DaySummaryComponent);
        const component = fixture.componentInstance;
        component.date = '2026-08-04';
        component.trades = [trade('one', 'account-a'), trade('two', 'account-b')];

        await component.generateInsight();
        await vi.waitFor(() => expect(saveAnalysis).toHaveBeenCalledOnce());

        const initialContent = saveAnalysis.mock.calls[0][1];
        // Both executions share the same timestamps on different accounts, so
        // the saved context must identify one underlying decision.
        expect(initialContent).toContain('1 inferred decision from 2 executions across 2 accounts');
        expect(initialContent).toContain(MAIN_REVIEW);

        component.tellMeMore();
        await vi.waitFor(() => expect(updateAnalysis).toHaveBeenCalledOnce());

        expect(updateAnalysis.mock.calls[0][0]).toBe('analysis-1');
        expect(updateAnalysis.mock.calls[0][1]).toContain(MAIN_REVIEW);
        expect(updateAnalysis.mock.calls[0][1]).toContain('## Deeper review');
        expect(updateAnalysis.mock.calls[0][1]).toContain(DEEPER_REVIEW);
        expect(saveAnalysis).toHaveBeenCalledOnce();

        fixture.destroy();
    });
});

describe('DaySummaryComponent date-scoped coaching', () => {
    const FIRST = '2026-08-04', SECOND = '2026-08-05';
    function deferred<T>() {
        let resolve!: (value: T) => void, reject!: (reason: Error) => void;
        const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
        return { promise, resolve, reject };
    }
    function setup() {
        const latestAnalysisBefore = vi.fn().mockResolvedValue(null);
        const saveAnalysis = vi.fn(async (date: string, content: string): Promise<SavedAnalysis> => ({
            id: `saved-${date}`, date, content, createdAt: `${date}T15:00:00Z`,
        }));
        const updateAnalysis = vi.fn(async (id: string, content: string): Promise<SavedAnalysis> => ({
            id, date: SECOND, content, createdAt: `${SECOND}T15:00:00Z`,
        }));
        const streamAnalysis = vi.fn(() => of(MAIN_REVIEW));
        TestBed.configureTestingModule({ providers: [
            { provide: AccountSettingsService, useValue: { startingBalance: () => 50_000 } },
            { provide: AccessPolicyService, useValue: { demo: () => false, requestAction: () => true } },
            { provide: OpenAiService, useValue: { streamAnalysis } },
            { provide: AiAnalysisService, useValue: { latestAnalysisBefore, saveAnalysis, updateAnalysis } },
            { provide: DailyJournalService, useValue: { getNoteForDate: () => undefined, customRules: () => [] } },
            { provide: TradeService, useValue: { trades: () => [] } },
            { provide: FilterService, useValue: { filterTradesIgnoreDateRange: () => [] } },
        ] }).overrideComponent(DaySummaryComponent, { set: {
            template: '@if (coach(); as c) { <p class="verdict">{{ c.verdict }}</p> }',
        } });
        const fixture = TestBed.createComponent(DaySummaryComponent), component = fixture.componentInstance;
        fixture.componentRef.setInput('date', FIRST);
        fixture.componentRef.setInput('trades', [trade('one', 'account-a')]); fixture.detectChanges();
        const changeDate = (date: string) => { fixture.componentRef.setInput('date', date); fixture.detectChanges(); };
        return { fixture, component, changeDate, latestAnalysisBefore, saveAnalysis, updateAnalysis, streamAnalysis };
    }

    it('clears the verdict, follow-up, focus and save state on a different date without generating AI automatically', async () => {
        const { fixture, component, changeDate, streamAnalysis, saveAnalysis } = setup();
        await component.generateInsight(); await vi.waitFor(() => expect(component.insightSaved()).toBe(true));
        component.tellMeMore(); await vi.waitFor(() => expect(component.aiSaving()).toBe(false));
        component.copiedFocus.set(true); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.verdict')).not.toBeNull();
        const calls = streamAnalysis.mock.calls.length;
        changeDate(SECOND);
        expect(fixture.nativeElement.querySelector('.verdict')).toBeNull();
        expect(component.insightState()).toEqual({ status: 'idle', content: '', error: null });
        expect(component.followUpInsight()).toEqual({ status: 'idle', content: '', error: null });
        expect(component.insightConfidence()).toBeNull(); expect(component.followUpInsightConfidence()).toBeNull();
        expect(component.focusItem()).toBeNull(); expect(component.coachActivity()).toBeNull();
        expect(component.copiedFocus()).toBe(false); expect(component.insightSaved()).toBe(false);
        expect(component.aiSaveError()).toBeNull(); expect(component.activeInsightSteps()).toEqual([]);
        expect(streamAnalysis).toHaveBeenCalledTimes(calls);
        component.tellMeMore(); await component.saveInsight(); expect(streamAnalysis).toHaveBeenCalledTimes(calls);
        await component.generateInsight();
        expect(saveAnalysis).toHaveBeenLastCalledWith(SECOND, expect.stringContaining(MAIN_REVIEW));
    });

    it('preserves a completed verdict when the same date is assigned again', async () => {
        const { component, changeDate, streamAnalysis } = setup();
        await component.generateInsight(); changeDate(FIRST);
        expect(component.coach()?.grade).toBe('B+'); expect(streamAnalysis).toHaveBeenCalledOnce();
    });

    it('ignores an old context lookup even after returning to the original date and blocks duplicate starts', async () => {
        const { component, changeDate, latestAnalysisBefore, streamAnalysis } = setup();
        const old = deferred<SavedAnalysis | null>(); latestAnalysisBefore.mockReturnValueOnce(old.promise);
        const run = component.generateInsight();
        await component.generateInsight(); expect(latestAnalysisBefore).toHaveBeenCalledOnce();
        changeDate(SECOND); changeDate(FIRST);
        old.resolve(null); await run;
        expect(streamAnalysis).not.toHaveBeenCalled(); expect(component.insightState().status).toBe('idle');
    });

    it('cancels a partial review on navigation and never saves late chunks under another date', async () => {
        const { component, changeDate, streamAnalysis, saveAnalysis } = setup();
        let sink!: Subscriber<string>; const cancel = vi.fn();
        streamAnalysis.mockReturnValueOnce(new Observable(subscriber => { sink = subscriber; return cancel; }));
        await component.generateInsight(); sink.next('## Verdict\nPartial');
        changeDate(SECOND);
        expect(cancel).toHaveBeenCalledOnce(); expect(sink.closed).toBe(true);
        sink.next(MAIN_REVIEW); sink.complete();
        expect(component.coach()).toBeNull(); expect(component.insightState().status).toBe('idle');
        expect(saveAnalysis).not.toHaveBeenCalled();
    });

    it('cancels a deeper review without overwriting the saved main analysis', async () => {
        const { component, changeDate, streamAnalysis, saveAnalysis, updateAnalysis } = setup();
        await component.generateInsight(); await vi.waitFor(() => expect(component.insightSaved()).toBe(true));
        let sink!: Subscriber<string>;
        streamAnalysis.mockReturnValueOnce(new Observable(subscriber => { sink = subscriber; }));
        component.tellMeMore(); sink.next('Partial follow-up'); changeDate(SECOND);
        expect(sink.closed).toBe(true); sink.complete();
        expect(component.followUpInsight().status).toBe('idle'); expect(updateAnalysis).not.toHaveBeenCalled();
        expect(saveAnalysis).toHaveBeenCalledExactlyOnceWith(FIRST, expect.stringContaining(MAIN_REVIEW));
    });

    it('allows the old day to finish saving but never attaches that record to the new day', async () => {
        const { component, changeDate, saveAnalysis, updateAnalysis } = setup();
        const oldSave = deferred<SavedAnalysis>(), newSave = deferred<SavedAnalysis>();
        saveAnalysis.mockReturnValueOnce(oldSave.promise).mockReturnValueOnce(newSave.promise);
        await component.generateInsight(); changeDate(SECOND); await component.generateInsight();
        expect(saveAnalysis).toHaveBeenCalledTimes(2);
        oldSave.resolve({ id: 'old-id', date: FIRST, content: MAIN_REVIEW, createdAt: FIRST });
        await Promise.resolve(); expect(component.aiSaving()).toBe(true); expect(component.insightSaved()).toBe(false);
        newSave.resolve({ id: 'new-id', date: SECOND, content: MAIN_REVIEW, createdAt: SECOND });
        await vi.waitFor(() => expect(component.insightSaved()).toBe(true));
        component.tellMeMore();
        expect(updateAnalysis).toHaveBeenCalledWith('new-id', expect.any(String));
    });

    it('does not surface an old save failure on another date', async () => {
        const { component, changeDate, saveAnalysis } = setup();
        const oldSave = deferred<SavedAnalysis>(); saveAnalysis.mockReturnValueOnce(oldSave.promise);
        await component.generateInsight(); changeDate(SECOND);
        oldSave.reject(new Error('Old day could not save')); await Promise.resolve();
        expect(component.aiSaveError()).toBeNull(); expect(component.aiSaving()).toBe(false);
    });

    it('does not start a late generation after the widget is destroyed', async () => {
        const { fixture, component, latestAnalysisBefore, streamAnalysis } = setup();
        const old = deferred<SavedAnalysis | null>(); latestAnalysisBefore.mockReturnValueOnce(old.promise);
        const run = component.generateInsight(); fixture.destroy(); old.resolve(null); await run;
        expect(streamAnalysis).not.toHaveBeenCalled();
    });

    it('does not turn a partial stream into a saved verdict when the widget is destroyed', async () => {
        const { fixture, component, streamAnalysis, saveAnalysis } = setup();
        let sink!: Subscriber<string>;
        streamAnalysis.mockReturnValueOnce(new Observable(subscriber => { sink = subscriber; }));
        await component.generateInsight(); sink.next('## Verdict\nUnfinished'); fixture.destroy();
        expect(sink.closed).toBe(true); expect(saveAnalysis).not.toHaveBeenCalled();
    });
});
