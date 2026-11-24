# Subscope

[![CI](https://github.com/ViperClaw1/subscope/actions/workflows/ci.yml/badge.svg)](https://github.com/ViperClaw1/subscope/actions/workflows/ci.yml?query=branch%3Amain)

Mobile client for the statement-import assignment: pick a PDF/CSV bank statement, upload it to the local mock API,
show the recurring payments it finds, and delete the data from the server again. Expo SDK 58 / React Native 0.88,
Android and iOS.

```
mobile-engineer-kit/   the supplied kit, byte-for-byte unchanged (checked by app/scripts/verify-kit.mjs)
app/                   the Expo app
  src/core/            import state machine, revision guard, recovery — plain TypeScript, no React Native
  src/files/           picker → private copy → content sniff (sniff.ts is shared with the tests)
  src/transport/       HTTP to the mock (upload streams from disk)
  src/storage/         AsyncStorage persistence of the one import operation
  src/ui/  src/diagnostics/  src/log/
  test/                Vitest: unit + integration against the kit's createMockServer
.github/workflows/ci.yml
```

## Status

- **Android: verified** — Xiaomi POCO C71, Android 15, development build, all 5 scenarios.
- **iOS: verified** — iPhone 13, iOS 18.3.1, native Release build from the CI `ios` job (unsigned `.ipa`, sideloaded with
  a free Apple ID), all 5 scenarios. No Mac was available, so `npx expo run:ios` from a clean checkout was run only in CI
  (simulator build + launch, artifact `ios-simulator-launch`).

Test results: the CI badge above links the runs on `main` (kit, lint/typecheck, unit + integration tests, bundle privacy,
Android release APK, iOS build + simulator launch, docs).

### Videos

All 10 clips (Android ×5, iOS native ×5), the exact commit and its green CI run:
[Release v1.0.0](https://github.com/ViperClaw1/subscope/releases/tag/v1.0.0).

## Clean checkout

Requirements: Node 22 (`.nvmrc`; the kit itself needs ≥ 20), and for native builds JDK 17 + Android SDK, or Xcode on macOS.

```bash
git clone <repo> subscope && cd subscope
cd app && npm ci
npx tsc --noEmit && npx eslint . --max-warnings 0 && npx vitest run
```

`android/` and `ios/` are not committed (Continuous Native Generation); `npx expo prebuild` or `npx expo run:*` creates them
from `app.config.ts`.

## Run the mock

```bash
cd mobile-engineer-kit
npm test                     # the kit's own tests
npm run fixtures:oversize    # creates fixtures/oversize.csv (> 10 MiB, git-ignored)
npm start                    # http://127.0.0.1:8787
```

The kit is used as supplied; nothing in it is edited. For a physical iPhone on the LAN, start it on all interfaces
(`HOST=0.0.0.0 npm start`, PowerShell: `$env:HOST='0.0.0.0'; npm start`) and set the base URL in the app's diagnostics panel.

Switch scenarios (or use the buttons in the diagnostics panel):

```bash
# bash / Git Bash
curl -X POST http://127.0.0.1:8787/__test/scenario -H 'Content-Type: application/json' -d '{"mode":"lost_ack"}'
curl http://127.0.0.1:8787/__test/state
curl -X POST http://127.0.0.1:8787/__test/reset
```

```powershell
# Windows PowerShell (plain `curl` is an alias for Invoke-WebRequest there)
Invoke-RestMethod -Method Post http://127.0.0.1:8787/__test/scenario -ContentType 'application/json' -Body '{"mode":"lost_ack"}'
Invoke-RestMethod http://127.0.0.1:8787/__test/state
Invoke-RestMethod -Method Post http://127.0.0.1:8787/__test/reset
```

## Run the app

```bash
cd app
npx expo start -c            # Expo Go (press s to switch), or a development build
npx expo run:android         # development build on a device/emulator
```

- **Android emulator / USB device:** `adb reverse tcp:8787 tcp:8787`, then the default `http://127.0.0.1:8787` works.
- **iOS simulator:** reaches the host loopback directly.
- **Physical iPhone:** in development the app uses the computer's LAN address that served the bundle (`<ip>:8787`)
  automatically; start the mock with `HOST=0.0.0.0` and allow Local Network access. With `--tunnel`, enter the LAN
  address in the diagnostics panel.
- Other base URL at build time: `EXPO_PUBLIC_MOCK_URL=http://<PC LAN IP>:8787`.

Fixtures onto a device:

```bash
adb push mobile-engineer-kit/fixtures/statement.csv mobile-engineer-kit/fixtures/statement.pdf \
         mobile-engineer-kit/fixtures/spoofed.pdf mobile-engineer-kit/fixtures/oversize.csv /sdcard/Download/
```

iOS simulator: drag the files onto the simulator window (they land in Files). iPhone: AirDrop or iCloud Drive.

### iOS on a device without a Mac

The `ios` CI job also builds an unsigned Release `.ipa` for devices (artifact `subscope-ios-device-ipa`), with the
diagnostics panel on. It is a test build only; the store build has no diagnostics.

1. Run CI manually with the PC's LAN address baked in, so a relaunch reaches the mock without re-entering it:
   `gh workflow run CI -f mock_url=http://<PC LAN IP>:8787` (without it, set the URL in diagnostics after each launch).
2. Sign and install with [Sideloadly](https://sideloadly.io) and a free Apple ID (a secondary one is fine; the
   certificate lasts 7 days). iTunes from apple.com must be installed on Windows. On the iPhone enable
   Settings → Privacy & Security → Developer Mode.
3. Start the mock on all interfaces (`$env:HOST='0.0.0.0'; npm start`), allow Node through Windows Firewall on port 8787,
   and allow Local Network access when the app asks.

Windows note: if a native Android build fails with `Filename longer than 260 characters` from `ninja`, the Android SDK's
CMake 3.22.1 ships a ninja that is not long-path aware; replace `<sdk>/cmake/3.22.1/bin/ninja.exe` with ninja ≥ 1.12.

### Diagnostics

On in development builds; in a release build only with `EXPO_PUBLIC_DIAGNOSTICS=1` at build time. Shows scenario buttons,
mock `stats` from `/__test/state`, mock reset, the local operation (`phase · status rN`), the last response the revision
guard ignored, and the base URL. A release export without the flag contains none of this code (checked in CI).

## Tests

```bash
cd app
npx vitest run                     # unit + integration, ~30 s (the mock's ready/deleted transitions take ≥ 1 s)
npx vitest run --coverage          # gate on src/core: lines 95 %, branches 85 %
npx vitest run --sequence.shuffle  # order independence
```

Integration tests import `mobile-engineer-kit/mock-server.mjs` directly and start a fresh `createMockServer` per test on
port 0 with a temporary state file, so they never touch a running CLI mock on 8787 or `.mock-state.json`. Assertions use
exact deltas of the mock's `stats`. Covered:

| Requirement                                                                        | Test                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------- |
| idempotency key persisted before the POST, same key in the header                  | `core.test.ts` › upload                 |
| `lost_ack` in-session → recovered by key, `newJobs = 1`                            | `core.test.ts` › upload                 |
| `lost_ack` + kill + relaunch → no second POST, `createRequests = 1, newJobs = 1`   | `core.test.ts` › upload                 |
| by-key 404 → "Retry upload" with the same key and copy                             | `core.test.ts` › upload                 |
| `stale_status` → stays `ready/3`, `ignored processing/2`, also after relaunch      | `core.test.ts` › stale_status           |
| duplicate `queued/1` after ready does not roll back                                | `core.test.ts` › guard                  |
| `delete_failure` → 503 is not "deleted"; retry with the same key → `deleted/5`     | `core.test.ts` › delete                 |
| relaunch mid-delete (landed / not landed / offline)                                | `core.test.ts` › relaunch during delete |
| late `ready/3` after deletion changes nothing                                      | `core.test.ts` › delete                 |
| `spoofed.pdf`, `oversize.csv`, CRLF, BOM never POSTed (`createRequests` unchanged) | `privacy.test.ts`                       |
| logs contain no file name, merchants, amounts, URIs, keys or bytes                 | `privacy.test.ts`                       |
| sniff identical to the server's rule on all fixtures                               | `sniff.test.ts`                         |

Not covered by automated tests: the device-only glue (`src/files/importFile.ts`, `src/transport/rn.ts`, the UI) —
that is what the scenarios below are for.

CI (`.github/workflows/ci.yml`) additionally checks the kit's checksums, lint/typecheck, SDK consistency, that no
analytics/crash SDK is in the dependency tree, that the release bundle contains no fixture data or diagnostics, the Android
release APK's permissions, and the iOS Info.plist.

## Scenarios (video script, per platform)

1. `reset` → pick `statement.csv` → Upload → _Waiting in the queue… → Analysing… → 151.99 AUD / month_ → Details.
2. `lost_ack` → pick `statement.pdf` → Upload → kill the app during _Uploading…_ / _Upload not confirmed_ → relaunch →
   ready. Diagnostics: `newJobs=1`.
3. happy import → ready → `stale_status` → Refresh status ×2 → stays ready; diagnostics shows `ignored processing r2`.
4. `delete_failure` → Delete → _Deletion not confirmed_ → `happy` → Retry deletion → _Deleting…_ →
   _Data deleted from the server_. (If the job is gone instead, e.g. the mock was reset mid-delete, a 404 ends in
   _Import no longer on the server_ — never "deleted", since only `deleted/5` confirms a deletion.)
5. `spoofed.pdf` and `oversize.csv` → rejected with a reason; `createRequests` unchanged.

See also [RELEASE_NOTE.md](RELEASE_NOTE.md) and [SELF_REVIEW.md](SELF_REVIEW.md).
