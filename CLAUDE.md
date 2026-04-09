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
| `market-holidays.ts` | `isMarketClosed(date)` — returns true for weekends and US market holidays |
| `economic-events.ts` | Static economic event data used by `EconomicCalendarService` |

### Journal Utilities (`src/app/features/journal/daily-journal/utils/`)

| File | Exports |
|---|---|
| `timeline.utils.ts` | `buildTimelineEntry()`, `groupEntriesByMonth()`, `stripHtml()` |
| `quill-modules.ts` | `QUILL_FULL_MODULES`, `QUILL_COMPACT_MODULES` |

**Always check these utilities before writing new computation logic.**

### Shared Components (`src/app/shared/components/`)

| Component | Purpose |
|---|---|
| `EquityCurveChartComponent` | Reusable Chart.js equity curve with split green/red fill at baseline, segment coloring, dashed baseline line |
| `TradeTableComponent` | Trade list table |
| `RichEditorComponent` | Quill-based rich text editor with floating selection toolbar (bold/italic/highlight/link) |
| `SharePnlComponent` | P&L share card generator |

**Use `EquityCurveChartComponent` for all equity curve charts — do not create new Chart.js instances for this purpose.**
**Use `RichEditorComponent` for all Quill rich text inputs — do not instantiate `ngx-quill` directly.**

### Feature Modules (`src/app/features/`)

All routes are lazy-loaded. The main authenticated shell is `MainLayoutComponent` → sidebar + header + `<router-outlet>`.

Route access is controlled by two guards:
- `authGuard` — requires login
- `planGuard('premium')` / `planGuard('lifetime')` — gates analytics (premium) and AI reports (lifetime)

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

`FilterService` has two filtering methods: `filterTrades()` (respects all filters including date range) and `filterTradesIgnoreDateRange()` (skips date range — use this for components that manage their own date navigation, like the calendar heatmap).

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

### Component architecture — modular widget system
Every page section must be built as a **self-contained standalone component** that could be shown, hidden, or reordered independently. This is a hard architectural requirement — not a nice-to-have — because the roadmap includes letting users configure their own page layouts (add/remove/reorder sections).

Rules:
- Each section has its own inputs, internal state, and styles — no reliance on sibling or parent components
- Do not embed logic that only makes sense in one fixed position on a page
- State that a section needs must come in via `@Input()` or injected services — never read from a parent's template variables
- A section component must be independently renderable (drop it anywhere and it works)
- When adding a new section to any page, treat it as a future widget: could a user choose to hide this? If yes, it must be self-contained

What this does NOT mean yet:
- No drag-and-drop required now
- No settings UI for layout configuration yet
- No widget registry yet

Just keep the architecture clean so adding that layer later is straightforward.

### Do not
- Use `@apply` in SCSS
- Use Tailwind classes in HTML templates
- Create Chart.js instances directly for equity curves — use `EquityCurveChartComponent`
- Duplicate logic that exists in `core/utils/`
- Skip `npm run build` verification after changes