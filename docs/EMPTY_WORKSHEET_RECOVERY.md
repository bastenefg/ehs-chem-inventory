# Recover an inaccessible, empty worksheet

**New installation?** Follow [the normal setup guide](GOOGLE_SHEETS_SETUP.md), which now creates the spreadsheet through Drive directly. **Already working after recovery?** Keep the current worksheet and connection; do not run recovery again. This page is only for an earlier installation with an inaccessible, empty worksheet.

Use this only when the lab owner has confirmed that the original **Chemical inventory** sheet contains **no chemical records**, the saved file opens in the browser, and the access report shows consent granted but both Drive and Sheets cannot find that file. The owner confirmed those conditions for the current pilot.

The recovery creates a replacement through the Advanced Drive service using the existing `drive.file` permission. It preserves the original file, connector URL and token. Preparing the replacement does not change the active destination; a second owner-run function verifies access and an empty inventory before switching. This recovery worked in the pilot; it does not establish why access to the original file failed.

## Install and prepare

1. Finish this recovery before resuming scans or retrying pending saves. Keep any phone records and their IDs.
2. In the **existing Apps Script project**, keep **Code.gs** and its Script properties. Under **Services**, confirm **Drive API v3** is available as **Drive**, and **Google Sheets API v4** as **Sheets**. The previous access check already used these services. Keep the manifest's sole OAuth scope as `https://www.googleapis.com/auth/drive.file`.
3. Add a **Script** file named **RecoverEmptyWorksheet**. Paste the complete contents of [sheets/RecoverEmptyWorksheet.gs](../sheets/RecoverEmptyWorksheet.gs), then save.
4. Select **prepareEmptyWorksheetRecovery** and click **Run**. It creates at most one candidate, initializes its inventory/export-settings tabs and checks access. Open the candidate worksheet link printed on success. The app still points to the original worksheet at this stage.

Creation and access use Google's supported [Advanced Drive service](https://developers.google.com/apps-script/advanced/drive) and [per-file scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). A marker is saved before creation to guard against accidentally creating another file after a lost response.

## Verify and activate

1. Confirm that the new worksheet is the intended replacement and that **Chemical inventory** contains the original 21 headings with no inventory rows. Leave its default **Export settings** unchanged until activation.
2. Back in the editor, select **activateEmptyWorksheetRecovery** and click **Run**. This is a separate execution: it rechecks Drive access, the Sheets metadata, both tab layouts and the empty inventory before changing the active Sheet ID/URL. The original ID/URL are retained in the recovery property. The token is retained and never printed.
3. Run **diagnoseInventoryConnection**. It should report **EDITOR_OK**. Then run **Check connections** in the Android app, confirm that its returned link opens the new worksheet, and save setup. These live checks are necessary; local tests do not establish that your Google deployment works. No APK update or redeployment is needed solely for this property change in the existing connector.
4. Re-enter any PI information needed in **Export settings** from the original file. Share the new worksheet with the lab reps who need access, keeping general access **Restricted**. The replacement does not inherit the old file's sharing settings.
5. Resume with one reviewed container and verify its row in the new worksheet. Preserve pending record IDs when retrying. Keep the original empty file until recovery is confirmed.

## If a step fails

The helper does not delete files, revoke consent, rotate the token, broaden permissions, or clear configuration. If candidate access or validation fails before activation, it leaves the original destination in place.

If preparation reports an uncertain creation result, keep **INVENTORY_EMPTY_RECOVERY** and report the error. A sheet might already exist even though Google did not return its ID; the helper blocks another creation rather than guessing. Do not clear the marker or manually substitute a Sheet ID.

If a candidate ID was captured, preparation can resume that same candidate. An initialized candidate is checked rather than rewritten. Re-running either function after completed activation does not create another worksheet or reset rows added later.

An uncertain configuration-write failure may require inspection of the saved recovery state before proceeding. The helper stops on an inconsistent state rather than overwriting it. Share its safe error message, not the token or all Script properties.

This helper is **not a migration tool for a worksheet containing inventory**. If chemical rows appear in either file before activation, stop and preserve them before choosing a migration procedure.

## Local checks

Run `node --test sheets/recover-empty.test.cjs` for the mocked recovery checks. They do not create Google files or establish live access. See [validation notes](VALIDATION.md) for the current combined checks.
