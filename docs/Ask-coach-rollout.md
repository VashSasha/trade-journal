# Ask Coach rollout

The floating Coach opens as one chat: live observations and typed exchanges share a chronological timeline. A user can send the first message without waiting for an observation or connecting a broker. New answers require Premium+ or an individual AI grant; saved conversations remain readable/deletable after downgrade. Secondary controls, saved chats and observation history live in the actions menu. Expand/shrink does not reset a draft or change coaching preferences.

The menu's **Automatic coaching** toggle controls unsolicited live updates, not manual chat. **Voice playback** lives in Coach settings alongside the voice selection and also controls Read summary. The widget and full alert settings share the same voice control and saved preferences. Master sound still overrides all voice playback.

## Deploy in order

1. Apply `0034_coach_conversations.sql` to the target Supabase project. Apply `0033_live_coach_history.sql` too if the preceding saved-observation feature has not been deployed. Both are rerunnable. Neither changes trades, broker connections, billing, or plans.
2. From the repository root, deploy `ai-report` to that project. Its shared validation/prompt imports are included automatically.
3. Deploy the frontend. No new secrets, subscriptions, or sound permissions are required.

## Behavior and limits

- Suggested starters populate a draft; only **Send message** requests AI. Replies never autoplay. **Read summary** is an explicit, optional action using the existing voice settings; live alerts take priority.
- Each send captures its selected trading day and the current header account selection. Other dashboard filters do not apply. Only completed saved trades owned by the current user are summarized. Copied trades include an estimated decision count. No usable summary means general planning, not proof of no trading.
- **Reply** on a live observation attaches its original captured context to your next message. Selecting Reply never requests AI or plays audio. The client waits for the original observation to save; the server resolves its ID for the authenticated owner and revalidates its snapshot before spending quota. Forged observation text/snapshots from a request are discarded. The quote and snapshot persist with the completed exchange, so follow-ups can refer to them even after newer events arrive.
- This is captured-context coaching, not continuously refreshed position monitoring inside the chat. The AI receives message text, aggregate context, the observation being replied to (if any), and the latest six completed exchanges. It does not receive broker credentials, account IDs, raw trades, or journal notes through this feature. User-entered text may itself contain private information. Observation timestamps/scopes remain distinct from the selected day's saved-trade summary; historical positions must never be assumed still open.
- Threads retain up to 100 completed exchanges; older exchanges remain viewable but only the latest six are supplied to AI. Start a new conversation at the limit.
- Uses the existing shared 30/day Coach allowance and in-flight/attempt limits, reset at midnight UTC. AI speech costs another request; browser speech does not. The displayed allowance is a last-known value, not a cross-device realtime counter. Opening/reopening/expanding the widget does not read conversations or quota. Saved chats and About & usage load independently when expanded, with a 30-second in-memory cache and explicit Refresh buttons. Concurrent menu reads are deduplicated; failed reads are retryable. Creating/deleting a chat invalidates the list; sending/reading a summary invalidates usage, with the next read deferred until requested. Owner/demo changes clear the cache; usage is never reused across UTC days. Live alerts/other browsers can change usage between reads; the server always enforces the real allowance.
- The server verifies identity and AI entitlement. Only server-generated completed turns are stored; clients cannot forge assistant history. Owner-scoped database policies protect reads/deletes. Client snapshots are explicitly treated as unverified data, not financial authority.
- Retry uses the same message UUID/context. Completed retries return the saved answer without generating it again. Stopping a request stops waiting; it may still finish remotely. Refresh answers before resending or editing as a new message.
- Completed conversations persist across devices; drafts/failed questions remain only in memory. Changing users or entering demo clears private local state. Deleting a conversation removes only its turns. Late responses cannot recreate a deleted conversation.
- Deleting a live observation does not remove its quoted copies in completed chat exchanges. Delete the relevant chat separately if desired. No new migration is needed for observation replies: their snapshots use the existing turn's `context` JSON column. Redeploy `ai-report` for server-side observation lookup.

## Manual smoke test after deployment

- Premium+: send a first question with no trades; verify a concise answer, saved thread, no autoplay.
- Switch accounts/day: verify each answer retains its original context. Test copied accounts without interpreting all executions as separate decisions.
- Open a second browser: retrieve the same completed conversation without using quota or replaying audio.
- In Network, open/close/reopen/resize Coach: no conversation-list or usage requests. Expanding Saved chats or About & usage loads only that menu; reopening it within 30 seconds reuses the result. Refresh bypasses the cache to see another browser's changes.
- Reply to a live update, then change the selected accounts/day and receive another event: the pending reply must retain its original quote and snapshot. Reopen the saved chat and confirm the original observation is still shown once. A missing/deleted original must fail clearly without generating a new answer.
- Simulate a disconnect, then retry/refresh: one saved turn; clear error instead of a stuck spinner.
- Free/downgraded account: saved threads accessible, no new AI. Another user/demo must not see the first user's history.
- Delete explicitly: conversation/turns disappear, trading records and automatic observation history remain.
- Phone and light/dark theme: keyboard, input, date dropdown, actions menu, expand/shrink, scroll, long questions and confirmation remain usable. The date dropdown closes on outside click/focus and Escape. Live updates must not force-scroll while reading older messages. Read summary respects mute and yields to live alerts.

Local verification uses Angular unit tests, Angular template/type checking, Deno helper tests, and disposable in-memory database tests. These do not execute a production migration, send an AI request, or touch a brokerage account.
