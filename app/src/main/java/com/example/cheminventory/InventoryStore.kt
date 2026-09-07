package com.example.cheminventory

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Private, crash-safe local storage. Neither credentials nor records enter Android backups. */
class InventoryStore(context: Context) {
    private val directory = context.noBackupFilesDir
    private val recordsFile = AtomicFile(File(directory, "inventory-records-v1.json"))
    private val settingsFile = AtomicFile(File(directory, "lab-settings-v1.enc"))
    private val keyAlias = "${context.packageName}.lab-settings.v1"

    fun loadRecords(): List<InventoryRecord> = synchronized(storeLock) {
        if (!exists(recordsFile)) return@synchronized emptyList()
        try {
            val envelope = JSONObject(recordsFile.openRead().bufferedReader(Charsets.UTF_8).use { it.readText() })
            check(envelope.getInt("version") == 1)
            val array = envelope.getJSONArray("records")
            val records = (0 until array.length()).map { recordFromJson(array.getJSONObject(it)) }
            check(records.map { it.id }.distinct().size == records.size)
            records
        } catch (_: Exception) {
            throw IllegalStateException("Local inventory could not be read. Existing data has been kept; do not clear app storage.")
        }
    }

    fun saveRecord(record: InventoryRecord) = synchronized(storeLock) {
        require(record.id.isNotBlank()) { "A record ID is required." }
        require(runCatching { Instant.parse(record.createdAt) }.isSuccess) { "A valid record creation time is required." }
        // Read before writing: damaged storage must never be replaced with an empty inventory.
        val records = loadRecords().toMutableList()
        val index = records.indexOfFirst { it.id == record.id }
        if (index < 0) records.add(0, record) else records[index] = record
        val json = JSONObject().put("version", 1).put("records", JSONArray().apply {
            records.forEach { put(it.toJson()) }
        })
        try {
            atomicWrite(recordsFile, json.toString().toByteArray(Charsets.UTF_8))
        } catch (_: Exception) {
            throw IllegalStateException("The inventory could not be saved on this device. Free storage space and try again.")
        }
    }

    fun loadSettings(): LabSettings = synchronized(storeLock) {
        if (!exists(settingsFile)) return@synchronized LabSettings()
        try {
            val encrypted = settingsFile.openRead().use { it.readBytes() }
            check(encrypted.size > 29 && encrypted[0].toInt() == 1)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getKey(create = false), GCMParameterSpec(128, encrypted.copyOfRange(1, 13)))
            val json = JSONObject(String(cipher.doFinal(encrypted.copyOfRange(13, encrypted.size)), Charsets.UTF_8))
            check(json.getInt("version") == 1)
            LabSettings(
                labName = json.getString("labName"), pi = json.getString("pi"), room = json.getString("room"),
                parleyApiKey = json.getString("parleyApiKey"), parleyBaseUrl = json.getString("parleyBaseUrl"),
                parleyModel = json.getString("parleyModel"), sheetEndpoint = json.getString("sheetEndpoint"),
                sheetToken = json.getString("sheetToken"), sheetUrl = json.getString("sheetUrl"),
                fastScan = json.optBoolean("fastScan", true), autoCasLookup = json.optBoolean("autoCasLookup", true)
            )
        } catch (_: Exception) {
            throw IllegalStateException("Lab settings could not be unlocked. Re-enter setup on this device. Local inventory has been kept.")
        }
    }

    fun saveSettings(settings: LabSettings) = synchronized(storeLock) {
        try {
            val json = JSONObject().put("version", 1).put("labName", settings.labName).put("pi", settings.pi)
                .put("room", settings.room).put("parleyApiKey", settings.parleyApiKey)
                .put("parleyBaseUrl", settings.parleyBaseUrl).put("parleyModel", settings.parleyModel)
                .put("sheetEndpoint", settings.sheetEndpoint).put("sheetToken", settings.sheetToken).put("sheetUrl", settings.sheetUrl)
                .put("fastScan", settings.fastScan).put("autoCasLookup", settings.autoCasLookup)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getKey(create = true))
            check(cipher.iv.size == 12)
            val encrypted = byteArrayOf(1) + cipher.iv + cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
            atomicWrite(settingsFile, encrypted)
        } catch (_: Exception) {
            throw IllegalStateException("Lab settings could not be securely saved on this device. Check available storage and try again.")
        }
    }

    private fun getKey(create: Boolean): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keyStore.getKey(keyAlias, null)
        if (existing is SecretKey) return existing
        check(create) { "The device encryption key is unavailable." }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build())
        }.generateKey()
    }

    private fun exists(file: AtomicFile) = file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()

    private fun atomicWrite(file: AtomicFile, data: ByteArray) {
        var stream: FileOutputStream? = null
        try {
            stream = file.startWrite()
            stream.write(data)
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }

    companion object { private val storeLock = Any() }
}

internal fun InventoryRecord.toJson(): JSONObject = JSONObject()
    .put("id", id).put("createdAt", createdAt).put("pi", pi).put("room", room)
    .put("chemicalName", chemicalName).put("amount", amount).put("unit", unit)
    .put("physicalState", physicalState).put("containerCount", containerCount).put("cas", cas)
    .put("casUnavailableReason", casUnavailableReason).put("concentration", concentration)
    .put("supplier", supplier).put("catalogNumber", catalogNumber).put("expiryDate", expiryDate)
    .put("notes", notes).put("labelText", labelText).put("casSource", casSource)
    .put("reviewed", reviewed).put("syncState", syncState).put("syncedAt", syncedAt)
    .put("destinationEndpoint", destinationEndpoint)

private fun recordFromJson(json: JSONObject): InventoryRecord = InventoryRecord(
    id = json.getString("id").also { check(it.isNotBlank()) },
    createdAt = json.getString("createdAt").also { Instant.parse(it) },
    pi = json.getString("pi"), room = json.getString("room"), chemicalName = json.getString("chemicalName"),
    amount = json.getString("amount"), unit = json.getString("unit"), physicalState = json.getString("physicalState"),
    containerCount = json.getString("containerCount"), cas = json.getString("cas"),
    casUnavailableReason = json.getString("casUnavailableReason"), concentration = json.getString("concentration"),
    supplier = json.getString("supplier"), catalogNumber = json.getString("catalogNumber"),
    expiryDate = json.getString("expiryDate"), notes = json.getString("notes"), labelText = json.getString("labelText"),
    casSource = json.getString("casSource"), reviewed = json.getBoolean("reviewed"),
    syncState = json.getString("syncState"), syncedAt = json.getString("syncedAt"),
    destinationEndpoint = json.getString("destinationEndpoint")
)
