# Alert sound library

Ten owner-supplied MP3 files are shipped as public assets in
`public/sounds/library-v1/`. The catalog lives in the alerts feature's
`alert-sound-library.ts`. Every clip can be selected for every sound trigger;
the catalog itself has no paid-plan restriction (broker monitoring still uses
the existing broker entitlement). The picker separates Preview from Select;
auditioning a clip never changes the saved choice. Upload remains available.

Apply `supabase/migrations/0038_alert_sound_library.sql` before releasing the
frontend. No Edge Function deployment is required. The existing owner-scoped
session preference RPC stores selections in `user_settings.prefs.session_sounds`.
An absent selection preserves the legacy uploaded-sound/default behavior.
Selecting a preset or the default does not remove private uploads.

Only selected presets are fetched when audio is activated. Decoded sounds are
reused for the active audio context. Failed downloads use the synthesized bell;
Preview retries. Master mute, volume, multi-tab ownership, and browser gesture
requirements still apply. No AI service is used.

## Triggers

- Session opening and closing (for tracked reference sessions).
- Daily/weekly profit and loss thresholds, completed-trade limit, and daily
  target including open P&L. These still require the corresponding guardrail
  to be enabled. Simultaneous guardrails keep one cue, prioritizing risk.
- Upcoming economic events, using the existing reminder lead time.
- Positions opened, increased, reduced, closed, or reversed: silent by default.
  Selecting a cue opts into the existing normalized WebSocket stream; account
  filters and broker access still apply. Matching copy-trade events within
  900ms are coalesced, not replayed per account. No old events are replayed on
  reconnect, unmute, account changes, or sound-setting changes.

The settings and picker are flat lists, without a separate Default cues section.
Legacy target/warning choices still work internally: each trigger displays its
resolved sound, and shared uploads remain selectable as Previous upload. No
existing files or preferences are deleted or rewritten. Any trigger can be silent.

These cues are independent of Coach voice and do not call AI or place orders.
Migration 0038 also extends private-upload metadata/storage allowlists to the
new trigger IDs, without changing owner isolation or removing existing files.

Tests: `npm test -- --watch=false`; `scripts/test-sound-library.ts` exercises the
migration in disposable Postgres including owner isolation and old clients.

## Assets and release checks

Files were provided by the project owner from Downloads, without modification:

| Asset | Original filename |
|---|---|
| happy-whistle.mp3 | Happy Whistle Sound Effect.mp3 |
| hell-yeah.mp3 | hell_yeah.mp3 |
| oh-no.mp3 | Oh No Cringe Sound.mp3 |
| stock-market-bell.mp3 | stock_market_bell.mp3 |
| thinkorswim-bell.mp3 | Thinkorswim Bell.mp3 |
| come-on-man.mp3 | Come On Man Female Voice.mp3 |
| no-more-running.mp3 | Demon Voice No More Running.mp3 |
| demonic-laughter.mp3 | Demonic Laughter Voice Effect.mp3 |
| female-voice.mp3 | Female Voice Sound Effects.mp3 |
| game-over.mp3 | Game Over Deep Male Voice Clip.mp3 |

Redistribution licenses/attribution were not provided: the owner must verify
permission to distribute these publicly before release. Names identify the
supplied clips and do not imply any third-party endorsement.

Before release, preview each clip for content and comfortable relative loudness.
Use a new versioned asset path if replacing a file. Verify on a second browser
that selected presets restore after login without re-uploading anything.
