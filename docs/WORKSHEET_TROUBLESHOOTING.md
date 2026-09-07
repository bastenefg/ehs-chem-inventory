# Diagnose a worksheet connection failure

Use this with the newer **standalone connector that creates its own spreadsheet**, when the Android app's **Check connections** button reports “The worksheet did not confirm the request.” This is a worksheet check, separate from the Parley model or label scan. It does not send an inventory record.

That message means the app received a JSON response without a successful confirmation and could not recognize its error code. In the supplied connector, an unexpected Google service exception returns `internal_error`; the original error is hidden. The message alone cannot establish the cause.

## Run the diagnostic

1. Open the **existing Apps Script project** used by the app. Sign in as the administrator who initialized and deployed that connector.
2. In **Editor**, click **+** beside **Files**, choose **Script**, and name the new file **Diagnose**. Replace its starter text with the complete contents of [sheets/Diagnose.gs](../sheets/Diagnose.gs). Keep the existing **Code.gs** and manifest.
3. Save. Select **diagnoseInventoryConnection** in the function selector beside **Run**, then click **Run**. There is no need to redeploy for this editor check.
4. Copy the line beginning **RESULT** from **Execution log** to the person helping you. It identifies the failing stage and its error, or reports **EDITOR_OK**. The helper redacts stored credentials, the Sheet ID, URLs and email addresses from error messages. Check the copied text before sharing; do not include Script properties, tokens or unrelated logs.

The diagnostic reads configuration, spreadsheet metadata and the header row, then tests the supplied connector's `ping` handler locally. It does not append a record, change a token, reinitialize the spreadsheet, write properties or call Parley. It uses the connector's existing `drive.file` permission.

## Interpret the result

| Failing check | Meaning and next step |
| --- | --- |
| Configuration | Required properties are missing or inconsistent. Share the diagnostic result before changing properties or initializing again; an existing worksheet may already contain inventory. |
| Advanced Sheets service | Confirm **Sheets** appears under **Services** in the editor. The supplied manifest enables Google Sheets API v4. For a standard Google Cloud project, its administrator must also enable the Google Sheets API. [Google's service setup](https://developers.google.com/apps-script/guides/services/advanced). |
| Spreadsheet metadata | The owner's API request could not read the configured spreadsheet. The sanitized Google error should distinguish authorization, API access, missing-file and quota problems. Access through `drive.file` is supported by this endpoint; do not broaden permissions based only on the generic app message. [Google's API reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get). |
| Inventory headers | Reading the header row failed, or the tab/column names differ from the connector's expected layout. Share the result before editing headers; preserve existing rows and Record IDs. |
| Local ping | The current editor code did not return the expected successful response. Share the reported code; this check uses the configured token internally without printing it. |
| All checks pass | The current source can read the worksheet as the signed-in editor user. This does **not** verify the phone's URL/token, the deployed code version, the deployment's execution identity, or public access to the endpoint. Follow the checks below. |

## If the editor passes but the phone still fails

1. Open **Deploy → Manage deployments** in this same project. Select the web-app deployment used by the phone. Confirm its **Web app URL** ends in `/exec` and matches the app's connector URL.
2. Check **Execute as: Me** uses the administrator who initialized the worksheet. The app's token-based setup requires **Who has access: Anyone**, if allowed by your institution. Keep the spreadsheet's sharing restricted. [Google's web-app execution settings](https://developers.google.com/apps-script/guides/web).
3. If the deployment has older code, select **Edit → New version → Deploy** for that existing deployment. Keep its URL. Saving **Code.gs** alone does not update a versioned `/exec` deployment. [Google's deployment guide](https://developers.google.com/apps-script/concepts/deployments).
4. Run **Check connections** again. If it still fails, share the **RESULT** line and the exact app message. A successful editor diagnostic narrows the problem; it is not proof that the deployed endpoint works.

## D03: “Requested entity was not found”

This result means the Advanced Sheets metadata request cannot access the spreadsheet identified by `INVENTORY_SHEET_ID`. The diagnostic has already validated that the saved ID and URL agree. It fails before checking headers or writing inventory. Changing the Parley model or redeploying the same source will not repair this editor-side failure.

“Not found” can mean a file is unavailable to the requesting account/app, as well as a missing file. It is not proof that inventory was deleted. The connector uses `drive.file`, so opening a file in a browser and allowing this script to use that file are separate checks. [Google's file-access error guidance](https://developers.google.com/workspace/drive/api/guides/handle-errors), [per-file authorization](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

1. In **Project Settings → Script properties**, open the link stored as **INVENTORY_SHEET_URL** using the same Google account as the script editor. Do not share **INVENTORY_TOKEN**.
2. Check whether it opens the expected inventory, a different sheet, or a missing/access-denied page. If it is in Trash, restore the original file using its owner's account. If the browser reports access denied, check that you are using the initializing administrator's account and ask the owner to restore access where appropriate.
3. Confirm that **this exact Apps Script project** created the sheet through `initializeInventory`. A Sheet ID copied from an earlier project does not itself grant this project per-file access. If the original project is still available, diagnose it using the original administrator account. Do not replace the current ID with a different sheet's ID as a shortcut.
4. If the expected sheet opens and this exact project created it, run the existing diagnostic once in a **fresh private/incognito window**, signed in only to the account that initialized the connector. Google documents that multiple simultaneous Google sign-ins are unsupported for Apps Script and can cause access problems. This checks account selection; it does not prove that multiple sign-ins caused the metadata error. [Google's account troubleshooting](https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts).
5. If the same error persists, check whether its **Google Cloud project** or execution account changed after initialization. Switching Cloud projects changes authorization and requires reauthorization; it should not be used as a troubleshooting shortcut. [Google's Cloud-project guidance](https://developers.google.com/apps-script/guides/cloud-platform-projects).

Report the browser result and whether the project/properties were copied before choosing a recovery. Preserve existing rows and pending phone records. Do not clear Script properties, rotate the token, broaden OAuth scopes, or create a replacement worksheet merely in response to this error. Re-running initialization with the same inaccessible configuration does not restore its access.

## Persistent D03: compare consent, Drive and Sheets access

Use this when the expected sheet opens, this same project created it, and the diagnostic still fails in a private window. A successful original initialization means the connector's metadata and header reads worked at that time. The remaining issue needs a current access check; the D03 message does not establish why access changed.

1. In the **existing script project**, choose **Services → + → Drive API**, select **v3**, keep the identifier **Drive**, and click **Add**. Leave the existing **Sheets** service enabled. This adds the Drive metadata API used by the check; keep the manifest's **oauthScopes** exactly `https://www.googleapis.com/auth/drive.file`. The existing scope supports this read. In a default Cloud project, Apps Script enables the corresponding API when the service is added. [Google's advanced-service setup](https://developers.google.com/apps-script/guides/services/advanced), [Drive metadata authorization](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get).
2. Add a **Script** file named **CheckAccess**, paste [sheets/CheckAccess.gs](../sheets/CheckAccess.gs), and save. Keep **Code.gs**, **Diagnose.gs** and the existing Script properties.
3. Select **checkInventoryFileAccess**, then **Run**. Copy the line beginning **RESULT ACCESS**. It contains consent status, a comparison of the configured ID, file-type and access flags, and sanitized error messages. It does not print IDs, credentials, filenames, inventory or account details. No redeployment is needed for this editor check.

The check reads metadata from Drive and Sheets separately, including when one fails. It does not write to the worksheet, grant file access, change Script properties, create a spreadsheet, revoke consent or call Parley. Adding the Drive service is configuration; it is not proof that the original connection problem is repaired. An all-successful metadata report still needs **diagnoseInventoryConnection** and the app's **Check connections** to verify the header and deployed protocol checks.

If the report explicitly shows **missing scope consent**, the supplied **authorizeInventoryFileAccess** function asks Google for the existing `drive.file` scope using `ScriptApp.requireScopes`, then runs the access check. Choose that function only for missing consent. If Google pauses execution for authorization, complete the per-file consent and run it again. This function cannot renew an individual file grant when scope consent is already present. [Google's granular consent methods](https://developers.google.com/apps-script/reference/script/script-app#requirescopesauthmode,-oauthscopes), [consent status](https://developers.google.com/apps-script/reference/script/authorization-info).

Drive's `isAppAuthorized` flag reports whether the file was created or opened by the requesting app. A Drive access-denied/not-found response may prevent retrieving this flag, so it remains **unknown**, not false. A further 404 alone does not distinguish lost app authorization from every other access issue. Report the combined result before selecting a recovery. [Google's file authorization field](https://developers.google.com/workspace/drive/api/reference/rest/v3/files#File).

If scope consent is already granted and both APIs still cannot access the file, calling **authorizeInventoryFileAccess** again does not grant access to that individual file. For the pilot's confirmed **empty** inventory, use the [staged empty-worksheet recovery](EMPTY_WORKSHEET_RECOVERY.md). It prepares and verifies one replacement before changing the active destination. For a sheet with inventory, preserve the existing data and arrange migration or a supported file-selection flow first.

## Local verification

Run `node --test sheets/diagnose.test.cjs` for isolated mocked checks. These verify diagnostic stages, redaction and absence of writes against the supplied connector. They do not validate a live Google deployment.
