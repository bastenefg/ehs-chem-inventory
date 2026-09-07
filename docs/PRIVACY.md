# How this lab inventory tool handles data

This describes the supplied version 2.2.2 Android app and updated per-lab connector. It is a lab-developed tool, not an official MIT EHS service. Each deploying lab controls its accounts, sharing, retention and support arrangements; the lab owner should provide reps with a contact before rollout.

| Data | Where it goes or stays |
| --- | --- |
| Label photograph | The phone resizes and re-encodes it without original metadata, then sends it to the configured MIT Parley endpoint for extraction. The app attempts to remove its temporary images after the scan; an interrupted process or failed deletion can leave a cached copy. A photo imported from your library remains in your library. Parley's own processing and retention rules apply. |
| Chemical details, transcription and review metadata | Stored as local records on the phone. Reviewed records selected for saving are sent to the lab's Apps Script connector and appended to its Google Sheet. Google and the lab's account policies govern cloud storage. |
| Parley API key | Entered by its owner and stored in encrypted app settings backed by Android Keystore. Sent only to the approved HTTPS API host `parley.api.mit.edu`; Parley redirects are not followed. Not sent to the Sheets connector or stored in the worksheet. |
| Lab connection token | Stored in the script's Script properties and encrypted settings on each configured phone. Sent in the body of connector requests. Not printed in the connector's logs or written into spreadsheet cells by this code. |
| PubChem lookup | When automatic lookup is enabled (the default), a missing CAS triggers a public PubChem query after scanning, reopening a draft or editing its chemical name/composition. Typing is briefly debounced. The manual lookup button uses the same service. Only the chemical name is sent; no photograph, transcription, PI, room or credentials are included. No key is required. Successful results are cached in memory for 15 minutes, up to 32 queries. A single eligible match fills the draft automatically; its CAS and source link are saved locally and included with a reviewed worksheet save. Ambiguous matches remain for selection. |
| PI and location details | Stored with inventory records and shared with people authorized to read the lab's Sheet. The app does not look up someone's personal identity or contact details. |

The local inventory journal is stored in the app's private storage; it is not separately encrypted by this app. Settings and inventory files are excluded from Android backup. Protect phones using your lab's normal device controls. Uninstalling or clearing app data removes local settings and records, including unsent records, but does not remove copies already saved in Google Sheets.

The connector requests Google's per-file `drive.file` permission. It uses the spreadsheet created during initialization. Its HTTP endpoint supports connection checks and append-only reviewed saves; it does not return inventory rows or offer a delete operation. Someone with both the URL and lab token can append records, so keep the token private. Spreadsheet access and script-project access are separate: trusted script editors can read the token and change the code.

The supplied code does not add advertising or analytics services. It does not intentionally log request bodies, tokens or photos. Google, Parley and Android can retain operational information under their own service policies. This project does not control those services' retention or claim that they store no data.

The lab owner can remove collaborators, rotate the token, archive the connector deployment and manage worksheet records under the lab's retention requirements. Removing a phone's connection does not delete already-shared rows. Do not delete inventory needed for institutional records without resolving the lab's retention requirements.

This file can accompany the pilot package for transparency. It is not a hosted OAuth privacy-policy URL and does not by itself remove Google's consent notices. See [permissions and consent](GOOGLE_PERMISSIONS.md) and [setup instructions](GOOGLE_SHEETS_SETUP.md).
