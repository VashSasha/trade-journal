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

Always run `npm run build` after making changes to verify compilation. Never skip this step.

---

## Architecture

A trading journal desktop/web app built with **Angular 21 standalone components** + **Electron 40**. No backend — all data persists to **localStorage**.

### State Management
Uses **Angular Signals** throughout (not NgRx/BehaviorSubjects). `TradeService` is the central state store — its signals drive reactive updates across all components.

### Core Services (`src/app/core/services/`)

| Service | Responsibility |
|---|---|
| `TradeService` | Trade CRUD, stats computation, localStorage persistence |
| `AccountSettingsService` | Starting balance (25K/50K/100K), persisted to localStorage |
| `ThemeService` | Light/dark mode toggle, system preference detection, localStorage |
| `LayoutService` | Sidebar collapsed state, localStorage |
| `SyncService` | Fetches fills from Tradovate Reports API, FIFO matching algorithm |
| `TradovateService` | Tradovate broker OAuth + direct auth, accounts, fills, contracts |
| `FilterService` | Date range / symbol / P&L filtering applied to TradeService signals |
| `OpenAIService` | AI-powered trade analysis and report generation |
| `AuthService` | Mock auth with hardcoded credentials (no real backend) |
| `DailyJournalService` | Saves/loads daily notes from localStorage |
| `EconomicCalendarService` | Economic event data by date |

### Core Utilities (`src/app/core/utils/`)

| File | Exports |
|---|---|
| `trade-stats.utils.ts` | `computeDayStats()`, `buildEquityCurve()`, `DayStats`, `EquityCurve` |
| `timeline.utils.ts` | `buildTimelineEntry()`, `groupEntriesByMonth()`, `stripHtml()` |
| `quill-modules.ts` | `QUILL_FULL_MODULES`, `QUILL_COMPACT_MODULES` |

**Always check these utilities before writing new computation logic.**

### Shared Components (`src/app/shared/components/`)

| Component | Purpose |
|---|---|
| `EquityCurveChartComponent` | Reusable Chart.js equity curve with split green/red fill at baseline, segment coloring, dashed baseline line |
| `TradeTableComponent` | Trade list table |

**Use `EquityCurveChartComponent` for all equity curve charts — do not create new Chart.js instances for this purpose.**

### Feature Modules (`src/app/features/`)

All routes are lazy-loaded. The main authenticated shell is `MainLayoutComponent` → sidebar + header + `<router-outlet>`.

#### Journal (`src/app/features/journal/daily-journal/`)

Scoped state pattern — each domain is its own `@Injectable()` class listed in the component's `providers` array:

| State class | Owns |
|---|---|
| `JournalFormState` | Date nav, form signals, save, mood/discipline, isDirty tracking |
| `JournalNewsState` | Economic news events, custom events |
| `JournalRulesState` | Rules checklist management |
| `JournalTemplatesState` | Template panel, dropdowns, create/edit/delete |
| `JournalTagsState` | Tags input, autocomplete, sidebar filter, timeline filtering |

### Key Data Flow

1. Dashboard loads → fetches Tradovate accounts/balances
2. `SyncService.syncFromTradovate()` pulls historical fills via Reports API
3. Fills matched into complete trades via **FIFO algorithm** in `SyncService`
4. Resulting trades stored in `TradeService` signal + localStorage
5. `FilterService` applies filters reactively for display

### Tradovate Integration

`TradovateService` supports both OAuth flow (callback at `/integrations/callback`) and direct credential auth. The Reports API returns CSV-like data; see `TEST_TRADOVATE_REPORT.md` for known JSON parsing issues with that API.

### Electron

`electron/main.js` runs the Electron main process. In dev it loads from the Angular dev server; in production it loads from `dist/`. `contextIsolation` is enabled and `nodeIntegration` is disabled. GPU acceleration flags are set via `app.commandLine` for performance.

---

## Coding Rules

### Styling — NO TAILWIND
**Never use Tailwind utility classes in new code.** Write plain SCSS only.
- Use CSS custom properties defined in `src/styles.scss` (`:root` / `:root.dark`)
- All theme-aware colors must use `var(--color-*)` tokens — never hardcode light/dark colors in component SCSS
- Use BEM-style class naming (`.block__element--modifier`)
- `@media` breakpoints directly in component SCSS for responsive layout

Available CSS variables:
```
--color-bg-base          --color-bg-surface
--color-bg-surface-2     --color-bg-surface-3
--color-border           --color-text-primary
--color-text-secondary   --color-text-muted
--color-accent           --color-accent-hover
--color-accent-subtle
```

### Angular patterns
- Use `inject()` function — never constructor injection
- Use `signal()` / `computed()` / `effect()` — never BehaviorSubjects or NgRx
- Standalone components only — no NgModules
- Scoped state classes: `@Injectable()` without `providedIn`, listed in component `providers`
- `providedIn: 'root'` only for truly global services

### Component architecture
- Each page section must be a **self-contained standalone component** — own inputs, state, styles
- No hard coupling between sibling components
- Design every section as a potential widget (future: user-configurable page layout)
- Reuse shared utilities and components before creating new ones

### Do not
- Use `@apply` in SCSS
- Use Tailwind classes in HTML templates
- Create Chart.js instances directly for equity curves — use `EquityCurveChartComponent`
- Duplicate logic that exists in `core/utils/`
- Skip `npm run build` verification after changes