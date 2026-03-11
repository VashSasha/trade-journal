# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Angular dev server
npm run electron:dev   # Angular dev server + Electron (concurrent)
npm run build          # Production web build
npm run electron:build # Production Electron build (macOS)
npm test               # Run tests with Vitest
```

## Architecture

A trading journal desktop/web app built with **Angular 21 standalone components** + **Electron 40**. No backend — all data persists to **localStorage**.

### State Management
Uses **Angular Signals** throughout (not NgRx/BehaviorSubjects). `TradeService` is the central state store — its signals drive reactive updates across all components.

### Core Services (`src/app/core/services/`)

| Service | Responsibility |
|---|---|
| `TradeService` | Trade CRUD, stats computation, localStorage persistence |
| `SyncService` | Fetches fills from Tradovate Reports API, runs FIFO matching algorithm to construct trades |
| `TradovateService` | Tradovate broker OAuth + direct auth, accounts, fills, contracts |
| `FilterService` | Date range / symbol / P&L filtering applied to TradeService signals |
| `OpenAIService` | AI-powered trade analysis and report generation |
| `AuthService` | Mock auth with hardcoded credentials (no real backend) |

### Feature Modules (`src/app/features/`)

All routes are lazy-loaded. The main authenticated shell is `MainLayoutComponent` which wraps `dashboard`, `journal`, `analytics`, `reports`, and `settings/integrations`.

### Key Data Flow

1. Dashboard loads → fetches Tradovate accounts/balances
2. `SyncService.syncFromTradovate()` pulls historical fills via Reports API
3. Fills matched into complete trades via **FIFO algorithm** in `SyncService`
4. Resulting trades stored in `TradeService` signal + localStorage
5. `FilterService` applies filters reactively for display

### Tradovate Integration

`TradovateService` supports both OAuth flow (callback at `/integrations/callback`) and direct credential auth. The Reports API returns CSV-like data; see `TEST_TRADOVATE_REPORT.md` for known JSON parsing issues with that API.

### Electron

`electron/main.js` runs the Electron main process. In dev it loads from the Angular dev server; in production it loads from `dist/`. `contextIsolation` is enabled and `nodeIntegration` is disabled.