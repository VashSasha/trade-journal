export type AssetType = 'stock' | 'option' | 'forex' | 'futures' | 'crypto';
export type TradeDirection = 'long' | 'short';
export type TradeStatus = 'open' | 'closed' | 'missed';
export type TradeGrade = 'A' | 'B' | 'C' | 'D';

export interface Trade {
    id: string;
    userId: string;

    // Basic Info
    symbol: string;
    assetType: AssetType;
    direction: TradeDirection;

    // Entry
    entryDate: string; // ISO date string
    entryTime?: string;
    entryPrice: number;
    quantity: number;

    // Exit (optional for open trades)
    exitDate?: string;
    exitTime?: string;
    exitPrice?: number;

    // Fees & Calculations
    fees?: number;
    multiplier?: number;
    pnl?: number;
    pnlPercent?: number;
    netPnl?: number;

    // Strategy & Tags
    setup?: string;
    playbookId?: string;
    tags?: string[];

    // Psychology
    emotions?: string[];

    // Grading
    grade?: TradeGrade;
    mistakes?: string[];
    wentWell?: string;
    toImprove?: string;

    // Integration Fields
    source?: 'manual' | 'tradovate';
    externalId?: string;
    connectionId?: string; // Tradovate connection ID (for multi-account support)
    accountId?: string; // Tradovate account ID
    accountName?: string; // Display name for the account

    // Notes & Media
    notes?: string;
    screenshots?: string[];

    // Status
    status: TradeStatus;

    // Metadata
    createdAt: string;
    updatedAt: string;
}

export interface TradeFormData {
    symbol: string;
    assetType: AssetType;
    direction: TradeDirection;
    entryDate: string;
    entryTime?: string;
    entryPrice: number;
    quantity: number;
    exitDate?: string;
    exitTime?: string;
    exitPrice?: number;
    fees?: number;
    multiplier?: number;
    setup?: string;
    playbookId?: string; // For future detailed strategies

    // Integration Fields
    source?: 'manual' | 'tradovate';
    externalId?: string; // ID from external broker (e.g. Fill ID)
    accountId?: string; // Tradovate account ID
    accountName?: string; // Display name for the account

    status?: TradeStatus; // explicit status override (e.g. 'missed')

    // Metadata
    tags?: string[];
    emotions?: string[];
    notes?: string;

    // Grading
    grade?: TradeGrade;
    mistakes?: string[];
    wentWell?: string;
    toImprove?: string;
}

export interface TradeStats {
    totalTrades: number;
    openTrades: number;
    closedTrades: number;
    totalPnl: number;
    totalPoints: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
}
