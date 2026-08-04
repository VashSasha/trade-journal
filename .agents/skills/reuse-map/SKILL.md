---
name: reuse-map
description: Complete map of existing utils, components, and services to reuse. Load before writing any new logic to check if it already exists.
---

# What Already Exists — Check Before Building

## Computations (core/utils/trade-stats.utils.ts)
| Need | Use |
|------|-----|
| Daily stats (P&L, win rate, avg win/loss) | `computeDayStats(trades)` |
| Equity curve data for charting | `buildEquityCurve(trades)` |
| DayStats type | import from trade-stats.utils.ts |
| EquityCurve type | import from trade-stats.utils.ts |

Never reimplement these. If the output shape doesn't fit, extend the util — don't duplicate.

## Market / Calendar (core/utils/market-holidays.ts)
| Need | Use |
|------|-----|
| Is this date a weekend or US holiday? | `isMarketClosed(date)` |

## Journal Utils (features/journal/daily-journal/utils/)
| Need | Use |
|------|-----|
| Build a timeline entry | `buildTimelineEntry()` |
| Group timeline entries by month | `groupEntriesByMonth()` |
| Strip HTML from rich text | `stripHtml()` |
| Quill toolbar config (full) | `QUILL_FULL_MODULES` |
| Quill toolbar config (compact) | `QUILL_COMPACT_MODULES` |

## Shared Components (shared/components/)
| Need | Use |
|------|-----|
| Any equity curve chart | `<app-equity-curve-chart>` — NEVER new Chart() |
| Any trade list | `<app-trade-table>` |
| Any rich text editor | `<app-rich-editor>` — NEVER ngx-quill directly |
| P&L share card | `<app-share-pnl>` |

## Services — Who Owns What State
| Data | Service |
|------|---------|
| Trades (CRUD, stats, persistence) | `TradeService` |
| Filtered trade views | `FilterService` — use `filterTrades()` or `filterTradesIgnoreDateRange()` |
| Account starting balance | `AccountSettingsService` |
| Light/dark theme | `ThemeService` |
| Sidebar collapsed | `LayoutService` |
| Tradovate sync + FIFO matching | `SyncService` |
| Tradovate OAuth + API | `TradovateService` |
| AI analysis | `OpenAIService` |
| Daily journal notes | `DailyJournalService` |
| Economic events | `EconomicCalendarService` |

## FilterService — Which Method to Use
- `filterTrades()` → respects all active filters including date range. Use for most views.
- `filterTradesIgnoreDateRange()` → skips date range filter. Use for: calendar heatmap, any component that manages its own date navigation.

## localStorage — Do Not Access Directly
All localStorage is owned by services. Never call localStorage.getItem/setItem directly in a component.
| Key | Owner |
|------|---------|
| trades | TradeService |
| theme | ThemeService |
| layout | LayoutService |
| accountSettings | AccountSettingsService |
| journal:* | DailyJournalService |