# Feature Ideas — Competitor Research

Captured from walking through competitor products. **Nothing here is committed
or prioritized yet** — this is a parking lot to review and rank later.

Sources: [TradeZella](https://www.tradezella.com/) (paid, $26–74/mo),
[TraderWaves](https://traderwaves.com/) (free tier, MT4/MT5-focused).

---

## 1. Onboarding & first-run experience

### Onboarding questionnaire (TradeZella)
Six sequential questions after signup, before the paywall:
1. How long have you been trading? (Newbie <1y / 1–3y / 3–5y / Monk Mode 5+y)
2. What do you use to trade? (Personal capital / Prop firm account / Haven't started)
3. Who is your primary broker? (single-select dropdown)
4. What are you currently trading? (stocks, options, forex, crypto, futures, CFD, other)
5. What are you looking to do with the product? (journal / analyze / backtest / learn)
6. How did you hear about us? (Google, AI tools, X, Instagram, TikTok, YouTube,
   Reddit, community/mentorship, friend, other)

Progress bar across the top; social proof strip pinned to the footer of every
step (reviews, active traders, trades journaled).

**Notes for NVZN:** 6 steps is a lot of friction for a product without
TradeZella's brand recognition. Questions worth keeping are the ones whose
answers actually *do* something:
- experience level → real input for the AI coach's tone/depth
- personal vs prop → we already treat prop/eval accounts differently
- primary broker → roadmap signal for which broker to integrate second
- attribution → we have genuinely distinct channels (Whop/Discord vs direct)

### "Your workspace is ready" modal (TraderWaves)
Post-onboarding modal with three actions, in descending commitment:
- **Connect Trading Account** (primary)
- **Explore Demo Data** (secondary)
- **Skip for now** (tertiary, text-only)

### Demo workspace mode (TraderWaves) ⭐
A fully populated demo dataset the user can explore before connecting anything,
with a persistent banner: *"Demo workspace — you are currently viewing demo
data"* + a **Connect Trading Account** CTA on the right.

**Why this matters for us:** solves two problems at once — (a) a new user's real
dashboard is empty and unconvincing, and (b) our landing page now leads on AI
coaching, but a prospect can't sample it. A demo workspace lets someone *use*
the AI coach on demo trades before paying. Compare with TradeZella's opposite
approach below.

### Hard paywall over a screenshot (TradeZella)
After onboarding, a pricing modal sits over what looks like a dashboard but is
actually a **static screenshot** — so deleting the modal in devtools reveals
nothing usable. No free tier at all; the product is unusable without paying.

**Two lessons:** (1) the screenshot is as much marketing as anti-tampering — it
shows a *populated* dashboard instead of the new user's empty one; (2) client-
side hiding is theater, and we already do the real version (Edge Function plan
gate + RLS). Also a market signal: traders will pay upfront for a journal.

---

## 2. Dashboard widgets

Everything here composes with the existing widget architecture rule in
CLAUDE.md (each section self-contained, hideable, reorderable).

### Trading sessions widget (TraderWaves) ⭐
Header dropdown showing a 24h timeline with a bar per session (Sydney, Tokyo,
London, New York), current-time marker, live clock, and a plain-English status
line: *"Sydney closes in 5h 19m. London opens in 6h 19m."*

**Sasha's note:** wants this, but scoped to **NY and Asia sessions only**.
Ties into our existing session-date logic (`tradeSessionDateStr`, 5pm CME roll).

### Yearly performance grid (TraderWaves)
Rows = years, columns = months, cells = P&L + trade count, with a YTD column at
the end. Colored green/red per month. Very compact way to show multi-year history.

### Daily WR gauge (TraderWaves)
Radial gauge showing daily win rate with the underlying day count in the center.

### Net Daily P&L bar chart (TraderWaves)
Dense green/red vertical bars over a long time range with a zero baseline —
reads like a heartbeat of the account. Scales well to hundreds of days.

### Avg Day Win / Avg Day Loss (TraderWaves)
Single horizontal split bar (blue vs red) with the ratio as a big number.

### Trade Distribution (TraderWaves)
Bar chart with toggles: Period (Hourly / Daily) × Time (Entry / Exit), and a
mode dropdown (Wins vs Losses). Directly relevant to the AI coach — this is the
"what time of day do you actually lose money" view.

### Winstreak (TraderWaves)
Consecutive win streak in both days and trades, each with best/worst badges.

### Calendar with weekly totals (TraderWaves)
Month grid like ours, but with an extra right-hand **Total** column summing each
week's P&L and % — plus a header strip of month totals (trades / wins / profits /
percent). Our calendar has no weekly rollup today.

### Additional metrics seen (TraderWaves)
Grouped into labeled sections in one panel:
- **Risk:** Max Balance Drawdown, Max Equity Drawdown, Current Equity,
  Current Balance, Highest Balance
- **Capital Flows:** Deposits/Withdrawals, Commissions & Swap, Total Lots
- **Statistics:** Profit Factor, Expectancy, Standard Deviation, Sharpe Ratio
- **Trade Stats:** Win rate, Profit Factor, Avg Win/Avg Loss, Avg Trade Duration
- **Symbols Traded** count widget

Max drawdown and expectancy are the notable gaps vs what we compute today.

---

## 3. Structural / navigation

### Boards (TraderWaves) ⭐
Dashboard has **tabs**: Metrics, Calendar, News, plus user-created boards
(`+` to create, pencil to edit). This is exactly the configurable-layout
roadmap already described in CLAUDE.md — worth studying as the reference
implementation of the end state we're building toward.

### Accounts page (TraderWaves) ⭐
Dedicated page listing every connected account in a table: Name, Number,
Server, Type, Platform (with logo), Balance, Connection type, Last Sync, and
row actions (re-sync / share / delete). Header shows `0/3` account quota,
**Add Account**, and **Sync All**.

**Sasha's note:** wants this. Pairs directly with the `trading_accounts` table
and historical-account work — this is the natural home for account metadata,
last-known balances, and per-account sync status.

### Account switcher in header (TraderWaves)
Active account name + dropdown in the page header, with broker name and
"Synced X minutes ago" underneath, plus a **Sync now** action inline.

### Other nav observations
- Sidebar grouped by section: Workspace / Intelligence / Markets / Network / Tools
- `Pro` badges on gated nav items (Wave AI, Backtest, Alerts, Portfolios) —
  gated features stay *visible* to advertise the upgrade
- Discord + mobile app icons pinned to the sidebar footer, with version number
- Header utilities: timezone/session picker, theme palette picker, fullscreen toggle

---

## 4. Calculators (TraderWaves) ⭐

Dedicated `Calculators` section in the sidebar, with a horizontal tab bar of
individual calculators: **Monte Carlo, Position Size, Risk/Reward, Profit,
Pip Value, Margin, Drawdown** (list scrolls — more beyond).

Anatomy of the Position Size calculator, which is the pattern for all of them:
- **Mode tabs** at the top — `Risk %` / `Risk $` / `Lots / balance` — the same
  calculation approached from whichever variable the trader knows.
- **Inputs:** Account balance, Risk percent, Stop loss (pips), Pip value per lot,
  plus optional Spread and Commission per lot for an "all-in" number.
- **Result panel:** Risk amount ($150.00) and Position size (0.50 lots).
- **"How to use"** explainer in prose, with an ⓘ tooltip on *every* term
  (balance, risk %, stop distance, pip value, spread, commission).
- **Worked example** showing the written inputs and the actual arithmetic:
  `Lots = 150.00 / (30 * 10) = 0.50 lots`.

**Adaptation required — this is forex/CFD-shaped, we are futures.** A direct
copy would be wrong for our users. The futures translation:
- pips → **ticks**, lots → **contracts**, pip value per lot → **tick value**
- e.g. MNQ: 0.25 points per tick, $0.50 per tick; ES: 0.25 points, $12.50
- Contracts = risk amount ÷ (stop distance in ticks × tick value)
- Spread is largely irrelevant; **commission per contract** matters and we
  already store a `commissionPerContract` setting

**Our unfair advantage over their version:** TraderWaves makes you type the
account balance in by hand. We already have the real number — `trading_accounts.
last_balance` and the account-size setting (25K/50K/100K/150K) — so the
calculator can **prefill from the selected account**, and the contract
multipliers can come from the symbol data already on synced trades. Same tool,
noticeably less friction.

**Most relevant calculators for the NVZN audience**, given how prop-heavy it is:
Position Size, Risk/Reward, **Drawdown** (maps directly to prop firm daily/max
drawdown rules), and Monte Carlo (expectancy over many trades). Pip Value and
Margin are the least relevant to futures.

Also worth stealing regardless of feature: the **"How to use" + tooltips +
worked example** pattern. It's educational rather than just functional, which
fits the NVZN Trading mission of teaching traders (technicals, psychology, risk).

---

## 5. Bigger features (not near-term, noted for completeness)

- **Backtesting** (both products) — TradeZella's flagship alongside journaling
- **Trade replay** (TradeZella) — bar-by-bar replay of a taken trade
- **Leaderboards / Communities / Reviews** (TraderWaves) — social layer
- **Alerts** (TraderWaves)
- **Prop firm rule tracking** (TradeZella "Prop Firm Sync") — daily drawdown,
  profit targets, consistency rules, pass-rate forecasting. Given the NVZN
  audience is heavily prop-funded, this is probably the highest-value item in
  this section.
- **Mentor mode / Spaces** (TradeZella) — share your journal with a mentor or
  group. Natural fit with the NVZN Discord community angle.

---

## 6. Native charts (TraderWaves) ⭐

Full charting page (`/app/charts`): candlesticks, symbol selector, timeframe
picker, price/time scales, and a complete left-hand **drawing toolbar**
(crosshair, trendline, horizontal lines, brush, text, fib, magnet, lock, hide,
undo, trash). Crucially, **trades are plotted on the chart** — an overlay ticket
chip (`#TICKET_6a7a75041e06a  +$51.68`) with prev/next arrows to step through
trades.

### How it's implemented (inferred — auth-gated, not confirmed from source)
Almost certainly **TradingView Charting Library / "Advanced Charts"**, not
hand-rolled:
- The drawing toolbar is TradingView's, essentially 1:1.
- Network calls map onto TradingView's required **Datafeed API**:
  `symbols` → `searchSymbols`, `symbol-support?symbol=` → `resolveSymbol`,
  `ohlc?symbol=BTCUSD&tf=m5&…` → `getBars`, plus `get-history-symbols`
  and a `heartbeat` xhr for realtime.
- App is Next.js App Router (`_rsc=` query params).

So: TradingView library on the front, their own OHLC API behind it.

### Library options for us
| | Lightweight Charts | Advanced Charts (Charting Library) |
|---|---|---|
| License | Apache 2.0, truly open | Free but **closed source**; apply for access, self-host, attribution required, can't sell the charts *as* the product |
| Size | ~45 KB | Much larger |
| Drawing tools | **None** — candles/lines/areas/markers only | Full toolbar (what TraderWaves shows) |
| Good for | Trade-review charts with entry/exit markers | A real charting product |

### The actual blocker: futures market data, not the library
TraderWaves charts **BTCUSD** — crypto OHLC is free and unlicensed. Our users
trade **MNQ / ES / NQ**, and CME data is licensed and metered: real-time
redistribution means exchange fees and approved-distributor status. Tradovate
provides market data to *its* customers, but redistributing it inside our app is
a separate license we do not have.

**Cheaper path:** a journal mainly needs **historical bars to review a past
trade**, not a live streaming feed. Historical/delayed futures data is far
simpler and cheaper to license (Databento, Polygon.io, Barchart, DXfeed).
"Chart my trade from last Tuesday with entry/exit marked" is achievable;
"live tick chart" is a different business with different costs.

### Why this matters beyond charts
Trades-on-chart is the journal-native use case and unlocks two things already in
this backlog:
1. **Trade Replay** — needs exactly this foundation.
2. **AI chart analysis without the upload step** — today users must screenshot
   TradingView and upload it. With our own bars we could hand the AI the chart
   context directly, removing the clunkiest part of that flow.

---

## 7. Technical observations

- TraderWaves uses **ag-grid** for its tables. Community edition is MIT, but
  many of the nice features (row grouping, pivoting, Excel export, master/detail)
  are **Enterprise and paid per developer**. Worth confirming which tier before
  adopting — our current tables are hand-rolled and dependency-free.
- Both products are dark-theme-first, consistent with where we already are.
- TraderWaves shows a version badge (`v1.9.4`) in the sidebar — cheap trust signal.
