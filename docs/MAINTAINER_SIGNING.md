# Maintainer signing and key backup

Lab users only need the [Android installation guide](ANDROID_INSTALL.md). These instructions are for the publisher of future APK updates.

## Existing release identity

The first public installer is 2.2.2, application ID `com.example.cheminventory`, version code 6. Keep that application ID, increase the version code for each update, and keep the same release key. Do not generate a replacement key to fix an installation conflict.

Public certificate SHA-256: `fb0291c575d1260c11eb9f83281c2fb8d7fd20886a054253cf1ccd8d41346b23`.

The maintainer's local checkout has `private/release-signing/ChemInventory-release.p12` (encrypted PKCS12 keystore), alias `cheminventory-release`, and `private/release-signing/signing-credential.xml` (Windows DPAPI-protected password). That directory is excluded from Git and restricted to the creating Windows user and SYSTEM. The password is random; no lab credential is used. The private key and password are never GitHub release assets or CI inputs.

## Back up before losing access to this computer

The current files are local storage, **not an off-device backup**. Save the encrypted `.p12` in a maintainer-controlled secure backup and save its password separately in a password manager. A copy of `signing-credential.xml` alone cannot unlock the key on another Windows account/computer because DPAPI binds it to this Windows identity. Losing both usable credentials and the key prevents compatible updates to installed APKs. See [Android's signing documentation](https://developer.android.com/studio/publish/app-signing).

On the original Windows account, this PowerShell command copies the password to the clipboard without printing it. Run it yourself only when ready to put it in your password manager, and clear the clipboard afterward (including clipboard history if enabled):

```powershell
$signingCredential = Import-Clixml -LiteralPath ./private/release-signing/signing-credential.xml
Set-Clipboard -Value $signingCredential.GetNetworkCredential().Password
```

After saving it in your password manager, run:

```powershell
Set-Clipboard -Value ''
$signingCredential = $null
```

Verify your secure backup can unlock a copy of the keystore before relying on it. Do not put signing material in Git, issues, chat messages, screenshots, or public build logs. Moving to another computer requires both the backed-up keystore and the transferable password. Import that password through `Get-Credential -UserName cheminventory-release` and export the resulting credential to a private XML file under the new account; do not write the password in a command argument or script.

## Build and sign an update locally

Use a reviewed source commit and complete relevant tests. CI compiles an unsigned release and never receives the signing key. On Windows with Android Studio installed:

```powershell
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
./gradlew.bat :app:assembleRelease :app:testDebugUnitTest :app:lintDebug
./scripts/Sign-Release.ps1 `
  -AndroidSdk "$env:LOCALAPPDATA/Android/Sdk" `
  -KeystorePath ./private/release-signing/ChemInventory-release.p12 `
  -CredentialPath ./private/release-signing/signing-credential.xml `
  -OutputApk ./dist/ChemInventory-VERSION.apk
```

Replace `VERSION` with the actual app version. The helper aligns the APK, signs it using a temporary process environment variable, verifies signatures and ZIP alignment, and reports the public certificate and file hash. It refuses to overwrite an existing output. It does not create a key or publish anything. Android Studio's signed-APK wizard can also use the same keystore and alias.

Before publishing, confirm the certificate matches the fingerprint above, the APK's version matches the source commit, and its manifest is not debuggable. Check every bundled native library's ELF load-segment alignment as well as ZIP alignment; a successful `zipalign` check alone does not prove 16 KB compatibility. Test installing and opening the final signed APK on a disposable emulator, including an update with the same key. Publish the source commit, APK SHA-256, certificate SHA-256, install instructions, and actual test limits in the GitHub Release. Never replace a published version's APK silently.
