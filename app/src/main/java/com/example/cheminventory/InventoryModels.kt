package com.example.cheminventory

import java.net.URI
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

data class LabSettings(
    val labName: String = "",
    val pi: String = "",
    val room: String = "",
    val parleyApiKey: String = "",
    val parleyBaseUrl: String = "https://parley.api.mit.edu/v1",
    val parleyModel: String = "",
    val sheetEndpoint: String = "",
    val sheetToken: String = "",
    val sheetUrl: String = "",
    val fastScan: Boolean = true,
    val autoCasLookup: Boolean = true
)

data class InventoryRecord(
    val id: String = UUID.randomUUID().toString(),
    val createdAt: String = Instant.now().toString(),
    val pi: String = "",
    val room: String = "",
    val chemicalName: String = "",
    val amount: String = "",
    val unit: String = "",
    val physicalState: String = "",
    val containerCount: String = "1",
    val cas: String = "",
    val casUnavailableReason: String = "",
    val concentration: String = "",
    val supplier: String = "",
    val catalogNumber: String = "",
    val expiryDate: String = "",
    val notes: String = "",
    val labelText: String = "",
    val casSource: String = "",
    val reviewed: Boolean = false,
    val syncState: String = "draft",
    val syncedAt: String = "",
    val destinationEndpoint: String = ""
)

val supportedUnits = listOf("mg", "g", "kg", "µL", "mL", "L", "oz", "lb", "fl oz", "gal", "ft³", "m³")
val physicalStates = listOf("Solid", "Liquid", "Gas")

/** Checks syntax and checksum only; this does not establish chemical identity. */
fun isValidCas(value: String): Boolean {
    val cas = value.trim()
    if (!Regex("[0-9]{2,7}-[0-9]{2}-[0-9]").matches(cas)) return false
    val digits = cas.replace("-", "")
    val sum = digits.dropLast(1).reversed().mapIndexed { index, c -> (index + 1) * c.digitToInt() }.sum()
    return sum % 10 == digits.last().digitToInt()
}

fun validateRecord(record: InventoryRecord): Map<String, String> = buildMap {
    val textFields = mapOf(
        "id" to record.id, "createdAt" to record.createdAt, "pi" to record.pi, "room" to record.room,
        "chemicalName" to record.chemicalName, "amount" to record.amount, "unit" to record.unit,
        "physicalState" to record.physicalState, "containerCount" to record.containerCount,
        "cas" to record.cas, "casUnavailableReason" to record.casUnavailableReason,
        "concentration" to record.concentration, "supplier" to record.supplier,
        "catalogNumber" to record.catalogNumber, "expiryDate" to record.expiryDate,
        "notes" to record.notes, "labelText" to record.labelText, "casSource" to record.casSource,
        "syncState" to record.syncState, "syncedAt" to record.syncedAt
    )
    textFields.forEach { (field, value) ->
        val limit = when (field) { "labelText" -> 16_000; "notes" -> 4_000; else -> 512 }
        if (value.length > limit) put(field, "$field is too long; use at most $limit characters.")
        if (value.any { it.code in 0..8 || it.code == 11 || it.code == 12 || it.code in 14..31 || it.code == 127 }) {
            put(field, "$field contains unsupported control characters; remove them before sending.")
        }
    }
    if (!Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,127}").matches(record.id)) put("id", "This record does not have a valid stable ID.")
    if (runCatching { Instant.parse(record.createdAt) }.isFailure) put("createdAt", "This record does not have a valid creation timestamp.")
    if (record.pi.isBlank()) put("pi", "Enter the responsible PI or supervisor.")
    if (!Regex("^[A-Za-z0-9]+-[A-Za-z0-9-]+$").matches(record.room.trim())) {
        put("room", "Enter the full building-room location, such as N52-496.")
    }
    if (record.chemicalName.isBlank()) put("chemicalName", "Enter the chemical or product name.")
    val amount = record.amount.trim()
    if (!Regex("(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)").matches(amount) ||
        amount.toDoubleOrNull()?.let { it.isFinite() && it > 0 } != true
    ) put("amount", "Enter an amount greater than zero, using a decimal point.")
    if (record.unit !in supportedUnits) put("unit", "Choose an amount unit.")
    if (record.physicalState !in physicalStates) put("physicalState", "Choose Solid, Liquid, or Gas.")
    if (!Regex("[0-9]+").matches(record.containerCount.trim()) ||
        record.containerCount.trim().toIntOrNull()?.let { it in 1..1_000_000 } != true
    ) put("containerCount", "Enter a whole number of containers from 1 to 1,000,000.")
    if (record.cas.isBlank()) {
        if (record.casUnavailableReason.isBlank()) put("casUnavailableReason", "Explain why a CAS number is unavailable or not applicable.")
    } else if (!isValidCas(record.cas)) {
        put("cas", "Check the CAS number against the label or supplier SDS; its format or checksum is invalid.")
    }
    if (record.expiryDate.isNotBlank() && (!Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(record.expiryDate.trim()) ||
            runCatching { LocalDate.parse(record.expiryDate.trim()) }.isFailure)
    ) put("expiryDate", "Use a valid date in YYYY-MM-DD format, or leave it blank.")
    if (!record.reviewed) put("reviewed", "Verify the fields against the container label before sending.")
}

private fun secureUri(value: String): URI? = runCatching { URI(value.trim()) }.getOrNull()?.takeIf {
    it.scheme.equals("https", ignoreCase = true) && !it.host.isNullOrBlank() &&
        it.rawUserInfo == null && it.rawQuery == null && it.rawFragment == null &&
        (it.port == -1 || it.port == 443) && it.normalize().rawPath == it.rawPath
}

/** Send credentials only to the approved Parley API host, not other MIT-hosted sites. */
fun isValidParleyBaseUrl(value: String): Boolean {
    val uri = secureUri(value) ?: return false
    return uri.host.equals("parley.api.mit.edu", ignoreCase = true) &&
        !uri.rawPath.contains('%') && !uri.rawPath.contains('\\')
}

fun isValidSheetEndpoint(value: String): Boolean {
    val uri = secureUri(value) ?: return false
    return uri.host.equals("script.google.com", ignoreCase = true) &&
        Regex("/macros/s/[A-Za-z0-9_-]+/exec/?").matches(uri.rawPath)
}

fun normalizedSheetEndpoint(value: String): String {
    require(isValidSheetEndpoint(value)) { "Use the HTTPS Google Apps Script deployment URL ending in /exec." }
    val uri = URI(value.trim())
    return "https://script.google.com${uri.rawPath.trimEnd('/')}"
}

/** Validate locally before recording a send attempt, so a setup typo never locks a draft. */
fun validateAppendSettings(settings: LabSettings, record: InventoryRecord): String? {
    if (!isValidSheetEndpoint(settings.sheetEndpoint)) return "Use the HTTPS Google Apps Script deployment URL ending in /exec."
    if (settings.sheetToken.trim().length !in 1..512) return "Enter a valid worksheet connection token in lab setup."
    if (settings.sheetUrl.isNotBlank() && !isValidSheetUrl(settings.sheetUrl)) return "Test the worksheet connection again to restore its saved Google Sheet URL."
    if (record.destinationEndpoint.isNotBlank() && (!isValidSheetEndpoint(record.destinationEndpoint) ||
            normalizedSheetEndpoint(record.destinationEndpoint) != normalizedSheetEndpoint(settings.sheetEndpoint))
    ) return "This record belongs to a different worksheet. Restore its lab connection before retrying."
    return null
}

fun isValidSheetUrl(value: String): Boolean {
    val uri = secureUri(value) ?: return false
    return uri.host.equals("docs.google.com", ignoreCase = true) &&
        Regex("/spreadsheets/d/[A-Za-z0-9_-]+(?:/edit)?/?").matches(uri.rawPath)
}
