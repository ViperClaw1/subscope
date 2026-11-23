# Self-review

## Decisions

**Client-side sniff is a byte-exact port of the server's rule.** `src/files/sniff.ts` mirrors `format()` in the mock:
`%PDF-` prefix, or the first 24 bytes with `\r` removed starting with `date,description,amount\n`. Implemented on bytes,
not with `TextDecoder` (which strips a BOM by default and is not guaranteed on Hermes). Tested on every fixture plus CRLF
and BOM. Rejecting before the POST means a 415 from the server is treated as a bug, not a normal path.
The format is decided by content, and the extension must agree with it — conservative: a real PDF named `.csv` is rejected.

**The idempotency key is on disk before the first byte is sent.** `ImportCore.start` awaits the AsyncStorage write, then
uploads. A test asserts the order and that the persisted key equals the header.

**No automatic POST after a relaunch.** An operation found in `uploading`/`unknown` is only looked up with
`GET /imports/by-key`. A POST happens again only when the user taps *Retry upload* after by-key answered 404, with the same
key and the same private copy, so it cannot create a second job. A blanket "retry on start" was the main way to get a
duplicate job.

**Revision and the ready result are persisted.** The guard applies only strictly newer revisions; after a delete request
only `deleting`/`deleted`; `deleted` is terminal; responses for another job or a replaced operation are dropped. Because
revision and result survive a restart, `stale_status`'s `processing/2` cannot roll back a `ready/3` after relaunch
either. Ignored responses are recorded for the diagnostics panel.

**"Deleted" means `deleted/5`, nothing earlier.** A DELETE 202 shows *Deleting…*; 503 or no response shows *Deletion not
confirmed* with a retry using the same `deleteKey` (a fresh key per job — reusing one across jobs gives 409). The delete
key is persisted before the request, and a relaunch checks the job to decide between polling and offering the retry.

**Generic `X-File-Name`.** The plan was to percent-encode the real name and truncate it to 255 characters. I send
`import.pdf` / `import.csv` instead: the server only requires a non-empty name, the real one is personal data, and
non-ASCII names in a header make OkHttp throw `IllegalArgumentException` with the name in the message — a crash and a
leak at once. Less data, no encoding code to get wrong.

**Upload streams from disk.** `uploadAsync` (BINARY_CONTENT) sends the private copy without loading it into JS memory;
only 24 bytes are ever read in JS.

**Expo modules first.** `expo-document-picker` instead of `@react-native-documents/picker`: the whole app now runs in
Expo Go, which made iOS testable from a Windows machine without an Apple developer account.

**Diagnostics are compiled out of release builds.** The panel is behind a `require` guarded by `__DEV__ ||
EXPO_PUBLIC_DIAGNOSTICS === '1'` written at the call site (Metro does not fold through an imported constant — the first
attempt leaked `__test/scenario` into the release bundle; CI now greps for it).

**Money and dates without floats or `Intl`.** `1999 + 13200 = 15199` → `151.99`; `lastSeen` is shown as the server's
`YYYY-MM-DD` string (`new Date('2026-10-01')` is Sep 30 west of UTC).

## Simplifications (known ceilings)

- **Oversize files are copied once.** `expo-document-picker` copies before the app sees the size, so a > 10 MiB file is
  copied, rejected and deleted. Never uploaded. Fix if it matters: `copyToCacheDirectory: false` and stat the source URI.
- **CRLF / BOM CSVs are rejected**, following the server. A friendlier client would normalise, but the server would then
  reject the bytes anyway.
- **No sha256 re-check of the copy before a retry.** The copy lives in the app's private cache, so nothing else can
  change it between attempts.
- **Orphan sweep covers `cache/imports/` only.** A crash between picking and the move leaves the picker's own cache copy
  for the OS to evict.
- **Coverage gate is lines 95 % / branches 85 %** (currently ~98 % / ~85.7 %, a thin margin). The untested branches are the "operation was
  replaced while this request was in flight" guards after each await; one test covers the scenario end to end.
- **404 during a delete ends in its own terminal state, `gone`** ("Import no longer on the server … Deletion was not
  confirmed"), never "deleted": only `deleted/5` is a confirmation. Without a terminal state a reset mock left the app
  stuck, because no new import is allowed while a delete is pending.
- **Base URL override** lives in memory only.
- **One operation at a time.** A new import is allowed once the previous one is ready, failed or deleted; starting one
  while a previous result is still on the server does not delete it.
- **No automated end-to-end test on an emulator.** The system file picker is unreliable to drive in CI (Maestro), so the
  device scenarios are done by hand.

## Use of AI

I used Claude Code (an AI coding assistant; `AGENTS.md` holds its project instructions) for drafting code, tests, the CI
workflow and these documents. What I checked myself rather than taking on trust:

- Read every change to `src/core/` and `src/files/sniff.ts` against the kit's README and `mock-server.mjs`, the source of
  truth for statuses, revisions and the format rule.
- The integration tests run against the kit's own `createMockServer` and assert exact `stats` deltas
  (`createRequests`, `newJobs`), so a passing test means the mock really saw one POST, not that a stub agreed.
- Ran the scenarios by hand on a device (Android development build; iOS so far in Expo Go only, see README › Status)
  and watched the diagnostics panel's `stats` and ignored-response line.
- CI failures were reproduced from the logs and fixed one at a time (see the `fix(CI)` commits), not silenced.
- Corrected AI mistakes found on review: e.g. a 404 during delete was first shown as "deleted", and the README first
  marked an Expo Go run as a verified iOS build.

## What I would check next

- The full scenario list on both platforms with the largest system font and a small screen (iPhone SE / small AVD).
- The 5 scenarios on a native iOS build (sideloaded CI `.ipa`, README › iOS on a device without a Mac), including
  whether ATS `NSAllowsLocalNetworking` lets requests to a bare LAN IP through.
