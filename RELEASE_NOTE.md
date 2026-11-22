# Release note — Subscope 1.0.0

## What it does

Imports one PDF or CSV bank statement (≤ 10 MiB), uploads it to the import API, shows the recurring payments found
(e.g. *151.99 AUD / month*, with per-merchant details), and lets the user delete the statement and its results from the
server. Uploads survive lost responses and app restarts without creating duplicate jobs.

## Permissions

| Platform | Requested | Why |
|---|---|---|
| Android | `android.permission.INTERNET` | talk to the API |
| Android | `dev.klotsman.Subscope.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | added by AndroidX core; app-internal signature permission, never shown to the user |
| iOS | `NSLocalNetworkUsageDescription` | only needed when the API is reached over the LAN (physical iPhone + local mock) |

No storage, media, camera, location or contacts permissions: files come through the system document picker, which grants
access to the one chosen file. Storage/media/audio permissions that libraries may pull in are listed in
`android.blockedPermissions`. CI fails the build if the release APK requests anything outside the table above or if
`Info.plist` gains a camera/photo/microphone/location/contacts usage description.

Network: Android release builds allow cleartext HTTP (`usesCleartextTraffic`) and iOS allows local networking
(`NSAllowsLocalNetworking`, *not* `NSAllowsArbitraryLoads`), because the test API is plain `http://` on a local address.
**For a production API on HTTPS, remove `usesCleartextTraffic` and the ATS exception.**

## Data on the device

| What | Where | Lifetime |
|---|---|---|
| Copy of the picked file | `cache/imports/<random id>.bin` (original name never used in the path) | deleted as soon as the server confirms the job (202 or by-key 200), on rejection, on cancel; leftovers removed at app start |
| The picker's own temporary copy | the picker's cache folder (contains the original name) | moved into `cache/imports/` immediately after picking |
| Import operation: idempotency key, job id, status, revision, format, size, last ready result, delete key | AsyncStorage `subscope.importOp.v1` | until the next import; after deletion only a tombstone (job id, revision 5) remains, without the result |

Not stored: the file name (shown on the confirm screen from memory only), file contents, picker URIs.
Not logged: file names, URIs, keys, amounts, merchants, file bytes. Logs are development-build only and pass through a
field whitelist (`src/log`). No analytics or crash-reporting SDKs (enforced in CI).

## Sent to the server

The file bytes, an `Idempotency-Key`, and `X-File-Name: import.pdf` / `import.csv` — a generic name, not the user's file
name.

## Needs a new native binary (not shippable as an OTA update)

- changes to ATS / cleartext settings or permissions (`app.config.ts`);
- adding or removing a native module (this release replaced `@react-native-documents/picker` with `expo-document-picker`);
- an Expo SDK / React Native upgrade.

JS-only changes (UI, core logic, texts) can ship via `eas update`.

## Known limitations

- A file over 10 MiB is copied into the cache once before it is rejected (the size is known only after the picker
  copies it). It is deleted immediately and never uploaded.
- CSV files with Windows line endings (CRLF) or a UTF-8 BOM are rejected — the server rejects them too.
- A delete that returns 404 (job no longer exists on the server, e.g. after a mock reset) stays "Deletion not confirmed".
- The base URL override in diagnostics is not persisted across restarts.
