import { Trade } from '../models/trade.model';

export interface DayStats {
    totalTrades: number;
    netPnl: number;
    grossPnl: number;
    commissions: number;
    winners: number;
    losers: number;
    breakeven: number;
    winRate: number;
    totalVolume: number;
    avgNetPnl: number;
}

export interface EquityCurve {
    labels: string[];
    values: number[];
}

export function computeDayStats(trades: Trade[]): DayStats {
    const closed = trades.filter(t => t.status === 'closed');
    const netPnl = closed.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const commissions = closed.reduce((sum, t) => sum + (t.fees ?? 0), 0);
    const totalVolume = closed.reduce((sum, t) => sum + (t.quantity ?? 0), 0);
    const winners = closed.filter(t => (t.netPnl ?? t.pnl ?? 0) > 0).length;
    const losers = closed.filter(t => (t.netPnl ?? t.pnl ?? 0) < 0).length;
    const breakeven = closed.length - winners - losers;
    const winRate = closed.length > 0 ? (winners / closed.length) * 100 : 0;
    const avgNetPnl = closed.length > 0 ? netPnl / closed.length : 0;
    return { totalTrades: closed.length, netPnl, grossPnl, commissions, winners, losers, breakeven, winRate, totalVolume, avgNetPnl };
}

export function buildEquityCurve(trades: Trade[], startingBalance = 0): EquityCurve {
    const sorted = [...trades]
        .filter(t => t.status === 'closed')
        .sort((a, b) => {
            const aKey = `${a.entryDate}T${a.entryTime ?? '00:00'}`;
            const bKey = `${b.entryDate}T${b.entryTime ?? '00:00'}`;
            return aKey.localeCompare(bKey);
        });

    const labels: string[] = ['Start'];
    const values: number[] = [startingBalance];
    let cumulative = startingBalance;

    sorted.forEach((t, i) => {
        cumulative += (t.netPnl ?? t.pnl ?? 0);
        labels.push(t.entryTime ? t.entryTime.substring(0, 5) : `#${i + 1}`);
        values.push(Math.round(cumulative * 100) / 100);
    });

    return { labels, values };
}