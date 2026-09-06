import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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
