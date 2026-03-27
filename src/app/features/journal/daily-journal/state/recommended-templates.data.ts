export interface RecommendedTemplate {
    id: string;
    name: string;
    type: 'plan' | 'notes';
    description: string;
    content: string;
}

export const RECOMMENDED_TEMPLATES: RecommendedTemplate[] = [
    // ── Plan templates (pre-market & post-market) ────────────────
    {
        id: 'rec-morning-prep',
        name: 'Morning Prep Checklist',
        type: 'plan',
        description: 'Pre-market routine covering context, levels & bias',
        content: `<h3>Pre-Market Preparation</h3>
<p><strong>Market Context</strong></p>
<ul>
  <li>Overnight futures direction: </li>
  <li>Key economic events today: </li>
  <li>Earnings / major news: </li>
</ul>
<p><strong>Key Levels</strong></p>
<ul>
  <li>Prior day high: &nbsp;&nbsp;&nbsp;&nbsp; Prior day low: </li>
  <li>Overnight high: &nbsp;&nbsp;&nbsp;&nbsp; Overnight low: </li>
  <li>Key support: </li>
  <li>Key resistance: </li>
  <li>VWAP / POC: </li>
</ul>
<p><strong>Today's Bias</strong></p>
<p>Direction: [Bullish / Bearish / Neutral]</p>
<p>Reason: </p>
<p><strong>Primary Setup to Watch</strong></p>
<ul>
  <li>Instrument: </li>
  <li>Entry trigger: </li>
  <li>Target: </li>
  <li>Stop: </li>
  <li>R/R ratio: </li>
  <li>Max daily loss: $</li>
</ul>
<p><strong>Mindset Check</strong></p>
<ul>
  <li>How am I feeling today? </li>
  <li>Anything to be aware of (fatigue, distraction, news)? </li>
</ul>`
    },
    {
        id: 'rec-trade-execution',
        name: 'Trade Execution Plan',
        type: 'plan',
        description: 'Detailed setup with levels, risk, and entry conditions',
        content: `<h3>Trade Execution Plan</h3>
<p><strong>Setup</strong></p>
<ul>
  <li>Instrument: </li>
  <li>Timeframe: </li>
  <li>Pattern / Setup: </li>
  <li>Direction: [Long / Short]</li>
</ul>
<p><strong>Levels</strong></p>
<ul>
  <li>Entry zone: </li>
  <li>Stop loss: </li>
  <li>Target 1: </li>
  <li>Target 2 (runner): </li>
  <li>R/R: </li>
</ul>
<p><strong>Entry Conditions (all must be met)</strong></p>
<ul>
  <li>Confirmation needed: </li>
  <li>Market internals aligned? </li>
  <li>Invalidation scenario: </li>
</ul>
<p><strong>Risk Management</strong></p>
<ul>
  <li>Position size: &nbsp;contracts / shares</li>
  <li>$ at risk: </li>
  <li>Max loss for today: $</li>
  <li>Scale-out plan: </li>
</ul>
<p><strong>Notes</strong></p>
<p></p>`
    },
    {
        id: 'rec-eod-review',
        name: 'End of Day Review',
        type: 'plan',
        description: 'Post-session recap: P&L, plan adherence, lessons',
        content: `<h3>Post-Market Review</h3>
<p><strong>Session Summary</strong></p>
<ul>
  <li>Net P&amp;L: $</li>
  <li>Number of trades: </li>
  <li>Wins / Losses: &nbsp; / </li>
  <li>Best trade: </li>
  <li>Worst trade: </li>
</ul>
<p><strong>Plan vs. Execution</strong></p>
<ul>
  <li>Did I follow my pre-market plan? [Yes / No / Partially]</li>
  <li>Where did I deviate? </li>
  <li>Was the deviation justified? </li>
</ul>
<p><strong>Emotional State</strong></p>
<ul>
  <li>How did I feel during trading? </li>
  <li>Did emotions affect any decisions? </li>
</ul>
<p><strong>Key Lessons</strong></p>
<ul>
  <li></li>
  <li></li>
</ul>
<p><strong>Tomorrow's Focus</strong></p>
<ul>
  <li>Key levels to watch: </li>
  <li>Adjustments to make: </li>
</ul>`
    },
    // ── Notes templates ──────────────────────────────────────────
    {
        id: 'rec-trade-debrief',
        name: 'Trade Debrief',
        type: 'notes',
        description: 'Analyze a single trade: setup, execution, and takeaways',
        content: `<h3>Trade Debrief</h3>
<p><strong>Trade Details</strong></p>
<ul>
  <li>Instrument: </li>
  <li>Direction: [Long / Short]</li>
  <li>Entry: &nbsp;&nbsp;&nbsp;&nbsp; Exit: </li>
  <li>P&amp;L: $</li>
  <li>Hold time: </li>
</ul>
<p><strong>Setup Quality</strong></p>
<ul>
  <li>What was the setup? </li>
  <li>Was it in my playbook? [Yes / No]</li>
  <li>Setup grade: [A / B / C]</li>
  <li>Did I wait for full confirmation? </li>
</ul>
<p><strong>Execution Quality</strong></p>
<ul>
  <li>Entry execution: [Good / Acceptable / Poor]</li>
  <li>Exit execution: [Good / Acceptable / Poor]</li>
  <li>Did I move my stop? [Yes / No] — if yes, why: </li>
  <li>Did I size correctly? </li>
</ul>
<p><strong>What Went Well</strong></p>
<p></p>
<p><strong>What To Improve</strong></p>
<p></p>`
    },
    {
        id: 'rec-market-observations',
        name: 'Market Observations',
        type: 'notes',
        description: 'Log market conditions, price action, and sector flow',
        content: `<h3>Market Observations</h3>
<p><strong>Overall Market Conditions</strong></p>
<ul>
  <li>Trend: [Trending Up / Trending Down / Ranging / Choppy]</li>
  <li>Volatility: [High / Normal / Low]</li>
  <li>Volume: [Above avg / Average / Below avg]</li>
  <li>Dominant session: [London / NY AM / NY PM / Overnight]</li>
</ul>
<p><strong>Key Price Action</strong></p>
<ul>
  <li>Opening range (first 30 min): </li>
  <li>Notable moves / sweeps: </li>
  <li>Sector rotation observed: </li>
</ul>
<p><strong>Notable Patterns Observed</strong></p>
<ul>
  <li></li>
  <li></li>
</ul>
<p><strong>Market Narrative</strong></p>
<p></p>
<p><strong>Watchlist for Next Session</strong></p>
<ul>
  <li></li>
  <li></li>
</ul>`
    },
    {
        id: 'rec-lessons-learned',
        name: 'Lessons Learned',
        type: 'notes',
        description: 'Document mistakes, root causes, and corrective actions',
        content: `<h3>Lessons Learned</h3>
<p><strong>Mistake / Observation</strong></p>
<p>What happened: </p>
<p>Root cause: </p>
<p><strong>Corrective Action</strong></p>
<p>What I will do differently: </p>
<p>Rule to add or reinforce: </p>
<p><strong>Positive Reinforcement</strong></p>
<p>What worked well that I want to repeat: </p>
<p><strong>Action Items</strong></p>
<ul>
  <li></li>
  <li></li>
</ul>`
    }
];