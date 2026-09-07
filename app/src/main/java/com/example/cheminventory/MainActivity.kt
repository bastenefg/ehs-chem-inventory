package com.example.cheminventory

import android.app.Application
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import com.example.cheminventory.ui.theme.ChemInventoryTheme
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.time.Instant
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val model = ViewModelProvider(this)[InventoryViewModel::class.java]
        setContent { ChemInventoryTheme { InventoryApp(model) } }
    }
}

/** Operations survive rotation; records are journaled before transmission. */
class InventoryViewModel @JvmOverloads constructor(
    application: Application,
    private val findCas: (String) -> CasLookupResult = CasLookup()::lookup
) : AndroidViewModel(application) {
    private val store = InventoryStore(application)
    private val api = InventoryApi()
    private val jobs = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val disk = Mutex()
    var settings by mutableStateOf(LabSettings()); private set
    var setupDraft by mutableStateOf(LabSettings())
    var records by mutableStateOf<List<InventoryRecord>>(emptyList()); private set
    var current by mutableStateOf<InventoryRecord?>(null); private set
    var page by mutableStateOf("scan")
    var busy by mutableStateOf(""); private set
    var notice by mutableStateOf(""); private set
    var ready by mutableStateOf(false); private set
    var fatal by mutableStateOf(false); private set
    var models by mutableStateOf<List<String>>(emptyList()); private set
    var connectionMessage by mutableStateOf(""); private set
    var casLookup by mutableStateOf(CasLookupUiState()); private set
    var lastScanMessage by mutableStateOf(""); private set
    var lastScanRecordId by mutableStateOf(""); private set
    private var casJob: Job? = null
    private var casScheduleJob: Job? = null
    private var casGeneration = 0L

    init {
        jobs.launch {
            try {
                val loadedRecords = withContext(Dispatchers.IO) {
                    store.loadRecords().map {
                        if (it.syncState == "syncing") it.copy(syncState = "pending") else it
                    }
                }
                records = loadedRecords
                try { settings = withContext(Dispatchers.IO) { store.loadSettings() } }
                catch (_: Exception) {
                    notice = "Your inventory is intact, but lab settings could not be unlocked. Re-enter the lab connection and Parley key in Lab setup."
                }
                setupDraft = settings
                if (settings.pi.isBlank()) page = "setup"
                ready = true
            } catch (_: Exception) {
                fatal = true
                notice = "Your saved data could not be opened. No files have been replaced. Restart the app or contact the app maintainer before continuing."
            }
        }
    }
    fun dismissNotice() { notice = "" }
    fun report(message: String) { notice = message }

    fun saveSettings(value: LabSettings) {
        jobs.launch {
            busy = "Saving lab setup…"
            try {
                disk.withLock { withContext(Dispatchers.IO) { store.saveSettings(value) } }
                settings = value
                setupDraft = value
                clearCasLookup()
                scheduleCasLookup(immediate = true)
                page = "scan"
                notice = "Lab setup saved on this phone."
            } catch (_: Exception) { notice = "Setup could not be saved. Please try again." }
            finally { busy = "" }
        }
    }

    fun testConnections(value: LabSettings, onSheetVerified: (String) -> Unit) {
        jobs.launch {
            busy = "Checking connections…"
            connectionMessage = ""
            val messages = mutableListOf<String>()
            try {
                if (value.parleyApiKey.isNotBlank()) {
                    try {
                        models = withContext(Dispatchers.IO) { api.testParley(value) }
                        messages += "Parley key accepted. Select an image-capable model from your MIT documentation."
                    } catch (e: Exception) { messages += "Parley: ${e.message ?: "Connection failed."}" }
                }
                if (value.sheetEndpoint.isNotBlank()) {
                    try {
                        val url = withContext(Dispatchers.IO) { api.testSheet(value) }
                        onSheetVerified(url)
                        messages += "Worksheet connected. No inventory row was added."
                    } catch (e: Exception) { messages += "Worksheet: ${e.message ?: "Connection failed."}" }
                }
                connectionMessage = messages.joinToString("\n\n").ifBlank { "Enter your connection details first." }
            } finally { busy = "" }
        }
    }

    private fun publish(record: InventoryRecord) {
        records = (records.filterNot { it.id == record.id } + record).sortedByDescending { it.createdAt }
    }
    private suspend fun persist(record: InventoryRecord, publishResult: Boolean = true) {
        disk.withLock { withContext(Dispatchers.IO) { store.saveRecord(record) } }
        if (publishResult) publish(record)
    }
    fun manualEntry() {
        clearCasLookup()
        current = InventoryRecord(pi = settings.pi, room = settings.room, destinationEndpoint = settings.sheetEndpoint)
        page = "review"
        updateDraft(current!!)
    }
    fun edit(record: InventoryRecord) {
        clearCasLookup()
        current = record
        page = "review"
        scheduleCasLookup(immediate = true)
    }
    fun updateDraft(record: InventoryRecord) {
        val previous = current
        val identityChanged = previous != null && previous.id == record.id &&
            (previous.chemicalName != record.chemicalName || previous.concentration != record.concentration)
        val updated = if (identityChanged && previous.casSource.startsWith("PubChem CID ") &&
            record.cas == previous.cas && record.casSource == previous.casSource) {
            record.copy(cas = "", casSource = "", reviewed = false)
        } else record
        val lookupIdentityChanged = previous == null || previous.id != updated.id ||
            previous.chemicalName != updated.chemicalName || previous.concentration != updated.concentration ||
            previous.cas != updated.cas || updated.syncState != "draft"
        if (lookupIdentityChanged) {
            clearCasLookup()
        }
        current = updated
        publish(updated)
        jobs.launch {
            try { persist(updated, publishResult = false) }
            catch (_: Exception) { notice = "The draft could not be saved on this phone. Keep this screen open and try again." }
        }
        if (lookupIdentityChanged) scheduleCasLookup()
    }
    fun analyze(file: File) {
        if (busy.isNotBlank()) return
        val config = settings
        clearCasLookup()
        busy = "Preparing photo…"
        jobs.launch {
            var optimized: File? = null
            val started = SystemClock.elapsedRealtime()
            try {
                optimized = withContext(Dispatchers.IO) { prepareLabelImage(getApplication(), file) }
                val prepared = SystemClock.elapsedRealtime()
                busy = "Reading label…"
                val record = withContext(Dispatchers.IO) { api.analyze(config, optimized!!) }
                    .copy(pi = config.pi, room = config.room, destinationEndpoint = config.sheetEndpoint)
                val read = SystemClock.elapsedRealtime()
                busy = "Opening record…"
                persist(record)
                current = record
                page = "review"
                lastScanRecordId = record.id
                lastScanMessage = String.format(Locale.US, "%s: %.1f s · photo preparation: %.1f s", config.parleyModel,
                    (read - prepared) / 1000.0, (prepared - started) / 1000.0)
                busy = ""
                scheduleCasLookup(immediate = true)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = e.message ?: "The label could not be read. Try a clearer photo or add the record manually."
                page = "scan"
            } finally {
                busy = ""
                withContext(NonCancellable + Dispatchers.IO) { file.delete(); optimized?.delete() }
            }
        }
    }

    private fun clearCasLookup() {
        casGeneration++
        casScheduleJob?.cancel()
        casScheduleJob = null
        casJob?.cancel()
        casJob = null
        casLookup = CasLookupUiState()
    }

    /** Debounce typing, but start as soon as a scanned or saved draft opens. */
    private fun scheduleCasLookup(immediate: Boolean = false) {
        val record = current ?: return
        if (!settings.autoCasLookup || record.syncState != "draft" || record.cas.isNotBlank() ||
            record.chemicalName.isBlank()) return
        if (immediate) {
            lookupCas()
        } else {
            casScheduleJob?.cancel()
            casScheduleJob = jobs.launch {
                delay(450)
                casScheduleJob = null
                lookupCas()
            }
        }
    }

    /** Lookup runs beside editing; only an unambiguous complete-name match fills the draft. */
    fun lookupCas(): Job? {
        val record = current ?: return null
        if (record.syncState != "draft" || record.cas.isNotBlank() || record.chemicalName.isBlank() || casLookup.loading) return null
        clearCasLookup()
        val generation = casGeneration
        val query = record.chemicalName.trim()
        casLookup = CasLookupUiState(recordId = record.id, query = query, loading = true)
        casJob = jobs.launch {
            try {
                val result = withContext(Dispatchers.IO) { findCas(query) }
                check(result.query == query) { "Lookup response does not match its query" }
                val active = current
                if (generation == casGeneration && active?.id == record.id && active.chemicalName.trim() == query &&
                    active.concentration == record.concentration && active.cas.isBlank() && active.syncState == "draft") {
                    casLookup = CasLookupUiState(recordId = record.id, query = query, result = result, message = result.message)
                    automaticCasCandidate(active, result)?.let { candidate ->
                        // Updating the draft invalidates lookup state. Do not cancel this completed request.
                        casJob = null
                        updateDraft(active.copy(cas = candidate.cas, casUnavailableReason = "",
                            casSource = "PubChem CID ${candidate.cid}; ${candidate.sourceUrl}; automatically matched by full name; review required",
                            reviewed = false))
                    }
                }
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) {
                if (generation == casGeneration) casLookup = CasLookupUiState(recordId = record.id, query = query,
                    message = "PubChem lookup could not finish. Try again or check the supplier SDS. Your draft is unchanged.")
            }
        }
        return casJob
    }

    /** Choosing a proposal fills its source; the overall record still requires review. */
    fun acceptCasCandidate(candidate: CasCandidate) {
        val record = current ?: return
        if (record.syncState != "draft" || record.cas.isNotBlank() || casLookup.loading || casLookup.recordId != record.id ||
            casLookup.query != record.chemicalName.trim() || casLookup.result?.query != casLookup.query ||
            casLookup.result?.candidates?.contains(candidate) != true || !isValidCas(candidate.cas)) return
        val source = "PubChem CID ${candidate.cid}; ${candidate.sourceUrl}; selected from database; review required"
        updateDraft(record.copy(cas = candidate.cas, casUnavailableReason = "", casSource = source, reviewed = false))
    }

    fun saveToSheet(record: InventoryRecord, scanNext: Boolean = false) {
        if (busy.isNotBlank() || validateRecord(record).isNotEmpty()) return
        val config = settings
        try { api.checkAppendReady(config, record) }
        catch (e: Exception) { notice = e.message.orEmpty(); return }
        clearCasLookup()
        busy = "Saving to your worksheet…"
        jobs.launch {
            val sending = record.copy(syncState = "syncing", destinationEndpoint = record.destinationEndpoint.ifBlank { config.sheetEndpoint })
            var journaled = false
            try {
                persist(sending)
                journaled = true
                current = sending
                withContext(Dispatchers.IO) { api.append(config, sending) }
                val saved = sending.copy(syncState = "synced", syncedAt = Instant.now().toString())
                persist(saved)
                current = null
                notice = "${record.chemicalName} saved to the worksheet."
                page = if (scanNext && config.parleyApiKey.isNotBlank() && config.parleyModel.isNotBlank()) "camera" else "records"
            } catch (e: Exception) {
                if (journaled) {
                    val definitelyRejected = e is InventoryApiException && e.definitelyNotSaved && record.syncState == "draft"
                    val pending = sending.copy(syncState = if (definitelyRejected) "draft" else "pending")
                    current = pending
                    try { persist(pending) } catch (_: Exception) { /* Earlier journal preserves ID. */ }
                    notice = if (definitelyRejected) "The worksheet rejected this save. Your draft is kept for correction. ${e.message.orEmpty()}"
                        else "Save not confirmed. Your record is kept on this phone. Retry uses the same record ID. ${e.message.orEmpty()}"
                } else {
                    current = record
                    notice = "The record could not be saved on this phone, so it was not sent to the worksheet. Keep this screen open, free storage space, and try again."
                }
                page = "review"
            } finally { busy = "" }
        }
    }
    override fun onCleared() { jobs.cancel() }
}

data class CasLookupUiState(
    val recordId: String = "",
    val query: String = "",
    val loading: Boolean = false,
    val result: CasLookupResult? = null,
    val message: String = ""
)
