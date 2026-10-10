# Two-way Coach voice beta

Adds an explicit **Talk to Coach** call to the existing chat. The frontend needs a configured voice backend URL and the Worker must have `VOICE_ENABLED` set to `"true"`. Text chat and automatic commentary still work independently.

## Enable it

Run commands from the repository root. Never put keys in frontend environment files, chat messages, or Git.

1. Apply `supabase/migrations/0041_coach_voice_messages.sql` in Supabase. This adds private transcripts, not audio recordings. Existing trades are untouched. Re-running this migration is safe.
2. Deploy the updated text endpoint so typed follow-ups can read the voice conversation:

   ```sh
   npx supabase functions deploy ai-report --project-ref elbcjsewyqptrckdydha
   ```

3. Provision the new Cloudflare Worker (initially disabled), then set its secrets using the interactive prompts:

   ```sh
   npx wrangler deploy --config coach-voice/wrangler.jsonc
   npx wrangler secret put OPENAI_API_KEY --config coach-voice/wrangler.jsonc
   npx wrangler secret put SB_SECRET_KEY --config coach-voice/wrangler.jsonc
   ```

   `SB_SECRET_KEY` is a Supabase server secret/service-role key, **not** a publishable key. The OpenAI project must have API billing and Realtime access. These are separate Worker secrets; Supabase Edge Function secrets are not automatically shared.

4. Change `VOICE_ENABLED` to the string `"true"` in `coach-voice/wrangler.jsonc`, and deploy this Worker again. Keep that setting in source for future deployments.
5. Set `coachVoiceUrl` in `src/environments/environment.prod.ts` to the HTTPS Worker URL returned by deployment, **without a trailing slash**, then deploy the frontend. An empty URL hides the voice UI. The existing app/preview origins are allowed; other origins require a reviewed allowlist change.
6. Test a real call before announcing availability. No real microphone/OpenAI call is part of the automated checks.

## Local testing

The development frontend currently uses the deployed voice Worker, just like production. Start the website with `npm start` on port 4200; no local voice server is required. Real calls use the deployed Worker's secrets, usage limits and API billing. Changing only `environment.prod.ts` does not affect `npm start`.

To work on the voice backend locally instead, temporarily set `coachVoiceUrl` in `src/environments/environment.ts` to `http://127.0.0.1:8788`. Apply the migration to the Supabase project used by your local app first. Create an ignored `coach-voice/.dev.vars` with `OPENAI_API_KEY` and `SB_SECRET_KEY` (never commit it). From the repository root, run these in separate terminals:

```sh
npx wrangler dev --config coach-voice/wrangler.jsonc --var VOICE_ENABLED:true
npm start
```

Keep the local Worker running on port 8788 while testing this configuration. Port 4200 serves the website, not the voice backend. Use Chrome/Edge initially; verify Safari/iPhone microphone and playback behavior separately. Localhost or HTTPS is required.

## Behavior and limits

- Requires current AI entitlement (Premium+ or an explicit AI grant), verified on the server at start and on heartbeats.
- One call per user across tabs/devices; **50,000 voice tokens per UTC day** by default, **3 minutes per call**, 60-second idle cutoff. There is no daily call-count limit. Starting/failed connection attempts do not themselves consume tokens. A rolling 10-starts-per-minute throttle prevents rapid retry abuse. Text-chat allowance is separate.
- Cedar is the default. Supported Realtime voices reuse the user's selection; other narrator voices fall back to Cedar.
- Microphone opens only after a click. Mute and End are always available during a connected call. Closing the widget, leaving chat, hiding the tab, logout, context/consent/access changes and connection failure stop local audio. No automatic reconnect.
- Selected day/accounts and recent chat history are a **snapshot at call start**, not continuously updated positions. Voice does not place orders or change settings.
- Automatic Coach narration pauses during a call; its saved preference is unchanged. Voice conversation playback is explicitly started, independent of the automatic-alert sound switch.
- OpenAI processes microphone audio. NVZN stores completed text transcripts in the same private conversation. Raw audio is not stored by NVZN. Transcription may be imperfect; interrupted/unplayed Coach replies are omitted conservatively. End-of-call words may not finish transcribing.
- Typed follow-ups after End include recent voice history. A call accepts up to 40 transcript items. A chat holds up to 200 voice items before a new chat is required; existing history remains readable/deletable.
- Deleting the parent chat deletes its transcripts. It never deletes trades or separate Coach observations.
- Realtime audio has separate OpenAI costs and Cloudflare Durable Object usage. This is a bounded beta, not an unlimited voice entitlement.

## Why a separate Worker?

The browser streams audio directly to OpenAI over WebRTC. The Worker authenticates the user and creates the call with a server-side key; no long-lived provider key reaches the browser. A Durable Object per user coordinates admission, observes transcripts through a server-side WebSocket and uses persistent alarms to hang up calls when deadlines/heartbeats expire—even after a browser disappears. Provider errors can delay remote hangup; alarms retry. This avoids relying on a browser timer or a short-lived Edge Function for paid-session cleanup.

Transcripts are written by the server, not accepted from a client upload. A durable outbox retries failed saves and discards retries when the parent/user was deleted. Pending transcript data stays server-side until saved/deleted. If storage fails, the call closes and saved history may arrive later; refresh that chat. No microphone audio, credentials, or transcript content is intentionally logged.

## Voice token allowance

Set `VOICE_DAILY_TOKEN_LIMIT` in `wrangler.jsonc` and redeploy the Worker to tune the allowance (currently `"50000"`). No new Supabase migration is needed for this change. The old three-attempt counter is no longer used; it is not converted into invented token usage.

Only server-side OpenAI events count: `response.done.usage.total_tokens` (including input/context, cached input and output) plus token usage from `conversation.item.input_audio_transcription.completed`. Repeated delivery of the same response/item is counted once. Counts persist per user/UTC date in the existing Durable Object, across calls, browsers and coordinator restarts. Turns that cross midnight count toward the day they started. See [OpenAI Realtime usage documentation](https://developers.openai.com/api/docs/guides/voice-latency-cost?voice-api=realtime#per-response-costs).

Quota errors show in the chat immediately, not after cleanup. The UI receives the remaining allowance and reset time at start, heartbeat, end and quota rejection. When usage exhausts the allowance, the Worker hangs up and rejects further starts until the next UTC day. It is a post-response usage threshold, **not a hard dollar cap**: a response already being generated can take usage over the threshold. Token modalities and cache hits have different prices; calibrate this initial allowance against real costs before advertising it as a paid entitlement.

If a response or committed input is still awaiting usage when the provider connection closes, it reserves 32,768 tokens against that day's allowance rather than counting as free. This conservative reserve is labelled separately in the UI; it is not a claim of actual provider billing. Missing/invalid final usage ends the call. Known final usage (including interrupted/failed responses) is counted as reported. Failed starts before any provider work have no reserve. The deadline, idle and heartbeat safeguards remain in force.

## Verification

```sh
node coach-voice/test-worker.mjs
npx wrangler types --config coach-voice/wrangler.jsonc coach-voice/worker-configuration.d.ts
npx tsc -p coach-voice/tsconfig.json
npx wrangler deploy --dry-run --config coach-voice/wrangler.jsonc
npm test -- --watch=false
```

The Worker integration test uses only local mocked provider/database services; it makes no paid calls. It covers token accounting/deduplication, UTC rollover, mid-call quota messages, legacy call-count removal, interruption reserves and rapid-start throttling. Database/RLS coverage is in `scripts/test-database.ts`; policy tests are in `coach-voice/src/policy.test.ts` and `coach-voice/src/usage.test.ts`.

Before production, test: mic allow/deny and cancellation; interruption and End mid-sentence; Cedar playback; silent/muted idle expiry; blocked autoplay; disconnected network; two tabs; refresh/logout; changed account/day; AI access revoked; same-chat voice → typed follow-up; transcript visibility in another signed-in browser; mobile layout/microphone behavior. Do not claim the live provider path is verified until those checks pass.

## Disable / rollback

Set `VOICE_ENABLED` back to `"false"` and redeploy the Worker. New starts/heartbeats are rejected; End remains available and existing calls expire. Empty the frontend production `coachVoiceUrl` and redeploy to hide the control. Keep the Worker/Durable Object and migration while active calls or transcript retries exist. Do not delete the transcript table to turn voice off; saved chats should remain readable.
