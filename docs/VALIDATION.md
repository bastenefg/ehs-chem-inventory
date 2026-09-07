# Verification and rollout notes

Verified on September 6–7, 2026.

## Version 2.2.2 signed APK

- Built the first public installer, **2.2.2 / version code 6**, application ID `com.example.cheminventory`, minimum Android 8.0/API 26. Its release manifest is not debuggable. The APK includes the [dependency inventory and license texts](../THIRD_PARTY_NOTICES.md).
- Updated all four CameraX dependencies from 1.3.4 to 1.4.2. Inspection found 4 KB-aligned native load segments in the old image-processing library. All **12 native libraries / 32 load segments** in the signed APK have 16 KB alignment and matching file-offset/virtual-address alignment; signed ZIP alignment also passes. This is a binary compatibility check, not a physical-device camera test.
- **61 JVM tests passed**, no failures or skips, after the dependency update. Lint passed with **zero errors, 34 warnings and one hint**. No suppression or baseline was added.
- **29 instrumentation tests passed**, no failures or skips, on the disposable API 36.1 x86_64 emulator after rebuilding. An initial test-runner launch stopped without a recorded app exception; the complete rerun passed. The emulator also had a System UI stall, which was dismissed before checking the signed app's visible setup screen.
- Fresh-installed the final signed APK on that emulator, launched it, checked its installed version/non-debug flags and blank setup screen, then successfully reinstalled the same APK using the same key and launched it again. This smoke check establishes installer/update acceptance; it does not claim a real lab migration or physical-camera test. No physical phone was modified.
- `apksigner` verifies **v2 and v3 signatures** with one dedicated RSA-3072 release identity. Public certificate SHA-256: `fb0291c575d1260c11eb9f83281c2fb8d7fd20886a054253cf1ccd8d41346b23`. The password-protected private key and Windows-protected credential stay in an ignored local directory; [secure off-device backup remains the maintainer's responsibility](MAINTAINER_SIGNING.md).
- APK SHA-256: `48cd9b1318863c95fb3da0166d9ff2497034538e9f842f42bf1bc88b4f1e961e`. Release assets include a matching `SHA256SUMS.txt`; the release notes identify the exact source commit. APK size: 8,863,647 bytes.

The connector is unchanged from the 226 passing checks in 2.2.1. No live Parley request, Google setup/save, physical camera check or EHSA submission was performed for this packaging release. The earlier live-validation limits still apply. The installer remains a lab pilot, with [migration instructions for existing debug builds](ANDROID_INSTALL.md#already-have-a-pilot-copy-installed). CI now also compiles an unsigned release; it never receives signing credentials.

## Version 2.2.1 publication checks

- Built debug and unsigned release APKs for **2.2.1 / version code 5** using patched Gradle 8.14.5 and ExifInterface 1.4.2. The release manifest is not debuggable. The debug APK retains the prior pilot's signing certificate; no new release key was created and no APK is included in the public source tree.
- **61 JVM tests passed, no skips.** New cases keep automatic CAS lookup from overriding ambiguous/conflicting label evidence or explicit no-CAS explanations. URL validation rejects unrelated MIT subdomains and accepts the verified Parley API host only.
- **29 instrumentation tests passed, no skips**, on a disposable read-only API 36.1 emulator. The existing complete storage/CAS/manual-entry/progress suite was rerun against the patched app with mocked or disabled services. The physical phone was not modified.
- **226 Node tests passed, no skips:** 90 connector, 25 diagnostic, 46 access and 65 recovery checks. Added coverage includes token rotation during a Google outage, conflicting duplicate IDs, exact retries, and incomplete setup properties preventing accidental replacement creation.
- Android lint passed with **zero errors**, 34 warnings and one hint. No suppression or baseline was added.
- Gitleaks 8.30.1 scanned the staged source with default rules and fully redacted output, with no findings. The scanner download and Gradle wrapper/distribution were checked against official SHA-256 values. Local IDE state, credentials, logs, build outputs and historical distribution archives are excluded from publication.

The repository includes [GitHub Actions checks](https://github.com/bastenefg/ehs-chem-inventory/actions/workflows/ci.yml) for source secrets, Android build/JVM/lint checks and the connector suites, plus Dependabot configuration. These local results do not claim a remote workflow outcome; inspect the Actions run for the commit being reviewed. The [publication review](SECURITY_REVIEW.md) records findings, fixes and scope. Live Parley/Google/physical-camera and release-signing checks remain separate.

## Version 2.2 checks

- Built Android version **2.2 / version code 4**, minimum API 26. The APK signature matches the supplied 2.1 build, so it supports an in-place update without clearing app data.
- **57 JVM tests passed, no skips:** 15 inventory validation, 14 scan extraction/request, 17 PubChem adapter/cache, 10 automatic-selection tests and the original sample test. Automatic selection requires one complete-name compound match with one valid CAS, including detection of a second compound that returned no CAS. Composition-qualified and ambiguous cases remain unfilled.
- **29 instrumentation tests passed, no skips**, on a disposable read-only API 36.1 emulator. Eighteen exercise CAS scheduling, automatic fill, persistence, opt-out, ambiguous selection, manual-entry precedence, composition/name changes and late responses. The others cover storage/recovery, the full manual-entry form, one-step candidate selection, and indeterminate progress through capture/import/reading stages. PubChem calls are mocked in flow tests and disabled in the UI fixture; no Parley or worksheet connection is used.
- **217 Node checks passed, no skips:** 81 connector, 25 diagnostic, 46 access and 65 empty-recovery tests. New initialization creates through Drive, resumes the same captured file after later failures, blocks duplicate creation after an uncertain response, and preserves existing inventory and credentials.
- Android lint passed with **zero errors**, 35 warnings and one hint, matching the previous count. No new suppression or baseline was added.
- Refreshed screen captures show the simpler scan/setup/review pages and the progress screen. The progress screenshot uses a **4-second fixture value**, not a measured Parley response time.

Verification commands were `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest`, all four `sheets/*.test.cjs` suites, and AndroidJUnitRunner explicitly targeted at `emulator-5580`. The emulator was closed after screenshots were copied. The connected physical phone was not modified.

The owner confirmed that the earlier worksheet recovery worked. New-lab installation now uses that creation route directly. The combined initializer still needs a live fresh-project check, and Parley latency has not been remeasured. This release improves visible progress and opens the durable draft before photo cleanup; it makes no measured speedup claim and leaves model requests/image quality unchanged.

## Version 2.1 baseline

- Android debug APK: built successfully, version 2.1 / version code 3; minimum Android API 26. Its signing certificate matches the supplied version 2.0 APK, allowing an in-place update.
- JVM: all 46 tests passed. These include 15 inventory validation tests, 14 scan request/transcription tests, 16 PubChem protocol/parser/cache tests and the original sample test. Covers required fields, CAS checksums, strict label evidence, minimal-reasoning request eligibility, truncation, exact-name lookup, credential exclusion, CAS-specific identifiers, response limits and cache expiry.
- Google Sheets connector: the revised Advanced Sheets test suite verifies the explicit `drive.file` scope, authentication, literal typed cell writes, stable-ID retries after lost responses, initialization recovery, safe token handling, header integrity and EHSA export settings/confirmation gates. See the connector update results below.
- Android emulator: all 21 instrumentation tests passed on API 36.1 with no skips. The existing eight tests cover storage, recovery and the manual-entry flow. Twelve new tests exercise CAS proposal acceptance, stored provenance, settings persistence, manual-entry precedence, changed-name/composition invalidation, stale responses and pending/synced-record protection. An isolated Compose test verifies that canceling a CAS confirmation leaves the record unchanged and accepting requires an explicit action.
- Android lint: passed with zero errors. Remaining warnings concern existing dependency versions, unused starter resources and style suggestions. No lint errors were suppressed or baselined.
- Source inspection: the original shared backend token and fixed lab identity were removed from production source. No live key was added.

The original Espresso 3.5.1 test dependency could not inject events on Android 16 because an internal InputManager API changed. Test dependencies were updated to Espresso 3.7.0 and AndroidX JUnit 1.3.0; the documented fix is in the [AndroidX Test release notes](https://developer.android.com/jetpack/androidx/releases/test#espresso_370). All device tests then passed. The initial emulator had System UI stalls, so device verification used a disposable read-only emulator with software rendering and no changes to the saved AVD.

## Earlier connector permission update

The updated connector passed **73 offline tests** using `node --test --test-reporter=spec sheets/connector.test.cjs`. The manifest declares only `drive.file` and enables Advanced Sheets v4. Regression checks reject account-wide or HTML services, keep credentials out of logs/cells, preserve records after a lost append response, and prevent a second spreadsheet creation after an ambiguous creation response. Missing-service checks run before recording a creation attempt.

Export checks cover PI metadata, exact template mappings, validation of the full inventory, individual no-CAS/generic-unit confirmations, changed records or PI settings invalidating confirmations, and literal formula-like text. SHA-256 fingerprints keep review cells bounded even for maximum-length escaped label text. No additional OAuth scope is used for hashing.

The connector itself is unchanged by Android version 2.1. Both the earlier and per-file connector use the same record protocol and accept the existing CAS source field. The 73 connector tests passed during the preceding permission update; the Android checks above were rerun for 2.1. A signed-in Google consent/deployment test was not performed, and these tests do not establish MIT EHS compliance.

## Version 2.1 scan and CAS update

Public PubChem API checks returned ethanol (CID 702, CAS 64-17-5) and copper(II) sulfate pentahydrate (CID 24463, CAS 7758-99-8). Generic registry cross-references returned extra CAS-shaped numbers, so implementation uses the CAS-specific identifiers endpoint instead. No real lab inventory or credentials were used for these public sample requests.

The app owner reported that a GPT-5 scan worked through MIT Parley in version 2.0. Version 2.1's Fast scan request is covered by offline tests, but its acceptance and actual speedup through Parley remain unmeasured. The new on-screen timing separates photo preparation from the full Parley network request. See [scanning and CAS](SCANNING_AND_CAS.md).

## Live worksheet connection investigation

The owner reported that **Check connections** fails with the newer standalone connector. The optional owner-run diagnostic returned `D03_GOOGLE_OR_RUNTIME_ERROR`: `sheets.spreadsheets.get` failed with “Requested entity was not found.” The owner confirmed that the stored worksheet URL opens the expected inventory with the same Google account and that this exact script project created it. The same result occurred in a fresh private window with only the initializing account signed in. The Cloud project is still **Default**, and the original initialization completed successfully and printed its link. The failure is at metadata access, before headers or row writes. The underlying access/identity cause and the deployed endpoint remain unresolved; browser access alone does not verify the app's per-file grant.

The access check, diagnostic and connector together passed **144 offline checks** (46 access checks, 25 diagnostic checks and 73 connector checks), including the diagnostic calling the actual connector's read-only ping with mocked Google services. The access helper separately checks scope consent, Drive file metadata and Sheets metadata; it preserves unknown states and redacts error details. These checks do not establish live Google access. See the [D03 troubleshooting procedure](WORKSHEET_TROUBLESHOOTING.md#d03-requested-entity-was-not-found). No app or connector behavior was changed in response to this diagnostic result.

The subsequent live access report confirmed `scopeAuthorized: true` and `scopeStatus: notRequired`; both Drive and Sheets still returned file-not-found errors, leaving `appAuthorized` unknown. This establishes that the configured file is inaccessible through the script's APIs despite scope consent. It does not prove which grant or service condition caused that result. The owner confirmed the inventory is **empty apart from headers**, permitting the [staged empty-worksheet recovery](EMPTY_WORKSHEET_RECOVERY.md) without transferring chemical records. The original file must remain preserved, and the replacement must pass live checks before use.

The empty-recovery helper passed **65 additional offline checks**. All four local suites passed together: **209 checks, zero failures/skips**. Recovery checks cover a recorded creation attempt before the Drive API call, no duplicate creation after ambiguous responses, resuming the same captured candidate, refusing unexpected content or insufficient file access, fresh validation before activation, preserving the source/token, safe retries after lost responses, and retaining useful sanitized Google errors. At that stage only the owner-run recovery module was added; the Android app, normal connector source and manifest were unchanged. The agent did not create or activate a replacement.

The owner subsequently reported **“It works now!”** after the recovery procedure. Version 2.2 therefore incorporates the successful **Drive-created spreadsheet → Sheets configuration** route into normal initialization. This establishes a working recovery, while the cause of the original file's access failure remains unexplained. Existing working connections stay in place. The current four local suites pass **217 checks**: 81 connector, 25 diagnostic, 46 access and 65 recovery checks. They cover resumable setup, explicit Drive/Sheets service prerequisites and preservation of existing records, export settings and tokens. A fresh lab installation with the revised combined initializer still requires a live Google check; the owner's successful recovery is not a substitute for that test.

## Still required with the lab owner

1. Compare Fast scan on/off with the same label and the lab user's GPT-5 Parley configuration. Confirm both latency and extracted-field accuracy. If the gateway rejects the speed parameters, disable Fast scan. Other model availability and vision support must be checked with that user's account.
2. Create a fresh standalone Apps Script project with both updated files under an approved lab account. Inspect its actual consent screen for per-file access without account-wide Sheets or HTML-dialog permissions, initialize and deploy it, check the returned Sheet identity, and test a reviewed record plus a retry. Offline mocks cannot verify real Google permissions, quotas, deployment restrictions or network behavior. Normal consent and privacy/branding notices can remain.
3. Review an EHSA snapshot with the EHS coordinator before importing. The exact source headings/unit codes are mapped, but live importer acceptance and lab-specific PI authorization have not been tested. The app does not submit the full inventory or the separate Atlas annual report.
4. Test physical-camera focus/orientation and representative labels on the intended phones. The emulator tests exercise manual entry and recovery, not physical bottle recognition.
5. The public 2.2.2 APK now uses a dedicated release key. Preserve that key and its password in a secure backup for future updates, and use the migration instructions for earlier debug builds. Signing alone does not complete the live checks above.
6. The owner of the original fixed backend should revoke/rotate the credential embedded in old builds before sharing them. This update did not contact or alter that backend, its token, or its worksheet.

No production worksheet was created, changed or submitted. No real label photo was sent to Parley during these checks. Tests targeted only a disposable emulator; the connected physical phone was not modified.

## Screen previews

These images were captured from the running version 2.2 Android UI during passing instrumentation tests, using clearly labeled test data and no service credentials: [scan](screenshots/scan.png), [setup](screenshots/setup.png), [review](screenshots/review.png), and [progress](screenshots/progress.png). The progress time is a test fixture. Layouts were visually inspected for legibility and overlap. The complete form scroll and activity recreation were exercised by the tests.
