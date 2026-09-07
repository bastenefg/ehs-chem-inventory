# Install ChemInventory on Android

You can install the app directly on an Android 8.0 or later phone. No computer, Android Studio or app build is required. This is a lab pilot, not an official MIT EHS application or a certified reporting system.

If ChemInventory is already installed, read [Already have a pilot copy installed?](#already-have-a-pilot-copy-installed) before continuing.

## Download and install

1. On your phone, open the [ChemInventory 2.2.2 release](https://github.com/bastenefg/ehs-chem-inventory/releases/tag/v2.2.2). Confirm the repository is **bastenefg/ehs-chem-inventory**.
2. Under **Assets**, tap **ChemInventory-2.2.2.apk**. You can also use this [direct APK download](https://github.com/bastenefg/ehs-chem-inventory/releases/download/v2.2.2/ChemInventory-2.2.2.apk). The **Source code** ZIP and TAR files are for developers; they are not installers.
3. Open the downloaded APK. If Android says this browser is not allowed to install apps, open **Settings** from that prompt and enable **Allow from this source** for the browser you used. Return to the installer and tap **Install**. If you opened the APK through a file manager, Android may show that app as the source instead.
4. After installation, turn that source's permission off again: **Settings → Apps → Special app access → Install unknown apps → your browser or file manager → Allow from this source: off**. Menu names vary by phone. This does not prevent ChemInventory from running. See [Google's installation guidance](https://support.google.com/pixelphone/answer/7391672?hl=en).
5. Open **ChemInventory**. Allow camera access when you want to photograph labels.

Keep Google Play Protect enabled. If your device administrator or Android security controls block installation, use your lab's supported installation process or contact its IT support; do not bypass those controls.

## Connect your lab

One lab owner follows the [Google Sheets setup guide](GOOGLE_SHEETS_SETUP.md) to create the lab's private worksheet. Each rep then opens **Lab setup** in the app and enters:

- Lab name, PI/supervisor and default building-room.
- Their own API key created through [MIT Parley](https://parley.mit.edu/), with an image-capable model available to their account.
- The connector URL and connection token supplied privately by the lab owner.

Tap **Check connections**, open the returned Sheet link to confirm the correct lab, then save the setup. Scan one label, review the extracted fields, and verify the saved row in the Sheet before starting an inventory session. See [scanning and CAS lookup](SCANNING_AND_CAS.md) and [data handling](PRIVACY.md).

The download contains no lab credentials. Never post your Parley key, connector token or private inventory in a GitHub issue.

## Already have a pilot copy installed?

The first public release uses a dedicated release signing key. Earlier locally shared debug APKs use a different key, so Android will reject an in-place update even when the public APK has a newer version number. An installation conflict is not a reason to remove your working copy immediately.

Keep the existing app until you have preserved its data and coordinated the change with your lab owner:

1. Review **Records** for pending sends and unfinished drafts. Send reviewed records and confirm their rows in the shared Sheet. Preserve any remaining drafts or failed records through your lab's private process before removing the old app; they are not automatically transferred to the public release.
2. Preserve the lab setup details and credentials in your lab's approved password manager or other private storage. The app excludes these files from Android backups, so a phone backup is not a migration plan.
3. Once the local data is preserved, coordinate replacement of the old app with the lab owner. Uninstalling erases that app's local records and settings. Installing the public APK afterward starts with an empty local history and requires setup again.

The shared Google Sheet and records already saved there are unaffected by replacing the phone app. Reuse the same connector URL and token. Do not create a new worksheet, rerun recovery, or rescan bottles whose rows are already saved merely to repopulate the phone's local history.

## Future updates

The app does not download updates automatically. Check [GitHub Releases](https://github.com/bastenefg/ehs-chem-inventory/releases) for a newer APK and read its release notes. Later compatible releases signed with the same public-release key can be installed over this copy while retaining its records and settings. Do not uninstall first. If Android reports a signature or package conflict, stop and check the release instructions or contact the maintainer.
