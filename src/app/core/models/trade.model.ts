export type AssetType = 'stock' | 'option' | 'forex' | 'futures' | 'crypto';
export type TradeDirection = 'long' | 'short';
export type TradeStatus = 'open' | 'closed';

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
    pnl?: number;
    pnlPercent?: number;
    netPnl?: number;

    // Strategy & Tags
    setup?: string;
    tags?: string[];

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
    setup?: string;
    tags?: string[];
    notes?: string;
}

export interface TradeStats {
    totalTrades: number;
    openTrades: number;
    closedTrades: number;
    totalPnl: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
}
