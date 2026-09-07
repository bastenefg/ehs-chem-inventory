package com.example.cheminventory

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URI
import java.util.Base64
import java.util.concurrent.TimeUnit

/**
 * OpenAI-compatible Parley adapter. Confirm the model supports images in MIT's authenticated docs.
 * Keys stay on the device and are sent only to the approved HTTPS Parley API host.
 * All methods block; invoke them on Dispatchers.IO.
 */
class InventoryApi {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .callTimeout(120, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()

    fun testParley(settings: LabSettings): List<String> {
        val request = parleyRequest(settings, "models").get().build()
        val json = executeJson(request, "Parley")
        val array = json.optJSONArray("data")
            ?: throw InventoryApiException("Parley did not return an OpenAI-compatible model list. Confirm the API base URL in MIT's Parley documentation.")
        return (0 until array.length()).mapNotNull {
            array.optJSONObject(it)?.optString("id")?.trim()?.takeIf(String::isNotEmpty)
        }.distinct().sorted().also {
            if (it.isEmpty()) throw InventoryApiException("No models are available for this Parley key. Check your Parley account permissions.")
        }
    }

    fun analyze(settings: LabSettings, imageFile: File): InventoryRecord {
        require(settings.parleyModel.isNotBlank()) { "Choose an image-capable Parley model in setup." }
        require(imageFile.isFile && imageFile.length() in 1..8_000_000L) { "Choose a readable label photo smaller than 8 MB." }
        val encoded = try { Base64.getEncoder().encodeToString(imageFile.readBytes()) }
            catch (_: IOException) { throw InventoryApiException("The label photo could not be read. Try taking another photo.") }
        val body = buildScanRequest(settings, encoded)
        val json = executeJson(parleyRequest(settings, "chat/completions")
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE)).build(), "Parley",
            scanOptimizationActive = usesFastScan(settings))
        return parseScanResponse(settings, json)
    }

    fun testSheet(settings: LabSettings): String = sheetUrl(sheetRequest(settings, "ping"))

    /** Run before journaling a send attempt; this method does not access the network. */
    fun checkAppendReady(settings: LabSettings, record: InventoryRecord) {
        require(validateRecord(record).isEmpty()) { "Review and complete all required inventory fields before sending." }
        validateAppendSettings(settings, record)?.let { throw InventoryApiException(it, definitelyNotSaved = true) }
        require(sheetPayload(settings, "append", record.copy(syncState = "syncing")).toString().toByteArray(Charsets.UTF_8).size <= 65_536) {
            "This record is too large for the worksheet. Shorten the label transcription or notes before sending."
        }
    }

    fun append(settings: LabSettings, record: InventoryRecord): String {
        checkAppendReady(settings, record)
        val json = sheetRequest(settings, "append", record)
        if (json.optString("recordId") != record.id) {
            throw InventoryApiException("The worksheet did not confirm this record's ID. Your local record is retained; retry with the same record.")
        }
        val url = sheetUrl(json)
        if (settings.sheetUrl.isNotBlank() && sheetId(settings.sheetUrl) != sheetId(url)) {
            throw InventoryApiException("The connection returned a different worksheet. Check the lab setup before retrying this record.")
        }
        return url
    }

    private fun parleyRequest(settings: LabSettings, route: String): Request.Builder {
        require(isValidParleyBaseUrl(settings.parleyBaseUrl)) { "Use the HTTPS Parley API URL at parley.api.mit.edu without a query or credentials." }
        val key = settings.parleyApiKey.trim()
        require(key.isNotBlank() && key.all { it.code in 33..126 }) { "Enter a valid Parley API key in setup." }
        return Request.Builder().url("${settings.parleyBaseUrl.trim().trimEnd('/')}/$route")
            .header("Authorization", "Bearer $key").header("Accept", "application/json")
    }

    private fun sheetRequest(settings: LabSettings, action: String, record: InventoryRecord? = null): JSONObject {
        val endpoint = normalizedSheetEndpoint(settings.sheetEndpoint)
        require(settings.sheetToken.trim().length in 1..512) { "Enter a valid worksheet connection token in setup." }
        val body = sheetPayload(settings, action, record)
        val request = Request.Builder().url(endpoint).header("Accept", "application/json")
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE)).build()
        val json = executeJson(request, "Worksheet", allowGoogleContentRedirect = true)
        if (json.opt("ok") != true) {
            val code = json.optString("code")
            throw InventoryApiException(sheetError(code), definitelyNotSaved = code in setOf("unauthorized", "validation_error", "busy", "configuration_error"))
        }
        return json
    }

    private fun sheetPayload(settings: LabSettings, action: String, record: InventoryRecord?): JSONObject =
        JSONObject().put("action", action).put("token", settings.sheetToken.trim()).apply {
            if (record != null) put("record", record.toJson().apply { remove("destinationEndpoint") })
        }

    private fun sheetUrl(json: JSONObject): String {
        val url = json.optString("sheetUrl").trim()
        if (!isValidSheetUrl(url)) throw InventoryApiException("The worksheet connection did not return a valid Google Sheet URL. Check its deployment and setup.")
        return "https://docs.google.com/spreadsheets/d/${sheetId(url)}/edit"
    }

    private fun sheetId(url: String): String {
        if (!isValidSheetUrl(url)) throw InventoryApiException("The saved worksheet URL is invalid. Test the worksheet connection again.")
        return URI(url.trim()).path.split('/')[3]
    }

    private fun executeJson(request: Request, service: String, allowGoogleContentRedirect: Boolean = false, scanOptimizationActive: Boolean = false): JSONObject {
        try {
            var current = request
            repeat(3) { attempt ->
                client.newCall(current).execute().use { response ->
                    if (response.code in listOf(302, 303) && allowGoogleContentRedirect && attempt < 2) {
                        val location = response.header("Location")
                        val uri = runCatching { URI(location.orEmpty()) }.getOrNull()
                        if (uri?.scheme != "https" || uri.host != "script.googleusercontent.com" ||
                            uri.rawUserInfo != null || uri.rawFragment != null || (uri.port != -1 && uri.port != 443)
                        ) throw InventoryApiException("The worksheet requires a sign-in or has an unexpected redirect. Check the Apps Script deployment access setting.")
                        // Apps Script ContentService returns a one-time Google URL. Do not forward the
                        // original POST body or any credential headers to that URL.
                        current = Request.Builder().url(location!!).get().header("Accept", "application/json").build()
                    } else {
                        if (!response.isSuccessful) {
                            if (scanOptimizationActive && response.code in listOf(400, 422)) {
                                throw InventoryApiException("Parley rejected the scan request. If this model supports images, turn off Fast scan in setup and retry; the gateway may not support its speed settings.")
                            }
                            throw InventoryApiException(httpError(service, response.code))
                        }
                        return parseResponse(response, service)
                    }
                }
            }
            throw InventoryApiException("The worksheet returned too many redirects. Check the deployment URL.")
        } catch (error: InventoryApiException) {
            throw error
        } catch (_: IOException) {
            throw InventoryApiException("$service could not be reached. Check your connection and try again; your local records are kept.")
        } catch (_: Exception) {
            throw InventoryApiException("$service returned an unexpected response. Check setup and try again; your local records are kept.")
        }
    }

    private fun parseResponse(response: Response, service: String): JSONObject {
        val source = response.body?.source() ?: throw InventoryApiException("$service returned an empty response.")
        source.request(MAX_RESPONSE_BYTES + 1)
        if (source.buffer.size > MAX_RESPONSE_BYTES) throw InventoryApiException("$service returned an unexpectedly large response.")
        val text = source.readUtf8()
        return try { JSONObject(text) }
            catch (_: Exception) { throw InventoryApiException("$service did not return JSON. Check the API URL, deployment, and access settings.") }
    }

    private fun httpError(service: String, code: Int): String = when (code) {
        401 -> "$service rejected the credentials. Check the key or connection token in setup."
        403 -> "$service denied access. Check account permissions and deployment access settings."
        404 -> "$service endpoint was not found. Check the configured API URL."
        429 -> "$service is rate limited. Wait a moment before trying again."
        in 300..399 -> "$service redirected the request. Check the configured API URL."
        in 500..599 -> "$service is temporarily unavailable. Try again later; your local records are kept."
        else -> "$service could not complete the request (HTTP $code). Check setup and the selected model."
    }

    private fun sheetError(code: String): String = when (code.lowercase()) {
        "unauthorized", "invalid_token" -> "The worksheet connection token was rejected. Check it in lab setup."
        "validation", "validation_error", "invalid_record" -> "The worksheet rejected an incomplete or invalid record. Check all review fields."
        "busy", "lock_timeout" -> "The worksheet is busy. Retry this same record in a moment."
        "id_conflict", "record_conflict" -> "This record ID is already associated with different data. Check the worksheet before retrying."
        "configuration_error" -> "The worksheet connector is not configured. Complete its setup and deployment in Google Apps Script."
        else -> "The worksheet did not confirm the request. Check the connection and deployment; your local record is retained."
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val MAX_RESPONSE_BYTES = 2_000_000L
    }
}

class InventoryApiException(message: String, val definitelyNotSaved: Boolean = false) : IOException(message)
