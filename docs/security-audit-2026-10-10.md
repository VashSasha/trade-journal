# Pre-release security audit — 2026-10-10

**Status update — 2026-10-11:** the two P1 fixes below are implemented and regression-tested locally, but not deployed. Hold promotion until their staging checks and the remaining P2 release-risk decisions are complete. Review the voice-control boundary before broadly enabling paid voice.

Audit baseline: `release/v1_4_9`, commit `be6abe4`. Read-only application review: authentication, tenant isolation, Supabase policies/RPCs, broker credentials and proxy, AI/voice authorization and usage accounting, Stripe, deletion, rendering, Electron, dependencies, and release workflows. The evidence/line references below describe that baseline. Subsequent local P1 fixes are recorded separately below. No production data or configuration was changed.

This is a source review with local fixtures and limited public-header checks, not a penetration-test certification. Deployed database policies, dashboard-only settings, secrets, WAF rules, and provider behavior were not independently verified.

## Findings, in priority order

### 1. P1 — Broker cache can be reassigned to a different signed-in user

**Remediation: implemented locally, pending deployment.** The existing user-session generation now owns broker state. Authentication and matching cache ownership are required before hydration or renewal; public data is hidden immediately on user changes/local logout. Cache writes bind owner and connection data in one JSON record, in addition to the legacy ownership marker, to reject interleaved cross-tab writes. Unknown-owner legacy credentials are not automatically imported or deleted. Stale cloud reads and token renewals cannot populate the next user's workspace. Same-owner offline recovery and metadata-only cloud persistence remain supported.

**Evidence:** `src/app/core/services/tradovate.service.ts:252`, `:322`, `:350`, `:812`.

`loadConnections()` hydrates cached credentials and immediately schedules renewals before verifying the cache owner. An expired token calls `markConnectionExpired()`, which writes the entire cache and sets its owner to the currently signed-in user. The later ownership check then accepts the relabelled cache.

**Reproduced locally using the actual transpiled service methods:** start with a cache owned by A containing one expired connection and one still-valid connection; restore a session for B before constructing the broker service. Loading the cache changes its owner to B, retains A's second valid token, and a subsequent empty-cloud load queues both connection metadata records under B. No real credentials or network were used.

**Impact:** on a shared browser with stale foreign cache, another user's broker credentials/account metadata can become available in the current workspace. RLS does not prevent this: the client queues copied metadata as the current user's data. This is a conditional same-browser isolation failure, not evidence that unrelated remote users can read arbitrary database rows. Normal successful sign-out clears the broker cache, but that must not be the only protection against stale data.

**Fix:** resolve and validate the authenticated owner before exposing any cached connection, starting timers, or writing cache. Make cache writes conditional on an already-established matching owner; never infer ownership from the current auth session alone. Keep unknown-owner legacy data quarantined for explicit recovery. Clear in-memory connections/timers immediately on owner changes.

**Regression tests:** A→B with mixed expired/live tokens; missing owner; failed sign-out/network loss; delayed auth initialization; cross-tab switch; offline restore. Assert zero foreign token use, zero foreign UI data, and zero foreign metadata writes.

### 2. P1 — Account deletion misses twelve supported custom-sound paths

**Remediation: implemented locally, pending deployment.** `delete-account/storage-cleanup.ts` enumerates the exact verified user's folder through Storage, including pagination, orphaned files, and older nested uploads. It validates paths, bounds traversal/deletion batches, renews the existing billing lock, and checks cleanup before Auth deletion. Storage failure, concurrent uploads, or lock loss retain the account for retry; a specifically missing bucket is safe. Billing cancellation, recent-auth verification, and deletion-pending protections remain unchanged.

**Evidence:** `supabase/functions/delete-account/index.ts:6`, `:29`, `:36`; `supabase/migrations/0038_alert_sound_library.sql:5`.

Deletion removes only `open`, `close`, `target`, and `risk`. Upload policies now permit sixteen types, including `dailyProfit` and `positionOpened`. A local comparison confirmed cleanup covers **4 of 16** supported upload paths.

**Impact:** a user with any of the twelve newer uploads can have subscriptions cancelled and `deletion_pending` set, then fail Auth deletion because their Storage objects remain. Supabase documents that Auth users owning Storage objects cannot be deleted. This is a deterministic source/configuration mismatch; no real account deletion was attempted. [Supabase deletion behavior](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users).

**Fix:** through the Storage API, enumerate and remove every object under the verified user's exact prefix, handling pagination and retry safely. Do not delete a whole bucket or remove Storage metadata with SQL. Preserve the current fail-closed billing behavior and ensure retries complete safely.

**Regression tests:** one fixture for every supported sound type, orphaned upload without a metadata row, partial Storage failure, retry after billing cancellation, missing bucket, and another user's files remaining untouched.

### 3. P2 — Direct Realtime commands are outside the voice configuration guard

**Evidence:** `src/app/features/live-coach/voice/coach-voice.service.ts:105`; `coach-voice/src/index.ts:202` and `:222`.

The browser receives a direct provider data channel. The Worker terminates changed `session.updated` configurations, but does not impose equivalent control over individual responses. Realtime allows client `response.create` instructions/tools and concurrent out-of-band responses without changing the session. [OpenAI Realtime conversation controls](https://developers.openai.com/api/docs/guides/realtime-conversations).

**Evidence level:** a local handler probe confirmed `response.created` is metered but not rejected for configuration overrides, whereas the corresponding `session.updated` change terminates the call. Documentation establishes the separate client response path. A real modified-browser/provider exploit was not executed; the mock is not proof of every provider field's behavior.

**Impact:** a modified authorized client can bypass the intended coaching configuration, and concurrent/overridden generation can overshoot a quota that is charged only when usage arrives. Existing authentication, entitlement checks, one-call coordination, duration limits, and final usage accounting still apply. This is not an unlimited anonymous API-key leak or demonstrated access to another user's data.

**Fix:** explicitly design for an untrusted data-channel client. Use provider-enforced immutable constraints if supported, otherwise mediate generation/control commands through a trusted server boundary. Bound concurrent responses and reserve input/output budget before authorizing work. Add project-level spend/rate controls as a backstop. Merely hiding client buttons or disabling automatic responses does not secure this boundary.

**Regression tests:** per-response overrides, concurrent out-of-band responses, changed transcription settings, large input, cancellation before final usage, and quota exhaustion with work in flight. Keep voice behind a restricted rollout until these controls are verified against the actual provider.

### 4. P2 — Public broker proxy lacks application-level abuse protection

**Evidence:** `tradovate-proxy/worker.js:60`, `:85`, `:95`, `:127`.

The proxy accepts requests without NVZN authentication, restricts only the initial destination domain, has no application rate limiter, and buffers request bodies without a byte limit. The OAuth exchange also reads an unbounded JSON body. Automatic redirects are followed without checking the next destination.

**Impact:** third parties can use the service as a Tradovate relay and consume Worker capacity/upstream limits; oversized requests can exhaust per-isolate memory. The domain allowlist is useful and prevents straightforward arbitrary-host forwarding. Cross-origin credential exposure via redirects is only a conditional concern—not a demonstrated upstream redirect exploit. Wildcard CORS alone is not the vulnerability, and narrowing CORS alone would not stop non-browser abuse.

**Fix:** add application authentication or a scoped short-lived proxy ticket separate from the broker bearer token; apply per-user/IP throttling, allowed methods/paths, body-size and upload-time limits. Revalidate redirects or disable them for credential-bearing calls. Confirm Cloudflare edge rate controls as an additional layer. Do not break the current direct-login request contract during rollout.

### 5. P2 — Browser CSP does not restrict script execution or exfiltration destinations

**Evidence:** `public/_headers:20`; confirmed by a read-only HEAD request to the production `/welcome` page.

The policy contains `object-src`, `base-uri`, and `frame-ancestors`, but no `script-src`, `default-src`, or `connect-src`. It provides useful embedding protections, but does not supply a script/exfiltration allowlist. This matters because Supabase sessions and broker tokens are browser-readable. No working XSS exploit was identified; this is a defense-in-depth gap, not proof of token theft.

**Fix:** inventory actual script, network, image, font, audio, and WebRTC requirements; trial a restrictive policy in report-only mode, then enforce it. Use Angular-compatible nonces/hashes where needed. Test OAuth, charts, rich text, sound uploads and voice before enforcement. Avoid “encrypting” localStorage with a key embedded in the same frontend as a substitute.

### 6. P2 — Locked dependencies have unresolved security advisories

Fresh registry audits of the committed lockfile reported:

| Scope | Critical | High | Moderate | Low | Total |
|---|---:|---:|---:|---:|---:|
| Production-labelled dependencies | 0 | 5 | 2 | 2 | 9 |
| All dependencies, including build/dev | 5 | 46 | 15 | 4 | 70 |

These are affected-package counts, including inherited advisories—not counts of reachable application exploits. Angular is locked at 21.2.15; the framework's published host-binding sanitizer advisory includes that version and identifies patched releases. `lodash-es` 4.17.22 and Quill 2.0.3 also appear in the registry results. [Angular advisory](https://github.com/angular/angular/security/advisories/GHSA-hh8m-fm6v-7cvg), [Lodash advisory](https://github.com/lodash/lodash/security/advisories/GHSA-r5fr-rjxr-66jc).

Reachability matters: this is a client-rendered app; no SSR/hydration usage was found, so SSR-specific advisories are not demonstrated public attack paths. The application did not show direct use of the flagged Lodash template/unset/omit functions. Some production-labelled packages, such as esbuild, are build tooling in practice. The critical findings occur in the development/build graph, which still needs supply-chain triage.

**Fix:** update the Angular package family coherently and triage/update direct and transitive dependencies, then rerun the audit and tests. Do not blindly run a forced audit fix—the suggested Quill change includes a downgrade. Separately verify the Deno/Edge Function dependency graph; the npm audit does not cover every deployed import.

## Release-process gaps and follow-ups

- **No test/security gate in the checked-in deployment workflows.** Both workflows install, build, and publish without running the Angular, database, Edge Function, Worker, or Electron security tests. Add required validation before deployment; confirm protected branches and production approval settings in GitHub. See `.github/workflows/deploy-production.yml:40` and `deploy-preview.yml:48`.
- **Secret-file ignore rules are incomplete.** Root `.gitignore` ignores `.env`, but not `.env.local`, `.env.production`, or most Workers' `.dev.vars`. The voice Worker has its own ignore rule. Add safe exclusions with explicit example-file exceptions and a secret scanner. No matching key patterns were found in tracked files or locally available Git history; that is not an entropy scan or proof that all external secrets are safe.
- **Legacy endpoints/OAuth inventory:** determine whether `ai-proxy` and `discord-exchange` are still deployed/needed; remove unused production exposure through an explicit retirement plan. Before enabling the old Tradovate OAuth callback, add a one-time state binding to the initiating user/tab, expiry/replay checks, and PKCE where supported. The callback currently exchanges a code without validating state, but no completed active linking flow was established in this audit.
- **Verify deployed state:** apply/check migration `0041` and earlier required migrations; compare live grants/RLS with source; confirm private sound storage, webhook signing secret/mode, provider spend limits, Cloudflare WAF/rate rules, Supabase auth redirect allowlist and account protections. Do not disable JWT/RLS checks to work around deployment failures.
- **Operational readiness:** ensure backups/recovery, provider failure alerts, and account-deletion retry monitoring. Reconfirm that previously shared credentials were revoked; do not paste replacement secrets into chat or commit them.

## Controls that checked out in the reviewed code/tests

- AI/voice endpoints verify the Supabase user and server-resolved AI entitlement before paid work.
- Database tests exercised owner isolation, anonymous denial, protected plan/AI overrides, service-only answers, replay uniqueness, and retained trading history.
- Voice admission is per verified user; one active call, durable expiry, heartbeat, token metering/deduplication, and unknown-usage charging are implemented.
- Stripe verifies webhook signatures and maps trusted customer/price records; billing locks and replay protection are tested. Sensitive deletion requires recent authentication.
- Broker tokens are excluded from cloud connection metadata serialization. This does not cure the local-cache finding above.
- Markdown/HTML paths reviewed use sanitization; no direct trust-bypass call was found in the application scan.
- Electron uses context isolation, disabled Node integration, sandboxing, and navigation/path checks.

## Verification performed

- Angular: **101 test files passed; 783 tests passed, 7 todo**.
- Edge Function/shared and voice policy/usage unit tests: **48 passed**.
- Disposable PGlite database suite: passed its migration/RLS/entitlement/billing/history/consent/voice cases. It uses a simulated Auth/Storage environment and does not prove the production schema matches.
- Existing local mock voice-Worker lifecycle/usage suite: passed. No real provider call or microphone was used. An expanded integration-probe variant stalled and was stopped; it is not counted as passing. The separate focused handler probe completed as described above.
- Electron security tests: **2 passed**.
- Focused broker-cache reproduction: confirmed the P1 defect using actual service methods and dummy users/tokens.
- Sound cleanup/schema comparison: confirmed 4/16 path coverage.
- Current-tree and locally available Git-history key-pattern scans: no matches for the scanned patterns; values were not printed.
- Public site/proxy HEAD requests only; no authenticated production queries, load tests, charges, deletion, or exploitation attempts.
- `git diff --check`: passed before report creation. No production build was run.

## Promotion checklist

1. Deploy and staging-verify the local fixes for findings 1–2; see the verification/rollout notes below.
2. Resolve or explicitly restrict the voice-control boundary; verify adversarial cases against a separate provider test project with a small spend cap.
3. Add proxy abuse limits; update/triage security dependencies and gate deployment on tests.
4. Roll out CSP safely and close the secret-file/deployed-configuration checks.
5. Smoke-test signup/login, cross-user switching, both paid tiers, broker sync with historical accounts, voice quota/error UI, and deletion with new custom sounds in staging.
6. Promote only after documented acceptance of any remaining P2 risks and a tested rollback plan.

## P1 fix verification and rollout — 2026-10-11

- Angular: **102 files passed; 795 tests passed, 7 todo**, including 12 new broker isolation regressions covering delayed authentication, foreign/missing owners, atomic cache binding, offline restore, cross-tab switch, local logout, and late token renewal.
- Edge/shared/voice policy tests: **56 passed**, including 8 new deletion tests covering all 16 supported sound types, orphan/nested files, multiple pages, partial cleanup/retry, missing bucket, path isolation, concurrent upload, lock loss, and Auth failure.
- Disposable database migration/security suite: **passed**. No live database, broker, payment, or storage mutations were used.
- `git diff --check`: passed. No production build/deployment, commit, or push performed.
- **No SQL migration required.** Deploy the frontend through the normal release flow and redeploy `delete-account` from the repository root:

  ```bash
  npx supabase functions deploy delete-account --project-ref elbcjsewyqptrckdydha
  ```

- In staging, verify a same-owner reconnect/offline restore and a shared-browser A→B switch. Using disposable test users and test billing only, verify deletion with newer sound types and an interrupted cleanup retry; verify another user's uploads remain intact. Automated Storage mocks do not prove live provider behavior.
- The remaining P2 findings and release-process gaps have **not** been fixed by this slice. Trading accounts, trades, and connections are not deleted on logout or broker disconnect by these changes.
