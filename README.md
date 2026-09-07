# ChemInventory

An Android tool for MIT lab chemical inventories. Photograph or import a label, review the extracted fields, and send the record to a Google Sheet owned by your lab. Each rep brings their own MIT Parley key; no lab identity or service credential is built into the APK.

[**Download the Android app (2.2.2)**](https://github.com/bastenefg/ehs-chem-inventory/releases/download/v2.2.2/ChemInventory-2.2.2.apk) · [Installation guide](docs/ANDROID_INSTALL.md) · [Release notes](https://github.com/bastenefg/ehs-chem-inventory/releases/tag/v2.2.2)

The ready-to-install APK works on Android 8.0 or later. You do not need Android Studio or to build the app yourself. If you already have a pilot copy installed, read the [migration note](docs/ANDROID_INSTALL.md#already-have-a-pilot-copy-installed) first.

This is a lab-developed tool, not an official MIT EHS application. It supports inventory preparation and human review. Saving a row does not submit the full inventory or the separate annual regulated-chemical report.

## Status and data handling

**2.2.2 is a lab pilot.** A signed Android installer is available in [GitHub Releases](https://github.com/bastenefg/ehs-chem-inventory/releases/tag/v2.2.2). The source is available for review under the [MIT open-source license](LICENSE); this does not imply MIT endorsement. A release signature identifies the publisher and allows compatible future updates; it is not a security certification.

Photos go to MIT Parley. Missing-CAS lookups send the chemical name to public PubChem. Reviewed records go to the lab's private Google Sheet. The app requests Camera and Internet permissions; the connector requests Google's per-file `drive.file` permission. Each lab controls its own accounts and sharing. Read [data handling](docs/PRIVACY.md), [security boundaries and reporting](SECURITY.md), and [the actual verification results](docs/VALIDATION.md).

The repository includes automated Android/connector checks and dependency-update configuration. These help review changes; they are not a security certification. Questions and sanitized bug reports go to [GitHub Issues](https://github.com/bastenefg/ehs-chem-inventory/issues). See [contribution guidance](CONTRIBUTING.md).

## Installation

**Already connected successfully?** Keep your worksheet, URL and token. The first public APK uses a dedicated release signing key, so it cannot update an earlier debug-signed pilot in place. Follow the [migration note](docs/ANDROID_INSTALL.md#already-have-a-pilot-copy-installed) before changing an existing installation. For the connector fixes, replace **Code.gs** in the existing script project and deploy a new version of that same deployment as described under [maintenance](docs/GOOGLE_SHEETS_SETUP.md#maintain-the-worksheet). Do not reinitialize or repeat recovery. The installation procedure below is for new labs.

1. **Worksheet owner:** follow [Google Sheets setup](docs/GOOGLE_SHEETS_SETUP.md) once to create a private lab worksheet and its connector. Give trusted reps the deployment URL and generated connection token through your lab's approved private channel.
2. **Each rep:** [download and install the Android app](docs/ANDROID_INSTALL.md). Open **Lab setup** and enter the lab name, PI/supervisor and default building-room.
3. Sign in at [MIT Parley](https://parley.mit.edu/), open **Parley API**, generate your key and paste it into the app. The initial API base is `https://parley.api.mit.edu/v1`, supplied by the app owner and checked for reachability. Choose an image-capable model available to your account; **Check connections** can retrieve the model list.
4. Paste the worksheet connector URL and its connection token. Check the connection, open the returned Sheet link and confirm the lab. Save the setup.
5. Scan one label. A progress bar shows photo preparation and label reading. Missing CAS numbers are looked up in PubChem automatically while you edit; a single unambiguous full-name match fills the CAS field and records its source. Mixtures, concentration-qualified products and ambiguous results remain for review. Check the fields against the label/SDS, confirm review and save. Verify the first row in the shared Sheet before an inventory session. See [scan speed and CAS lookup](docs/SCANNING_AND_CAS.md).

No terminal, personal Google API key, custom Google Cloud project, or service-account credential is required for a lab's worksheet setup. A trusted owner copies **Code.gs** and **appsscript.json** into a new standalone Apps Script project. The supplied manifest enables Drive v3 and Sheets v4; initialization creates the spreadsheet through Drive, then configures and checks it through Sheets. This incorporates the creation method that resolved the owner's access failure into the normal installation. The connector requests only `drive.file` access to files used with the script and has no HTML-dialog permission. Normal Google consent can remain; see [permissions](docs/GOOGLE_PERMISSIONS.md) and [data handling](docs/PRIVACY.md). If institutional policy blocks its web-app access model, an approved alternative backend is needed; do not make the Sheet public.

## What changed in version 2

- Version 2.2.2: first downloadable APK signed with a dedicated release key, Android installation/migration instructions, bundled dependency notices, and CameraX 1.4.2 native libraries for 16 KB page compatibility.
- Version 2.2.1: CAS lookup preserves conflicting label evidence and explicit no-CAS explanations; Parley keys are restricted to the verified API host. Connector retries reject changed content for an existing record ID, token rotation works during Google outages, and incomplete setup properties cannot silently create a new destination. Includes updated Gradle/EXIF parsing, verified wrapper checksums, CI, security documentation and an MIT license.
- Version 2.2: direct screen labels, simpler layouts, progress bars from capture/import through label reading, and automatic CAS filling for a unique full-name PubChem match. Background lookup also follows chemical-name edits and reopening incomplete drafts. New installations use the verified Drive-based worksheet creation flow.
- Version 2.1: optional minimal-reasoning GPT-5 requests, separate scan timings, more tolerant reading of printed CAS numbers, and background PubChem CAS proposals with source links, explicit identity confirmation and an in-memory cache. No extra service key is needed.
- New scan dashboard, guided lab setup, scrollable review form, camera framing and searchable records.
- Lab-specific PI, rooms, worksheet and Parley credentials replace the original fixed lab configuration.
- Separate amount per container, unit, container count and physical state; additional concentration, expiry, label transcription and CAS provenance fields.
- CAS syntax/checksum validation, source attribution and explicit human review. Unreadable OCR remains blank unless an eligible database match fills the CAS; reporting classifications are not inferred.
- Private local drafts and a durable record ID before sending. A timeout retains the record; retrying it preserves the original worksheet row.
- Android Keystore encryption for settings and keys; credential and inventory files excluded from Android backups. Images are resized and re-encoded without original metadata; the app attempts to remove temporary images after each scan.
- Lab-owned Sheets connector with per-file permission, authentication, duplicate protection, input validation and literal text writes, plus a reviewed EHSA export workflow.

The phone's Records page contains records made on that phone. The shared Sheet is the complete multi-person inventory. After a successful send, correct or reconcile inventory in the Sheet; this connector appends records and does not edit or delete committed rows. Do not rescan the same bottle merely to retry a save. A retry is acknowledged only when the stored row matches that record's content; a changed or duplicate ID needs reconciliation.

## MIT requirements and limits

The [current inventory guidance](https://ehs.mit.edu/wp-content/uploads/EHS_Chemical_Inventory_Guidance_Oct-2025.pdf) requires PI, building-room, full chemical name, amount with units and CAS when one exists. Physical state, concentration, container count and applicable expiry are also captured. The app requires state/count for worksheet consistency and EHSA preparation.

Maintain the inventory and submit the entire inventory during annual reporting season. [Annual Chemical Reporting](https://ehs.mit.edu/chemical-safety-program/chemical-regulatory-reporting-security/) is a separate process. Regulated-substance forms, mixture concentrations, and usage questions cannot all be recovered from a photo. Refer to current MIT instructions and your EHS coordinator; the app does not calculate maximum allowable quantities or certify compliance.

The connector's **prepareEhsaImport** function, run from the Apps Script editor, prepares a separate snapshot using MIT's template headings and state-specific unit codes. Supply PI identity in **Export settings** and complete any **Export review** confirmations. Unsupported units and invalid records must be corrected; no rows are silently dropped. This is not an automated EHSA upload or Atlas submission. See [source requirements](docs/research-notes.md) and [export mapping](docs/EHSA_EXPORT_MAPPING.md).

## Parley integration status

MIT documents user-generated API keys in its [Parley API overview](https://mitsloanedtech.mit.edu/tools/parley-api/). The detailed [API reference](https://parley-docs.mit.edu/) requires MIT sign-in. The adapter uses OpenAI-compatible model discovery and image chat completions. The app owner reported a successful GPT-5 label scan with version 2.0. The new Fast scan parameters and their actual latency still need a check through the lab's Parley account; other models' availability and image support must be confirmed there.

Keys are created in Parley's portal. This app does not mint keys or automate MIT sign-in. Replace or clear a key in **Lab setup**. Never put a key in a source file, Sheet cell, screenshot or support log.

## Build and verify

Building is optional for developers. Lab reps can use the [ready-to-install APK](docs/ANDROID_INSTALL.md).

Open the project in Android Studio with Android SDK 36 and a JDK supported by Android Gradle Plugin 8.13.2 (the bundled Android Studio JDK works). Android 8.0/API 26 is the minimum device version. The project retains the original application ID `com.example.cheminventory` so appropriately signed upgrades can preserve app data.

On Windows PowerShell:

```powershell
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
./gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
node --test sheets/connector.test.cjs sheets/diagnose.test.cjs sheets/check-access.test.cjs sheets/recover-empty.test.cjs
```

For a disposable Android emulator:

```powershell
./gradlew.bat :app:connectedDebugAndroidTest
```

The debug build is at `app/build/outputs/apk/debug/app-debug.apk`. It is for evaluation. For distribution, use Android Studio **Build → Generate Signed App Bundle / APK**, select APK and a privately managed release keystore. Keep the same signing key for updates and keep it out of source control. Android rejects upgrades signed with a different key; do not uninstall a phone's working copy before preserving its pending records and confirming its upgrade path.

Verification includes field validation, server-side connector cases and emulator storage/workflow checks. See [validation notes](docs/VALIDATION.md) for the actual run results and remaining live checks.

## Architecture

- `InventoryScreens.kt`: scan, setup, review, records and reporting guide.
- `MainActivity.kt`: retained screen/operation state and durable save workflow.
- `CameraPage.kt`: CameraX capture and bounded, orientation-aware image preparation.
- `InventoryModels.kt`: settings, records and validation.
- `InventoryStore.kt`: atomic local journal and encrypted device settings.
- `InventoryApi.kt`: Parley and Sheets protocol adapters; no shared developer credential.
- `ScanExtraction.kt`: model-specific fast requests and evidence-based CAS extraction from label text.
- `CasLookup.kt` and `AutoCasSelection.kt`: PubChem lookup, bounded requests, in-memory cache and conservative automatic CAS selection.
- `sheets/Code.gs`: per-lab Google Apps Script connector and export tooling.

This replaces the original app's calls to a fixed Cloud Run backend; that backend's source is not present in this folder. Existing remote inventory is not migrated or modified. Review and move old inventory with your lab owner as needed. The old app contained a shared backend token: its owner should revoke/rotate that token before distributing old builds or source. No token was revoked and no production resource was changed during this update.

Original app by Bastien FG Aymon, MIT MechE.
