# Publication review — 2.2.1

Reviewed September 7, 2026. This is a source/configuration review with automated tests, not an independent penetration test, security certification or MIT endorsement. It covers the candidate source for the first publication to `bastenefg/ehs-chem-inventory`; older local distribution archives are excluded.

## Issues found and addressed

| Finding | Change and evidence |
| --- | --- |
| A missing CAS caused by multiple label numbers could later be filled by a single PubChem name match | Automatic selection now retains all distinct CAS-shaped label numbers, including invalid-checksum evidence, and refuses conflicting or multiple numbers. Explicit no-CAS/mixture explanations remain manual. Regression tests exercise label parsing followed by automatic selection. |
| Any MIT subdomain could receive the entered Parley bearer key | The accepted host is now exactly `parley.api.mit.edu` over HTTPS. Tests reject unrelated lab/personal/frontend MIT hosts, lookalikes, credentials in URLs and invalid ports. |
| Token rotation depended on a successful Sheets metadata call | Rotation now validates local configuration and replaces the token under the script lock without Drive/Sheets requests. Outage and old-token rejection tests cover this. |
| A repeated record ID could return success even when the stored row differed | The connector compares normalized record contents. Exact retries, including lost responses, remain idempotent. Changed content, duplicate IDs or invalid stored rows return `id_conflict` without altering the worksheet. |
| Partly deleted setup properties could be mistaken for a new installation | Initialization checks surviving known inventory properties before creating anything. A captured creation receipt can resume its same file; incomplete unrelated setup cannot silently select a replacement. |
| Gradle 8.13 was affected by published build dependency-resolution advisories | Upgraded to verified Gradle 8.14.5, including its matching official wrapper JAR and distribution SHA-256. This addresses [GHSA-mqwm-5m85-gmcv](https://github.com/gradle/gradle/security/advisories/GHSA-mqwm-5m85-gmcv) and [GHSA-w78c-w6vf-rw82](https://github.com/gradle/gradle/security/advisories/GHSA-w78c-w6vf-rw82). |
| The EXIF parser predated upstream robustness fixes | Updated AndroidX ExifInterface from 1.3.2 to 1.4.2. The upstream history includes parsing/loop fixes after the earlier version; this is maintenance of an untrusted-image parser, not a claim of an observed exploit. See [AndroidX release notes](https://developer.android.com/jetpack/androidx/releases/exifinterface). |

## Publication checks

The exact staged source was scanned locally with Gitleaks 8.30.1 using redacted output and its default rules. The scanner archive was checked against its official release SHA-256 before execution. The staged scan returned no findings; a manual search for credential/private-key patterns also reviewed the publication paths. A dummy test key is synthetic, not a live account credential. There was no prior local Git history to audit, and no legacy history was imported.

Only source/build configuration, connector/tests, docs and synthetic screenshots are staged. Local SDK paths, IDE settings, build outputs, emulator logs, old APK/ZIP packages, signing material and device data are excluded. Scanner reports remain in ignored local build output. Secret scanning is heuristic: no-findings does not prove that every possible secret format was recognized.

The review checked network destinations, redirect credential handling, app permissions, storage/backups, server authentication, literal spreadsheet writes, exports, duplicate handling and recovery helpers. No production key or real label was used. Public dependency-advisory checks covered selected named packages and the Gradle toolchain; this was not a complete transitive-dependency vulnerability or license audit. Build and test results are recorded in [VALIDATION.md](VALIDATION.md).

GitHub workflow actions are pinned to verified full commit IDs with read-only repository permissions. Workflows require no lab or signing credentials. Dependabot configuration proposes dependency updates; it does not make unreviewed changes safe or enable all GitHub account security settings. The maintainer authorized the project's MIT license and copyright attribution.

## Remaining deployment limits

The source can be reviewed and shared as a lab pilot. A broadly distributed installer still needs a privately managed release signing identity and a documented update path from earlier debug pilots. This review does not turn the old 2.2 debug APK into a production release. See [release guidance](GITHUB_SHARING.md).

The per-lab connector intentionally trusts its owner/editors and uses a shared append token. It does not authenticate each rep separately or prevent public callers from consuming some Apps Script quota. An owner changing a deployment's destination is a trusted configuration change; do not reuse a deployment across labs. CAS/OCR can still be wrong, and the worksheet is not an MIT reporting submission. See [SECURITY.md](../SECURITY.md) and [PRIVACY.md](PRIVACY.md).

Live Parley latency/accuracy, a fresh Google deployment, physical-camera behavior, institutional approval and independent security assessment remain separate checks. Nothing in this review guarantees another person's trust; the purpose is to make the implementation and its limits inspectable.
