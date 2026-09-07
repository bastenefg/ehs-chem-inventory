# Maintainer-only local signing. Never pass passwords on the command line.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$AndroidSdk,
    [Parameter(Mandatory)][string]$KeystorePath,
    [Parameter(Mandatory)][string]$CredentialPath,
    [Parameter(Mandatory)][string]$OutputApk,
    [string]$UnsignedApk = "$PSScriptRoot/../app/build/outputs/apk/release/app-release-unsigned.apk",
    [string]$BuildToolsVersion = '35.0.0'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') { throw 'This helper uses a Windows DPAPI-protected credential.' }
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to your Android Studio JDK first.' }
$signer = Join-Path $AndroidSdk "build-tools/$BuildToolsVersion/apksigner.bat"
$aligner = Join-Path $AndroidSdk "build-tools/$BuildToolsVersion/zipalign.exe"
$aapt = Join-Path $AndroidSdk "build-tools/$BuildToolsVersion/aapt2.exe"
foreach ($required in @($signer, $aligner, $aapt, $KeystorePath, $CredentialPath, $UnsignedApk)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing required file: $required" }
}
$destination = [IO.Path]::GetFullPath($OutputApk)
if (Test-Path -LiteralPath $destination) { throw 'Output already exists; choose a new path. Published APKs must not be silently replaced.' }
$manifest = (& $aapt dump badging $UnsignedApk 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the unsigned APK.' }
if ($manifest -notmatch "package: name='com.example.cheminventory'" -or
    $manifest -notmatch "sdkVersion:'26'" -or $manifest -match 'application-debuggable') {
    throw 'Unexpected app ID, minimum SDK, or debuggable APK. Build :app:assembleRelease first.'
}
$credential = Import-Clixml -LiteralPath $CredentialPath
if ($credential -isnot [System.Management.Automation.PSCredential] -or $credential.UserName -ne 'cheminventory-release') {
    throw 'Expected the maintainer signing credential for alias cheminventory-release.'
}
$outputDirectory = [IO.Path]::GetDirectoryName($destination)
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$aligned = Join-Path $outputDirectory ('.aligned-' + [Guid]::NewGuid().ToString('N') + '.apk')
$previousPassword = $env:CHEMINVENTORY_SIGNING_PASSWORD
try {
    & $aligner -P 16 -f 4 $UnsignedApk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    $env:CHEMINVENTORY_SIGNING_PASSWORD = $credential.GetNetworkCredential().Password
    & $signer sign --ks $KeystorePath --ks-key-alias cheminventory-release `
        --ks-pass env:CHEMINVENTORY_SIGNING_PASSWORD --key-pass env:CHEMINVENTORY_SIGNING_PASSWORD `
        --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false `
        --out $destination $aligned
    if ($LASTEXITCODE -ne 0) { throw 'Signing failed; do not distribute the output.' }
    $env:CHEMINVENTORY_SIGNING_PASSWORD = $previousPassword
    & $signer verify --verbose --print-certs --min-sdk-version 26 $destination
    if ($LASTEXITCODE -ne 0) { throw 'Signature verification failed; do not distribute the output.' }
    & $aligner -c -P 16 4 $destination
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed.' }
    $digest = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Output "APK: $destination"
    Write-Output "SHA256: $digest"
} finally {
    $env:CHEMINVENTORY_SIGNING_PASSWORD = $previousPassword
    if (Test-Path -LiteralPath $aligned) { Remove-Item -LiteralPath $aligned }
    $credential = $null
}
