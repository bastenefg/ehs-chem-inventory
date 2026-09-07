# Set up your lab's shared Google Sheet

One trusted lab administrator installs this connector once. Each rep then enters the lab's connector URL and token in the Android app, along with their own MIT Parley key. The connector creates the dedicated spreadsheet through Google Drive, then prepares its inventory tabs through Google Sheets. This is the creation route confirmed working in the pilot.

**Already connected successfully, including after recovery?** Keep your existing worksheet, script project, URL and token. For the 2.2.1 fixes, replace **Code.gs** and publish a new version of the same deployment using the maintenance steps below. Do not rerun initialization or recovery. The installation steps below are for a new lab.

The connector requests access to files created or explicitly used by the script (`drive.file`), instead of all your spreadsheets. Google still controls the consent screen; see [permissions and consent](GOOGLE_PERMISSIONS.md). For the earlier connector that requested all spreadsheets, use the migration section below.

This creates an inventory working sheet. It does not submit an MIT EHS report or certify compliance.

## 1. Create the connector

1. Sign in with a Google account your lab is allowed to use for chemical inventory information.
2. Open [Google Apps Script](https://script.google.com/home/start) and choose **New project**. Start here, rather than from **Extensions → Apps Script** in an existing spreadsheet.
3. Name the project something recognizable, such as “Our lab inventory connector.” Bookmark it; the worksheet will not have a custom connector menu.
4. Open **Code.gs**, select all its starter text, and paste the complete contents of [sheets/Code.gs](../sheets/Code.gs).
5. Open **Project Settings** (gear icon) and enable **Show "appsscript.json" manifest file in editor**.
6. Return to **Editor**, open **appsscript.json**, and replace its contents with [sheets/appsscript.json](../sheets/appsscript.json). Save both files.
7. Under **Services**, confirm both **Drive API v3** (identifier **Drive**) and **Google Sheets API v4** (identifier **Sheets**) appear. The supplied manifest enables both and specifies just one OAuth scope: `https://www.googleapis.com/auth/drive.file`. If either service is absent, use **Services → +**, select its API and version, and add it with the matching identifier.

Do not type a Sheet ID, token, email address or Parley key into the source. You do not need a terminal, service account, Google API key, or custom Google Cloud project. Keep the default Apps Script Cloud project: enabling each advanced service also enables its API there. If your administrator has already assigned a standard Cloud project instead, they must enable both the Drive API and Google Sheets API there. See [Google's advanced-service setup](https://developers.google.com/apps-script/guides/services/advanced).

## 2. Initialize and authorize

1. In the editor's function selector next to **Run**, select **initializeInventory**, then click **Run**.
2. Complete Google's authorization for this project. The requested file access should concern files used with this app. It should not request access to **all your Google Sheets**, nor permission to display third-party web content. If it does, cancel and confirm you are in the new project with the supplied manifest.
3. On success, the execution log contains the new spreadsheet link. Select **showConnectionDetails** and click **Run** separately. This checks that the same worksheet remains accessible in another execution and prints its link again. Open that link; neither function prints the token.
4. Rename the spreadsheet for your lab. Keep the tabs **Chemical inventory** and **Export settings**. The hidden **Record ID** column and inventory headings must remain intact.
5. In the spreadsheet's **Share** dialog, keep general access **Restricted** and add the lab reps and reviewers who need access. The standalone script has separate sharing settings: share its project only with trusted administrators who may access the connection token or change the connector.
6. Return to **Project Settings → Script properties** and copy the value of **INVENTORY_TOKEN**. Store it in your lab's approved password manager. This is the lab connection token, separate from a Parley key. Leave other properties unchanged.

The normal installation uses only **Code.gs** and **appsscript.json**. It does not need the optional recovery script or an intermediate worksheet.

Successful initialization can be run again: it keeps the same spreadsheet and token and preserves inventory, PI settings and export tabs. If a later setup step fails after Google returned the new file's ID, rerunning **initializeInventory** resumes that same file. If creation itself has an uncertain result, the saved creation marker blocks another file; follow the error instructions and do not clear properties to force creation. Each lab should use a separate script project and newly created spreadsheet.

## 3. Deploy the connector

1. Select **Deploy → New deployment** in Apps Script.
2. Use the gear next to **Select type** and choose **Web app**.
3. Enter a description, such as “Lab inventory app.” Set **Execute as** to **Me** (the lab administrator).
4. Set **Who has access** to **Anyone**. The Android app authenticates with the lab token in its request body and does not perform Google browser sign-in. This exposes the connector endpoint, while the spreadsheet remains private. A valid token permits connection checks and appending reviewed records; the endpoint does not return inventory rows.
5. Choose **Deploy** and copy the **Web app URL** beginning with `https://script.google.com/macros/s/` and ending in `/exec`. Do not use a `/dev` test URL.

If your institution blocks authorization or does not permit the **Anyone** deployment option, use an administrator-approved backend. Making the spreadsheet public does not solve this. Do not change institutional controls to complete setup.

Anyone with both the URL and token can append records as the deployment owner. Share them privately with trusted reps. Never include tokens in URLs, source files, screenshots or support tickets. Invalid requests can still consume some Apps Script quota.

## 4. Connect each phone

1. Install the APK supplied by your lab using its approved Android installation process.
2. Open **Lab setup** and enter the lab name, PI/supervisor, default full building-room, connector URL and lab token.
3. Sign in to [MIT Parley](https://parley.mit.edu/) and create your own API key using MIT's supported process. Enter it in the Parley field and choose an available image-capable model. The initial API base is `https://parley.api.mit.edu/v1`.
4. Check connections. A successful worksheet check returns its link without adding a row. Open the link and confirm the correct lab, then save setup.
5. Scan one label, review the extracted information against the container/SDS, confirm **amount per container** and **container count**, and save. Confirm the row appears in **Chemical inventory** before a full inventory session.

The updated connector keeps the same Android connection protocol.

## Maintain the worksheet

- Keep the **Chemical inventory** tab name, column names and column order unchanged. Use separate tabs for calculations. Adding or changing inventory headings causes readiness checks to fail rather than silently shift data.
- Preserve every hidden **Record ID**. Sort the entire sheet, including that column, rather than a subset of columns.
- A retry with the same ID and matching content returns success without adding another row. A reused ID with different content, duplicate IDs or a malformed stored row returns a conflict; reconcile the record with the worksheet owner. The connector does not increment counts or update previously saved records. Correct already-synced records in the Sheet and keep their IDs intact.
- The sheet contains label transcriptions and review metadata as well as chemical details. See [data handling](PRIVACY.md).
- If the token is exposed, select **rotateConnectionToken** and click **Run** in the script editor. It replaces the token under the script lock using local configuration, without calling Google Drive or Sheets; a service outage does not prevent rotation. Copy the new **INVENTORY_TOKEN** from Script properties to every phone. Existing rows remain intact; no redeployment is needed for token rotation.
- To update code within this new connector, save both source files, then use **Deploy → Manage deployments → Edit → New version → Deploy**. Saving source alone does not update a versioned deployment. Keep its deployment URL.
- To retire the connector, archive its web-app deployment under **Manage deployments**. Preserve the spreadsheet as required by the lab. Arrange ownership and continuity before the deployment owner leaves.

## Prepare an EHSA review snapshot

1. Review inventory, including full building-room values such as `66-347` or `NW14-4104`. A snapshot applies to one PI; resolve mixed PI values first.
2. Open **Export settings**. Enter the PI's **Kerberos username** in **B2**, **last name** in **B3**, and **first name** in **B4**. Use the username without `@mit.edu`. The app does not infer these details from a label or split a display name.
3. In the bookmarked script editor, run **prepareEhsaImport**. Follow the execution result and **Export review** instructions. Correct any reported inventory row issues and rerun. No export is created while any inventory record fails validation; no records are silently dropped.
4. If confirmations are needed, review each reason in **Export review** and tick **Confirmed** only after resolving it. Keep warning keys, IDs and fingerprints unchanged, then run **prepareEhsaImport** again. Changed inventory records or PI settings need new confirmations.
5. For a missing CAS, confirm only if **no CAS number exists** for that substance. An unreadable label or unknown CAS is insufficient: consult the SDS or EHS. For `fl oz` or `gal`, acknowledge that the template's generic unit code still needs live importer review. Without required confirmations, no export is created.
6. After all checks pass, open the new **EHSA export** snapshot tab. Each run creates a new snapshot, preserving the working inventory and earlier exports. Later scans do not update an older snapshot.
7. Review it with your EHS coordinator against the [official MIT import template](https://ehs.mit.edu/wp-content/uploads/MITEHS_Chemical_Import_Template.xlsm). Follow their instructions for copying into the official workbook or using an authorized importer. The generated tab is not the original macro-enabled MIT workbook; live EHSA acceptance has not been tested.

The snapshot preserves the template's exact 27-column order and second row of import keys. It uses amount **per container** and separate container count, maps state-specific units without converting quantities, and formats included dates as `MM/DD/YYYY`. Supplier names go in comments rather than vendor-code fields. Unsupported `m³` blocks export. No-CAS and generic-unit confirmations are noted in comments. See [exact mappings](EHSA_EXPORT_MAPPING.md).

This prepares a review snapshot. It does not upload to EHSA or submit Atlas Annual Chemical Reporting.

## Move from the earlier connector

This section applies to the earlier connector that requested all spreadsheets, not to a lab that is already using the working per-file connector.

If you have not saved inventory yet, cancel the old consent prompt and use the new standalone project above. Keep or remove the unused blank spreadsheet according to your preference.

If the old connector already holds inventory:

1. Preserve it and finish or reconcile pending phone saves against their original destination before changing connections. Pause new scanning during migration.
2. Create and authorize the new standalone connector. It creates its own spreadsheet; inserting an old Sheet ID into properties does not grant access under the narrower permission.
3. Copy reviewed inventory rows into the new **Chemical inventory** tab, keeping the original headings, all 21 columns, stable Record IDs and values intact. Do not copy secrets, formulas or the old script. Check row counts and representative fields with the lab owner.
4. Enter the new URL and token on each phone. Check the returned Sheet link and verify one reviewed record and its retry before resuming work.
5. After migration is verified and the old connection is no longer needed, archive the old deployment. You may then remove that old project's authorization in your [Google Account connections](https://myaccount.google.com/connections). Revoking old access is separate from editing a manifest. Keep the old inventory as required by your lab.

## Troubleshooting

| Result | What to check |
| --- | --- |
| Consent still asks for all spreadsheets or HTML content | Cancel. Use a new standalone project with both updated files and only `drive.file`. Previously granted permissions are not removed merely by changing source. |
| `Drive is not defined`, `Sheets is not defined`, or API disabled | Confirm **Drive v3** and **Sheets v4** appear under Services with identifiers **Drive** and **Sheets**. With a standard Cloud project, have its administrator enable both APIs. |
| Old configuration detected | Follow migration steps. The new scope cannot adopt an arbitrary old spreadsheet by ID. |
| Creation interrupted / recovery required | Follow the editor error instructions and locate any spreadsheet already created before retrying. Do not clear configuration blindly. |
| Invalid connection token | Copy **INVENTORY_TOKEN** from **Project Settings → Script properties**, not a Parley key. |
| “The worksheet did not confirm the request” during Check connections | Run the [read-only worksheet diagnostic](WORKSHEET_TROUBLESHOOTING.md) in the existing standalone script to expose the failing Google API step. |
| An earlier installation has consent granted, but both Drive and Sheets cannot find its file | For a confirmed empty inventory, see [staged empty-worksheet recovery](EMPTY_WORKSHEET_RECOVERY.md). Fresh installations already use the working Drive creation route above. Preserve any existing inventory before considering a replacement. |
| Sign-in page or HTML response | Check `/exec`, **Execute as: Me**, **Who has access: Anyone**, and the owner's authorization. |
| Inventory headers changed / tab missing | Restore the original tab and headers without deleting rows or IDs. |
| Worksheet busy or timeout | Retry the same pending record. Its stable ID prevents a second append after a lost response. |
| Invalid CAS | Check the label/SDS. A checksum alone does not verify chemical identity. |
| Record ID conflict | The stored row differs from the retry or that ID appears more than once. Ask the worksheet owner to reconcile it. Do not generate a new ID just to force a save. |
| Quota or service error | Check **Executions** for deployment health. Do not log request bodies, photos or tokens. |

## Maintainer verification

Run `node --test sheets/connector.test.cjs` for local mocked checks. They create no Google resources. A permitted deployment, inspection of its actual Google consent screen, and an end-to-end phone/Sheet check remain necessary before lab use. See [validation notes](VALIDATION.md).
