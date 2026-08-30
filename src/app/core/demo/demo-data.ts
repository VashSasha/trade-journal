import { Trade } from '../models/trade.model';
import { DailyNote, DEFAULT_TRADING_RULES, JournalTemplate } from '../models/daily-journal.model';
import { StoredTradingAccount } from '../services/user-data/user-data.mappers';
import { UserSettings } from '../services/user-data/user-data.mappers';
import { isMarketClosed } from '../utils/market-holidays';

export interface DemoDataset {
    trades: Trade[];
    notes: DailyNote[];
    rules: string[];
    templates: JournalTemplate[];
    settings: Pick<UserSettings, 'startingBalance' | 'commissionPerContract'>;
    tradingAccounts: StoredTradingAccount[];
}

// ── PRNG (mulberry32 — deterministic, same seed → same data every visit) ──

function mulberry32(seed: number): () => number {
    let s = seed;
    return function () {
        s += 0x6D2B79F5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const PRNG_SEED = 0x4E564A4E; // "NVJN"
const DEMO_USER_ID = 'demo-user';
export const LIVE_ACCOUNT_ID = 112233;
export const HIST_ACCOUNT_ID = 998877;
const STARTING_BALANCE = 25000;
const COMMISSION_PER_CONTRACT = 0.85;

// ── Instruments ──────────────────────────────────────────────────────────

const INSTRUMENTS = [
    { symbol: 'MNQ', multiplier: 2,  basePrice: 21_400, drift: 3.5  },
    { symbol: 'ES',  multiplier: 50, basePrice: 5_880,  drift: 0.8  },
    { symbol: 'NQ',  multiplier: 20, basePrice: 21_400, drift: 3.5  },
] as const;

// Weights: MNQ most common (micro), then ES, then NQ
const INSTRUMENT_WEIGHTS = [0.55, 0.30, 0.15];

// ── Phase configuration ────────────────────────────────────────────────────
// Three-act story: early drawdown → chop → recovery above starting balance

interface Phase {
    winRate: number;
    winPointsRange: [number, number]; // in instrument points
    lossPointsRange: [number, number];
    tradesRange: [number, number]; // trades per day
    quantityRange: [number, number]; // contracts
}

const PHASES: Phase[] = [
    // Act 1: struggling — below starting balance
    { winRate: 0.36, winPointsRange: [20, 45], lossPointsRange: [18, 42], tradesRange: [2, 4], quantityRange: [1, 3] },
    // Act 2: choppy recovery attempt — still mostly below starting balance
    { winRate: 0.51, winPointsRange: [22, 50], lossPointsRange: [15, 35], tradesRange: [1, 3], quantityRange: [1, 2] },
    // Act 3: consistent — climbs well above starting balance
    { winRate: 0.67, winPointsRange: [28, 60], lossPointsRange: [12, 28], tradesRange: [2, 3], quantityRange: [2, 4] },
];

// ── Date helpers ──────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getTradingDays(count: number): string[] {
    const days: string[] = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    while (days.length < count) {
        d.setDate(d.getDate() - 1);
        if (!isMarketClosed(d)) days.unshift(toDateStr(new Date(d)));
    }
    return days;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function between(prng: () => number, min: number, max: number): number {
    return min + prng() * (max - min);
}

function weightedPick<T>(prng: () => number, items: readonly T[], weights: number[]): T {
    const r = prng();
    let cumulative = 0;
    for (let i = 0; i < items.length; i++) {
        cumulative += weights[i];
        if (r < cumulative) return items[i];
    }
    return items[items.length - 1];
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

// ── Canned journal content ─────────────────────────────────────────────────

const PRE_MARKET_PLANS = [
    `<p>Bias: <strong>Long</strong> above overnight highs. Key levels: 21,420 support, 21,480 resistance. Plan to fade any early stops, then follow the breakout. Max 2 losses and done.</p>`,
    `<p>Market looks extended overnight. Looking for a <strong>short setup</strong> off the open if we reject the pre-market high. Will not chase — wait for a clean retest entry. Risk 2 points on MNQ, scale out at 1:2.</p>`,
    `<p>FOMC minutes today at 2PM — no new positions after 1:30PM. Morning session only. Focus on MNQ for clean price action, avoid ES due to spread during news window.</p>`,
    `<p>Pullback day expected after yesterday's strong run. Looking for a <strong>buy the dip</strong> setup on MNQ near 21,350. If we breach that level, will flip and look for shorts.</p>`,
    `<p>Rest day mentally after yesterday's losses. Plan to take <em>only one trade</em> and call it there regardless. Quality over quantity. Will size down to 1 contract only.</p>`,
    `<p>Strong trend day setup — momentum scan showing breadth expansion. Will look to add contracts on the first pullback confirmation. No counter-trend trades today.</p>`,
];

const POST_MARKET_REVIEWS = [
    `<p>Executed the plan well. First trade was a clean setup; took profit at target and moved on. <strong>+$284</strong> on the day. Discipline 5/5.</p>`,
    `<p>Stopped out twice early chasing the open. Third trade was a winner but didn't fully make up the losses. Need to wait for the first 30-minute bar to close before entering.</p>`,
    `<p>Good morning session, gave back half at the close. FOMO kicked in after 1PM — did exactly what I planned not to do. Tomorrow no afternoon trading.</p>`,
    `<p>Best day this month. Let the winner run to target without cutting early. Setup was exactly what I planned pre-market. Going to review this trade as a reference.</p>`,
    `<p>Choppy day, took the stop loss and called it. Clean execution of the exit — no revenge trade. This is progress.</p>`,
    `<p>Flat on the day. Breakeven after commissions. Not a loss — that's a win on a tough day. Patience was tested and held.</p>`,
];

const TAGS_POOL = [
    'trend-day', 'reversal', 'breakout', 'pullback', 'FOMC', 'CPI',
    'gap-fill', 'failed-breakout', 'scalp', 'overnight-gap', 'range-day', 'news'
];

const PLAN_TEMPLATE_CONTENT =
    `<h3>Pre-Market Plan</h3><p>Bias: </p><p>Key levels:</p><ul><li>Support: </li><li>Resistance: </li></ul><p>Setup criteria:</p><p>Max risk for the day: </p>`;

// ── Main generator ─────────────────────────────────────────────────────────

export function generateDemoData(): DemoDataset {
    const prng = mulberry32(PRNG_SEED);
    const TOTAL_DAYS = 80;
    const tradingDays = getTradingDays(TOTAL_DAYS);

    const trades: Trade[] = [];
    const notes: DailyNote[] = [];
    let tradeCounter = 0;

    for (let di = 0; di < tradingDays.length; di++) {
        const dateStr = tradingDays[di];

        // Phase: 0 = act1 (first 25 days), 1 = act2 (next 25), 2 = act3 (last 30)
        const phase = di < 25 ? 0 : di < 50 ? 1 : 2;
        const phaseConf = PHASES[phase];

        // Number of trades this day
        const numTrades = Math.round(between(prng,
            phaseConf.tradesRange[0], phaseConf.tradesRange[1]));

        for (let ti = 0; ti < numTrades; ti++) {
            const id = `demo_${di}_${ti}`;
            const instrument = weightedPick(prng, INSTRUMENTS, INSTRUMENT_WEIGHTS);
            const direction = prng() > 0.5 ? 'long' : 'short';
            const quantity = Math.round(between(prng,
                phaseConf.quantityRange[0], phaseConf.quantityRange[1]));
            const isWin = prng() < phaseConf.winRate;

            // Generate entry price with slow drift to simulate market movement
            const priceNoise = between(prng, -instrument.drift * 10, instrument.drift * 10);
            const entryPrice = round2(instrument.basePrice + priceNoise + di * instrument.drift);

            const [minPts, maxPts] = isWin ? phaseConf.winPointsRange : phaseConf.lossPointsRange;
            const points = round2(between(prng, minPts, maxPts));
            const pnlSign = isWin ? 1 : -1;

            const grossPnl = round2(pnlSign * points * instrument.multiplier * quantity);
            const fees = round2(COMMISSION_PER_CONTRACT * quantity);
            const netPnl = round2(grossPnl - fees);

            const exitPoints = direction === 'long'
                ? round2(entryPrice + pnlSign * points)
                : round2(entryPrice - pnlSign * points);

            // Session time — spread across the trading day
            const entryHour = 9 + Math.floor(between(prng, 0, 5.5));
            const entryMin = Math.floor(prng() * 60);
            const holdMins = Math.floor(between(prng, 5, 90));
            const entryTime = `${String(entryHour).padStart(2, '0')}:${String(entryMin).padStart(2, '0')}`;
            const exitDate = new Date(`${dateStr}T${entryTime}:00`);
            exitDate.setMinutes(exitDate.getMinutes() + holdMins);
            const exitTime = `${String(exitDate.getHours()).padStart(2, '0')}:${String(exitDate.getMinutes()).padStart(2, '0')}`;

            const now = new Date(dateStr + 'T00:00:00').toISOString();

            // Act 1 (first 25 days) belongs to the historical prop account;
            // Acts 2 & 3 belong to the live account.
            const accountId = di < 25 ? String(HIST_ACCOUNT_ID) : String(LIVE_ACCOUNT_ID);
            const accountName = di < 25 ? 'Demo-Prop-SIM' : 'Demo-Live';

            trades.push({
                id,
                userId: DEMO_USER_ID,
                symbol: instrument.symbol,
                assetType: 'futures',
                direction,
                entryDate: dateStr,
                entryTime,
                entryPrice,
                quantity,
                exitDate: dateStr,
                exitTime,
                exitPrice: exitPoints,
                fees,
                multiplier: instrument.multiplier,
                pnl: grossPnl,
                pnlPercent: round2((points / entryPrice) * 100),
                netPnl,
                source: 'tradovate',
                accountId,
                accountName,
                status: 'closed',
                createdAt: now,
                updatedAt: now,
            });

            tradeCounter++;
        }

        // Journal entry on ~half the days
        if (prng() < 0.52) {
            const plan = PRE_MARKET_PLANS[Math.floor(prng() * PRE_MARKET_PLANS.length)];
            const review = POST_MARKET_REVIEWS[Math.floor(prng() * POST_MARKET_REVIEWS.length)];
            const mood = Math.round(between(prng, 2, 5));
            const discipline = phase === 0
                ? Math.round(between(prng, 1, 4))
                : Math.round(between(prng, 2, 5));

            // Rules: more followed in later phases
            const followRate = phase === 0 ? 0.45 : phase === 1 ? 0.65 : 0.82;
            const rulesFollowed = DEFAULT_TRADING_RULES.filter(() => prng() < followRate);

            const numTags = Math.floor(between(prng, 1, 3));
            const tags: string[] = [];
            for (let t = 0; t < numTags; t++) {
                const tag = TAGS_POOL[Math.floor(prng() * TAGS_POOL.length)];
                if (!tags.includes(tag)) tags.push(tag);
            }

            const noteId = `demo_note_${di}`;
            const now = new Date(dateStr + 'T20:00:00').toISOString();
            notes.push({
                id: noteId,
                date: dateStr,
                content: review,
                preMarketPlan: plan,
                postMarketReview: review,
                mood,
                discipline,
                rulesFollowed,
                tags,
                createdAt: now,
                updatedAt: now,
            });
        }
    }

    const liveBalance = computeAccountBalance(trades, String(LIVE_ACCOUNT_ID));
    const histBalance = computeAccountBalance(trades, String(HIST_ACCOUNT_ID));

    const tradingAccounts: StoredTradingAccount[] = [
        {
            accountId: LIVE_ACCOUNT_ID,
            connectionId: 'demo-connection',
            name: 'Demo-Live',
            accountType: 'MARGIN',
            active: true,
            lastBalance: liveBalance,
            balanceUpdatedAt: new Date().toISOString(),
            startingBalance: null,
        },
        {
            accountId: HIST_ACCOUNT_ID,
            connectionId: null,
            name: 'Demo-Prop-SIM',
            accountType: 'CASH',
            active: false,
            lastBalance: histBalance,
            balanceUpdatedAt: new Date(Date.now() - 55 * 86400_000).toISOString(),
            startingBalance: null,
        },
    ];

    const templates: JournalTemplate[] = [
        {
            id: 'demo_tpl_1',
            name: 'Morning Plan',
            type: 'plan',
            content: PLAN_TEMPLATE_CONTENT,
            createdAt: new Date(Date.now() - 60 * 86400_000).toISOString(),
            updatedAt: new Date(Date.now() - 60 * 86400_000).toISOString(),
        },
    ];

    return {
        trades,
        notes,
        rules: [...DEFAULT_TRADING_RULES],
        templates,
        settings: { startingBalance: STARTING_BALANCE, commissionPerContract: COMMISSION_PER_CONTRACT },
        tradingAccounts,
    };
}

function computeAccountBalance(trades: Trade[], accountId: string): number {
    const net = trades
        .filter(t => t.accountId === accountId)
        .reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
    return Math.round((STARTING_BALANCE + net) * 100) / 100;
}
