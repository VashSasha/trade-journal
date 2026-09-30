# Saved Live Coach history

## Rollout

1. Run `supabase/migrations/0033_live_coach_history.sql` using your usual migration workflow, before deploying the frontend. It is additive and rerunnable; no existing trades, connections, accounts or entitlements are changed.
2. Deploy the frontend. No Edge Function changes or new secrets are required.
3. Open Live Coach → Saved history. New factual/AI comments and completed follow-up answers are automatically saved to the signed-in user's account. Existing browser-session-only history cannot be recovered.

## Behavior

- The live feed still shows the latest 30 comments. Saved history loads in pages of 30, newest first, with an optional trading-day filter and Refresh button for updates from another browser.
- Dates use the captured session's trading day, falling back to the same session-day utility as the journal for guardrails. Displayed times use the viewing browser's timezone.
- Only text and limited captured trading context are saved. No generated audio, authentication tokens, broker credentials or raw broker events are stored.
- Reviewing saved answers never calls AI or plays audio. New follow-ups are still requested from the live feed and keep existing AI access/usage limits. The saved view is read-only apart from explicit deletion; it does not offer new AI requests.
- History stays readable/deletable after a plan downgrade, even when live monitoring is unavailable. Demo mode never reads or writes real history.
- Deleting an observation also deletes its saved answers, after confirmation. No trades, accounts or journal notes are deleted. Pending writes in the current browser are coordinated with deletion; a late follow-up cannot recreate a deleted row.
- Failed saves show a retry notice. Unsaved content is held only in the current tab; closing or refreshing it before a successful retry loses that unsaved copy. No automatic retry storm, localStorage copy, or offline-guarantee claim.
- If the migration is missing, live coaching continues and history reports an error. Run the migration and use Retry saving without refreshing the tab first.

## Verification

- `npm test -- --watch=false`: history mapping, reload, follow-up persistence, retries, pagination, owner/demo changes, delete races, and UI states.
- Existing disposable `scripts/test-database.ts`: migration reruns, owner-only RLS, anonymous denial, immutable captured context, independent follow-up updates, post-downgrade read/delete, and unchanged trades.
- With a test account after migration: receive one real observation, request a follow-up, reopen history in a second browser, filter its trading day, confirm deletion and Refresh the other browser. Reopening must not speak or consume AI credits.
