import { Trade } from '../../models/trade.model';
import { DailyNote, JournalTemplate } from '../../models/daily-journal.model';

/**
 * camelCase model ↔ snake_case row mapping for the Phase 2 tables.
 *
 * Writers coerce absent optional fields to null (not undefined) so an upsert
 * is authoritative: clearing a field locally also clears it in Postgres.
 * user_id is never written — it defaults to auth.uid() server-side and RLS
 * rejects anything else.
 */

export interface UserSettings {
    startingBalance: number;
    commissionPerContract: number;
    customRules: string[] | null;
    importedAt: string | null;
}

type Row = Record<string, unknown>;

/** null (from Postgres) → undefined (optional model field). */
function opt<T>(value: T | null | undefined): T | undefined {
    return value === null || value === undefined ? undefined : value;
}

// ── trades ───────────────────────────────────────────────────────────────

export function tradeToRow(t: Trade): Row {
    return {
        id: t.id,
        symbol: t.symbol,
        asset_type: t.assetType,
        direction: t.direction,
        entry_date: t.entryDate,
        entry_time: t.entryTime ?? null,
        entry_price: t.entryPrice,
        quantity: t.quantity,
        exit_date: t.exitDate ?? null,
        exit_time: t.exitTime ?? null,
        exit_price: t.exitPrice ?? null,
        fees: t.fees ?? null,
        multiplier: t.multiplier ?? null,
        pnl: t.pnl ?? null,
        pnl_percent: t.pnlPercent ?? null,
        net_pnl: t.netPnl ?? null,
        setup: t.setup ?? null,
        playbook_id: t.playbookId ?? null,
        tags: t.tags ?? null,
        emotions: t.emotions ?? null,
        grade: t.grade ?? null,
        mistakes: t.mistakes ?? null,
        went_well: t.wentWell ?? null,
        to_improve: t.toImprove ?? null,
        source: t.source ?? null,
        external_id: t.externalId ?? null,
        connection_id: t.connectionId ?? null,
        account_id: t.accountId ?? null,
        account_name: t.accountName ?? null,
        notes: t.notes ?? null,
        screenshots: t.screenshots ?? null,
        status: t.status,
        created_at: t.createdAt,
        updated_at: t.updatedAt
    };
}

export function rowToTrade(r: Row): Trade {
    return {
        id: r['id'] as string,
        userId: r['user_id'] as string,
        symbol: r['symbol'] as string,
        assetType: r['asset_type'] as Trade['assetType'],
        direction: r['direction'] as Trade['direction'],
        entryDate: r['entry_date'] as string,
        entryTime: opt(r['entry_time'] as string | null),
        entryPrice: Number(r['entry_price']),
        quantity: Number(r['quantity']),
        exitDate: opt(r['exit_date'] as string | null),
        exitTime: opt(r['exit_time'] as string | null),
        exitPrice: numOpt(r['exit_price']),
        fees: numOpt(r['fees']),
        multiplier: numOpt(r['multiplier']),
        pnl: numOpt(r['pnl']),
        pnlPercent: numOpt(r['pnl_percent']),
        netPnl: numOpt(r['net_pnl']),
        setup: opt(r['setup'] as string | null),
        playbookId: opt(r['playbook_id'] as string | null),
        tags: opt(r['tags'] as string[] | null),
        emotions: opt(r['emotions'] as string[] | null),
        grade: opt(r['grade'] as Trade['grade'] | null),
        mistakes: opt(r['mistakes'] as string[] | null),
        wentWell: opt(r['went_well'] as string | null),
        toImprove: opt(r['to_improve'] as string | null),
        source: opt(r['source'] as Trade['source'] | null),
        externalId: opt(r['external_id'] as string | null),
        connectionId: opt(r['connection_id'] as string | null),
        accountId: opt(r['account_id'] as string | null),
        accountName: opt(r['account_name'] as string | null),
        notes: opt(r['notes'] as string | null),
        screenshots: opt(r['screenshots'] as string[] | null),
        status: r['status'] as Trade['status'],
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string
    };
}

/** numeric columns come back as strings from Postgres; null → undefined. */
function numOpt(value: unknown): number | undefined {
    return value === null || value === undefined ? undefined : Number(value);
}

// ── journal_entries ──────────────────────────────────────────────────────

export function noteToRow(n: DailyNote): Row {
    return {
        id: n.id,
        date: n.date,
        content: n.content ?? '',
        pre_market_plan: n.preMarketPlan ?? null,
        post_market_review: n.postMarketReview ?? null,
        mood: n.mood ?? null,
        discipline: n.discipline ?? null,
        rules_followed: n.rulesFollowed ?? null,
        avoided_news_events: n.avoidedNewsEvents ?? null,
        custom_news_events: n.customNewsEvents ?? null,
        news_event_tags: n.newsEventTags ?? null,
        tags: n.tags ?? null,
        created_at: n.createdAt,
        updated_at: n.updatedAt
    };
}

export function rowToNote(r: Row): DailyNote {
    return {
        id: r['id'] as string,
        date: r['date'] as string,
        content: (r['content'] as string | null) ?? '',
        preMarketPlan: opt(r['pre_market_plan'] as string | null),
        postMarketReview: opt(r['post_market_review'] as string | null),
        mood: numOpt(r['mood']),
        discipline: numOpt(r['discipline']),
        rulesFollowed: opt(r['rules_followed'] as string[] | null),
        avoidedNewsEvents: opt(r['avoided_news_events'] as string[] | null),
        customNewsEvents: opt(r['custom_news_events'] as DailyNote['customNewsEvents'] | null),
        newsEventTags: opt(r['news_event_tags'] as DailyNote['newsEventTags'] | null),
        tags: opt(r['tags'] as string[] | null),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string
    };
}

// ── journal_templates ────────────────────────────────────────────────────

export function templateToRow(t: JournalTemplate): Row {
    return {
        id: t.id,
        name: t.name,
        type: t.type,
        content: t.content,
        created_at: t.createdAt,
        updated_at: t.updatedAt
    };
}

export function rowToTemplate(r: Row): JournalTemplate {
    return {
        id: r['id'] as string,
        name: r['name'] as string,
        type: r['type'] as JournalTemplate['type'],
        content: r['content'] as string,
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string
    };
}

// ── user_settings ────────────────────────────────────────────────────────

export function settingsToRow(s: Partial<UserSettings>): Row {
    const row: Row = {};
    if (s.startingBalance !== undefined) row['starting_balance'] = s.startingBalance;
    if (s.commissionPerContract !== undefined) row['commission_per_contract'] = s.commissionPerContract;
    if (s.customRules !== undefined) row['custom_rules'] = s.customRules;
    if (s.importedAt !== undefined) row['imported_at'] = s.importedAt;
    return row;
}

export function rowToSettings(r: Row): UserSettings {
    return {
        startingBalance: Number(r['starting_balance'] ?? 25000),
        commissionPerContract: Number(r['commission_per_contract'] ?? 0.25),
        customRules: (r['custom_rules'] as string[] | null) ?? null,
        importedAt: (r['imported_at'] as string | null) ?? null
    };
}
