import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReportAnalysisService } from './report-analysis.service';
import { DEMO_VERDICT } from './demo-verdict';
import { AuthService } from '../../core/services/auth.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { DemoModeService } from '../../core/services/demo-mode.service';
import { setCacheSuspended } from '../../core/services/user-data/user-data.cache';
import { AiAnalysisService } from '../journal/daily-journal/components/saved-analyses/ai-analysis.service';

describe('saved AI data stays out of demo', () => {
    const from = vi.fn();
    beforeEach(() => {
        setCacheSuspended(true); from.mockClear();
        TestBed.configureTestingModule({ providers: [
            AiAnalysisService,
            { provide: SupabaseService, useValue: { client: { from } } },
            { provide: AuthService, useValue: { plan: () => 'premium', isAuthenticated: () => true } },
            { provide: UserSessionService, useValue: { userId: () => 'A' } },
            { provide: DemoModeService, useValue: { requireAccount: () => false } },
        ] });
    });
    afterEach(() => setCacheSuspended(false));
    it('never lists, saves or deletes real reports while previewing, even for paid users', async () => {
        const reports = TestBed.inject(ReportAnalysisService);
        await reports.listReports();
        await expect(reports.saveReport('Example', DEMO_VERDICT)).rejects.toThrow('demo');
        await expect(reports.deleteReport('real-report')).rejects.toThrow('demo');
        expect(reports.reports()).toEqual([]);
        expect(from).not.toHaveBeenCalled();
    });
    it('never reads real journal insights into a demo coaching prompt or mutates saved insights', async () => {
        const journal = TestBed.inject(AiAnalysisService);
        await journal.listAnalyses('2026-09-04');
        expect(await journal.latestAnalysisBefore('2026-09-04')).toBeNull();
        await expect(journal.saveAnalysis('2026-09-04', 'Sample')).rejects.toThrow();
        await expect(journal.updateAnalysis('real-insight', 'Changed')).rejects.toThrow();
        await expect(journal.deleteAnalysis('real-insight')).rejects.toThrow('demo');
        expect(from).not.toHaveBeenCalled();
    });
});
