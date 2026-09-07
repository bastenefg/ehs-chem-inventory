# Google permissions and the consent screen

The per-lab connector uses a standalone Apps Script project with the Advanced Drive v3 and Sheets v4 services. Drive creates the native spreadsheet; Sheets prepares its tabs and reads/writes inventory. Its manifest requests only:

```text
https://www.googleapis.com/auth/drive.file
```

Google defines this as access to files created or explicitly used with the app. It is a recommended, non-sensitive, per-file scope. Drive file creation and Sheets operations support it. It is not account-wide spreadsheet access, nor an immutable permission tied to one particular file. This connector creates and records one dedicated spreadsheet and uses only that file. Enabling both advanced services does not add a second OAuth scope. [Google scope definitions](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive create authorization](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create), [Sheets update authorization](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).

## What changed

| Earlier connector | Updated connector |
| --- | --- |
| Bound to a manually created spreadsheet | Standalone project creates its dedicated spreadsheet |
| Broad `spreadsheets` scope for `SpreadsheetApp.openById` | `drive.file` through the Advanced Drive and Sheets services |
| HTML setup dialog and `script.container.ui` scope | No custom HTML, dialogs or spreadsheet menu |
| Token in a custom dialog | Token copied from Script properties, never printed in logs |
| Export prompts in dialogs | Export settings cells and per-record review checkboxes |
| Spreadsheet editors can access its bound script | Standalone script sharing is managed separately |

Adding `@OnlyCurrentDoc` to the old connector would not fix its web endpoint: active-document helpers are unavailable when a bound script runs as a web app, and `SpreadsheetApp.openById` requires the broad spreadsheet scope. The service change preserves the Android protocol with reduced access. [Bound-script restrictions](https://developers.google.com/apps-script/guides/bound), [openById authorization](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#openById(String)).

## What can still appear

Google still asks the owner to authorize the script. Google controls the exact wording, account selection, trust notices and administrator restrictions. The screenshot's missing privacy-policy/terms links are a separate branding issue; changing scopes does not add those links.

We include [a data-handling description](PRIVACY.md) for reps to read before setup. A local Markdown document does not populate Google's consent screen. To display public policy links and custom branding there, a maintainer would need an appropriately configured Cloud OAuth branding project, genuine hosted policy/contact pages and any domain or brand verification Google requires. That administrative work is outside this per-lab script change. Do not invent URLs or claim MIT approval. [Google brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).

Reps using the Android app do not authorize the script individually: the lab owner authorizes and deploys it, then gives reps the connection URL and token. Reading the spreadsheet in a browser is governed separately by its sharing settings.

The Drive-based creation and connection route was confirmed working in the pilot. Google can vary the consent screen by account and policy; verify its requested permissions during setup. If account-wide Sheets or HTML-dialog access is still requested, cancel and check that both updated files are installed in the new project.

Labs already connected successfully, including after empty-worksheet recovery, keep their current worksheet and credentials. They do not need to initialize or recover another file. The current [installation guide](GOOGLE_SHEETS_SETUP.md) uses Drive creation directly for new labs.
