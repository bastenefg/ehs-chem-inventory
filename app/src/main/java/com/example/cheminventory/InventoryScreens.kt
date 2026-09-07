package com.example.cheminventory

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private val Ink = Color(0xFF263238)
private val Muted = Color(0xFF626970)
private val Mist = Color(0xFFE3E7EA)
private val Paper = Color(0xFFF7F8FA)
private val Accent = Color(0xFFA31F34)

@Composable
fun InventoryApp(model: InventoryViewModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var importing by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null && !importing && model.busy.isBlank()) {
            importing = true
            scope.launch {
                var importedFile: File? = null
                var handedToModel = false
                try {
                    val file = withContext(Dispatchers.IO) {
                        val temp = File.createTempFile("label_", ".img", context.cacheDir)
                        importedFile = temp
                        try {
                            context.contentResolver.openInputStream(uri)?.use { input ->
                                temp.outputStream().use { output ->
                                    val buffer = ByteArray(8192)
                                    var count = 0L
                                    while (true) {
                                        ensureActive()
                                        val read = input.read(buffer)
                                        if (read < 0) break
                                        count += read
                                        require(count <= 30 * 1024 * 1024) { "Choose an image smaller than 30 MB." }
                                        output.write(buffer, 0, read)
                                    }
                                }
                            } ?: error("This photo could not be opened.")
                            temp
                        } catch (e: Exception) { temp.delete(); throw e }
                    }
                    model.analyze(file)
                    handedToModel = true
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    model.report("This photo could not be opened. Choose an image smaller than 30 MB or take another photo.")
                } finally {
                    if (!handedToModel) withContext(NonCancellable + Dispatchers.IO) { importedFile?.delete() }
                    importing = false
                }
            }
        }
    }
    val busyStage = if (importing) "Importing photo…" else model.busy
    val busy = busyStage.isNotBlank()
    var elapsedSeconds by remember { mutableStateOf(0) }
    LaunchedEffect(busy) {
        elapsedSeconds = 0
        while (busy) { delay(1000); elapsedSeconds++ }
    }
    val focus = LocalFocusManager.current
    LaunchedEffect(busy) { if (busy) focus.clearFocus() }
    BackHandler(model.page !in listOf("scan", "setup") || busy) {
        if (!busy) model.page = if (model.page == "review") "records" else "scan"
    }
    if (!model.ready) {
        Box(Modifier.fillMaxSize().background(Paper).padding(28.dp), contentAlignment = Alignment.Center) {
            if (model.fatal) Text(model.notice) else CircularProgressIndicator()
        }
        return
    }
    Scaffold(
        containerColor = Paper,
        bottomBar = {
            if (model.page in listOf("scan", "records", "setup", "guide")) {
                NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
                    listOf("scan" to "Scan", "records" to "Records", "setup" to "Lab setup").forEach { (page, title) ->
                        NavigationBarItem(selected = model.page == page, onClick = { model.page = page },
                            icon = { LabIcon(page, Modifier.size(23.dp)) }, label = { Text(title) }, enabled = !busy)
                    }
                }
            }
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (model.page) {
                "scan" -> ScanPage(model, onCamera = { model.page = "camera" }, onImport = { pick.launch("image/*") })
                "setup" -> SetupPage(model)
                "records" -> RecordsPage(model)
                "review" -> model.current?.let { ReviewPage(it, model::updateDraft, { model.page = "records" }, model::saveToSheet,
                    model.settings.sheetEndpoint.isNotBlank(), model.casLookup, { model.lookupCas() }, model::acceptCasCandidate,
                    model.lastScanMessage.takeIf { _ -> model.lastScanRecordId == it.id }.orEmpty()) }
                "camera" -> CameraPage(model.settings.room, { model.page = "scan" }, model::analyze)
                "guide" -> GuidePage { model.page = "scan" }
            }
            if (busy) {
                ScanProgress(busyStage, elapsedSeconds)
            }
        }
    }
    if (model.notice.isNotBlank() && !busy) {
        AlertDialog(onDismissRequest = model::dismissNotice, title = { Text("Inventory update") },
            text = { Text(model.notice) }, confirmButton = { TextButton(onClick = model::dismissNotice) { Text("Got it") } })
    }
}

@Composable
internal fun ScanProgress(stage: String, elapsedSeconds: Int) {
    Box(Modifier.fillMaxSize().background(Paper.copy(alpha = .98f)).clickable(onClick = {}), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(stage, style = MaterialTheme.typography.titleLarge)
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth().testTag("scan-progress"), color = MaterialTheme.colorScheme.primary)
            Text("${elapsedSeconds}s elapsed", color = Muted)
            Text(when {
                stage.startsWith("Importing") -> "Copying the selected photo."
                stage.startsWith("Preparing") -> "Preparing the image for label recognition."
                stage.startsWith("Reading") -> "Parley is reading the label. The fields will open when it finishes."
                stage.startsWith("Opening") -> "Saving the draft on this phone."
                else -> "Please keep the app open."
            }, color = Muted, style = MaterialTheme.typography.bodySmall)
            if (elapsedSeconds >= 20 && stage.startsWith("Reading")) {
                Text("Still waiting for Parley. Scan time depends on the model and connection.", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun PageColumn(content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 680.dp).fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
    }
}

@Composable
private fun SectionCard(title: String, detail: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Surface(shape = RoundedCornerShape(8.dp), color = Color.White, border = androidx.compose.foundation.BorderStroke(1.dp, Mist)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = Muted)
            content()
        }
    }
}

@Composable
private fun ScanPage(model: InventoryViewModel, onCamera: () -> Unit, onImport: () -> Unit) {
    val config = model.settings
    val canScan = config.parleyApiKey.isNotBlank() && config.parleyModel.isNotBlank() && isValidParleyBaseUrl(config.parleyBaseUrl)
    PageColumn {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Chemical inventory", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { model.page = "guide" }) { Text("Guide") }
        }
        SectionCard("New record", "Photograph one label. Keep the name, CAS number and amount in focus.") {
            Button(onClick = if (canScan) onCamera else { { model.page = "setup" } }, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
                Text(if (canScan) "Scan a label" else "Connect Parley to scan")
            }
            if (canScan) OutlinedButton(onClick = onImport, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) { Text("Choose a photo") }
            OutlinedButton(onClick = model::manualEntry, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) { Text("Add a record manually") }
        }
        SectionCard(config.labName.ifBlank { "Lab connection" }) {
            Text(if (config.pi.isNotBlank()) "${config.pi}  ·  ${config.room}" else "Add your PI and building-room to get started.", color = Muted)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (config.sheetUrl.isNotBlank()) "Google Sheet connected" else "Worksheet setup needed", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = { model.page = "setup" }) { Text("Lab setup") }
            }
        }
        SectionCard("Records on this phone") {
            Text("${model.records.count { it.syncState == "synced" }} saved to worksheet · ${model.records.count { it.syncState != "synced" }} drafts or pending", color = Muted)
            TextButton(onClick = { model.page = "records" }) { Text("View records") }
        }
        if (model.lastScanMessage.isNotBlank()) Text("Last scan: ${model.lastScanMessage}", style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}

@Composable
private fun SetupPage(model: InventoryViewModel) {
    val config = model.setupDraft
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var showKey by remember { mutableStateOf(false) }
    var showModels by remember { mutableStateOf(false) }
    val context = LocalContext.current
    fun update(value: LabSettings) { model.setupDraft = value; errors = emptyMap() }
    PageColumn {
        Text("Lab setup", style = MaterialTheme.typography.headlineMedium)
        Text("Configure each phone with a Parley key and your lab’s shared worksheet.", color = Muted)
        SectionCard("Lab details", "Prefilled in new records. You can change the location during review.") {
            Entry("Lab name", config.labName, { update(config.copy(labName = it)) })
            Entry("PI / supervisor", config.pi, { update(config.copy(pi = it)) }, errors["pi"])
            Entry("Default building-room", config.room, { update(config.copy(room = it)) }, errors["room"], helper = "Use MIT’s full location, for example N52-496.")
        }
        SectionCard("MIT Parley", "Generate a key in Parley API and paste it below. Keys are encrypted on this phone.") {
            TextButton(onClick = { openLink(context, "https://parley.mit.edu/") }) { Text("Open Parley to generate a key ↗") }
            OutlinedTextField(value = config.parleyApiKey, onValueChange = { update(config.copy(parleyApiKey = it.trim())) },
                label = { Text("Your Parley API key") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = { TextButton(onClick = { showKey = !showKey }) { Text(if (showKey) "Hide" else "Show") } })
            Entry("Parley API base URL", config.parleyBaseUrl, { update(config.copy(parleyBaseUrl = it.trim())) }, errors["parley"], helper = "Use the API URL at parley.api.mit.edu from MIT’s documentation.")
            Entry("Image-capable model", config.parleyModel, { update(config.copy(parleyModel = it.trim())) }, helper = "Use a vision model available to your Parley account.")
            if (model.models.isNotEmpty()) {
                Box {
                    OutlinedButton(onClick = { showModels = true }) { Text("Choose from available models") }
                    DropdownMenu(expanded = showModels, onDismissRequest = { showModels = false }) {
                        model.models.forEach { name -> DropdownMenuItem(text = { Text(name) }, onClick = { update(config.copy(parleyModel = name)); showModels = false }) }
                    }
                }
            }
            Text("The connection check lists models. A successful label scan confirms that your selected model supports images.", style = MaterialTheme.typography.bodySmall, color = Muted)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Fast scan", fontWeight = FontWeight.SemiBold)
                    Text("Uses minimal reasoning for GPT-5, GPT-5 mini and GPT-5 nano. Turn off if Parley rejects the option or a label needs a second pass.", style = MaterialTheme.typography.bodySmall, color = Muted)
                }
                Switch(checked = config.fastScan, onCheckedChange = { update(config.copy(fastScan = it)) })
            }
            if (config.parleyModel.isNotBlank() && !supportsFastScan(config.parleyModel)) {
                Text("This model uses its normal request settings. Fast scan only changes the supported GPT-5 models listed above.", style = MaterialTheme.typography.bodySmall, color = Muted)
            }
            Text("You can also compare an available smaller vision model. Use the same label and check the extracted details; Parley controls which models your account can use.", style = MaterialTheme.typography.bodySmall, color = Muted)
        }
        SectionCard("Google worksheet", "Get the deployment link and connection token from your lab’s worksheet owner.") {
            Entry("Worksheet connector URL", config.sheetEndpoint, { update(config.copy(sheetEndpoint = it.trim(), sheetUrl = "")) }, errors["sheet"], helper = "Google Apps Script deployment link ending in /exec.")
            OutlinedTextField(value = config.sheetToken, onValueChange = { update(config.copy(sheetToken = it.trim(), sheetUrl = "")) }, label = { Text("Worksheet connection token") },
                visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
            if (config.sheetUrl.isNotBlank()) TextButton(onClick = { openLink(context, config.sheetUrl) }) { Text("Open connected worksheet ↗") }
            Text("The worksheet owner sets up the supplied script once per lab. Keep the sheet private and share it only with your lab’s authorized collaborators.", style = MaterialTheme.typography.bodySmall, color = Muted)
        }
        SectionCard("CAS lookup") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Automatically fill missing CAS", fontWeight = FontWeight.SemiBold)
                    Text("Look up missing CAS in PubChem and fill a single unambiguous match. Review before saving.", style = MaterialTheme.typography.bodySmall, color = Muted)
                }
                Switch(checked = config.autoCasLookup, onCheckedChange = { update(config.copy(autoCasLookup = it)) })
            }
            Text("Only the chemical name is sent to public PubChem. No extra API key is needed. You can also search from a draft.", style = MaterialTheme.typography.bodySmall, color = Muted)
        }
        OutlinedButton(onClick = { model.testConnections(config) { url -> model.setupDraft = model.setupDraft.copy(sheetUrl = url) } }, modifier = Modifier.fillMaxWidth()) { Text("Check connections") }
        if (model.connectionMessage.isNotBlank()) Surface(color = Mist, shape = RoundedCornerShape(16.dp)) { Text(model.connectionMessage, Modifier.padding(18.dp), style = MaterialTheme.typography.bodySmall) }
        Button(onClick = {
            val problems = buildMap {
                if (config.pi.isBlank()) put("pi", "Enter the PI or supervisor’s name.")
                if (!Regex("^[A-Za-z0-9]+-[A-Za-z0-9-]+$").matches(config.room.trim())) put("room", "Use a building-room location, such as N52-496.")
                if (config.parleyApiKey.isNotBlank() && !isValidParleyBaseUrl(config.parleyBaseUrl)) put("parley", "Use the MIT Parley API URL at parley.api.mit.edu.")
                if (config.sheetEndpoint.isNotBlank() && !isValidSheetEndpoint(config.sheetEndpoint)) put("sheet", "Use a Google Apps Script /exec deployment URL.")
                if (config.sheetEndpoint.isNotBlank() && config.sheetToken.isBlank()) put("sheet", "Add the worksheet connection token.")
            }
            errors = problems
            if (problems.isEmpty()) model.saveSettings(config.copy(pi = config.pi.trim(), room = config.room.trim(), labName = config.labName.trim()))
        }, modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) { Text("Save lab setup") }
        Text("You can save lab details first and connect services later. Manual records stay on this phone until you send them to a worksheet.", style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}

@Composable
private fun RecordsPage(model: InventoryViewModel) {
    var query by rememberSaveable { mutableStateOf("") }
    val context = LocalContext.current
    val visible = model.records.filter { (it.chemicalName + " " + it.cas + " " + it.room).contains(query, ignoreCase = true) }
    PageColumn {
        Text("Records on this phone", style = MaterialTheme.typography.headlineMedium)
        Text("Resume a draft or retry a pending save. Open the shared worksheet to see your whole lab’s inventory.", color = Muted)
        if (model.settings.sheetUrl.isNotBlank()) OutlinedButton(onClick = { openLink(context, model.settings.sheetUrl) }, modifier = Modifier.fillMaxWidth()) { Text("Open shared worksheet ↗") }
        Entry("Search name, CAS or room", query, { query = it })
        if (visible.isEmpty()) SectionCard(if (query.isBlank()) "No records yet" else "No matching records") {
            Text(if (query.isBlank()) "Scan a label or enter a record manually." else "Try a different chemical name or location.", color = Muted)
            if (query.isBlank()) TextButton(onClick = { model.page = "scan" }) { Text("Start a scan") }
        }
        visible.forEach { record ->
            Surface(onClick = { model.edit(record) }, shape = RoundedCornerShape(8.dp), color = Color.White, border = androidx.compose.foundation.BorderStroke(1.dp, Mist)) {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(when(record.syncState) { "synced" -> "Saved to worksheet"; "pending", "syncing" -> "Save not confirmed"; else -> "Draft" },
                            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (record.syncState == "synced") Ink else Accent)
                        Spacer(Modifier.weight(1f))
                        Text(record.createdAt.take(10), fontSize = 11.sp, color = Muted)
                    }
                    Text(record.chemicalName.ifBlank { "Untitled chemical" }, style = MaterialTheme.typography.titleMedium)
                    Text(listOf(record.room, "${record.amount} ${record.unit}".trim(), record.cas).filter { it.isNotBlank() }.joinToString("  ·  "), color = Muted, fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun ReviewPage(record: InventoryRecord, onChange: (InventoryRecord) -> Unit, onBack: () -> Unit,
                       onSave: (InventoryRecord, Boolean) -> Unit, connected: Boolean,
                       lookup: CasLookupUiState, onLookup: () -> Unit, onAccept: (CasCandidate) -> Unit, scanMessage: String) {
    var attempted by remember(record.id) { mutableStateOf(false) }
    var showLabelText by remember(record.id) { mutableStateOf(false) }
    val errors = validateRecord(record)
    val locked = record.syncState != "draft"
    val synced = record.syncState == "synced"
    fun change(value: InventoryRecord) { onChange(value.copy(reviewed = false)) }
    PageColumn {
        TextButton(onClick = onBack, contentPadding = PaddingValues(0.dp)) { Text("‹  All records") }
        Text(if (synced) "Saved record" else "Review record", color = Muted, style = MaterialTheme.typography.bodySmall)
        Text(record.chemicalName.ifBlank { "New chemical record" }, style = MaterialTheme.typography.headlineMedium)
        Text(if (synced) "This record was confirmed by your worksheet. Make later inventory corrections directly in the shared sheet."
            else if (locked) "A save was attempted. This record is locked so a retry sends the same data and ID. Check the worksheet before making any corrections there."
            else "Read the original label and verify every field. Label recognition can miss text; it cannot confirm chemical identity.", color = Muted)
        if (scanMessage.isNotBlank()) Text(scanMessage, style = MaterialTheme.typography.bodySmall, color = Muted)
        SectionCard("Identity & location") {
            Entry("Chemical name · required", record.chemicalName, { change(record.copy(chemicalName = it)) }, if (attempted) errors["chemicalName"] else null, enabled = !locked, helper = "Use the full name, not an acronym.")
            Entry("PI / supervisor · required", record.pi, { change(record.copy(pi = it)) }, if (attempted) errors["pi"] else null, enabled = !locked)
            Entry("Building-room · required", record.room, { change(record.copy(room = it)) }, if (attempted) errors["room"] else null, enabled = !locked)
            Entry("CAS number", record.cas, { change(record.copy(cas = it, casSource = if (it.isBlank()) "" else "manual review")) }, if (attempted) errors["cas"] else null, enabled = !locked, helper = "Verify against the label or SDS. A valid format does not confirm identity.")
            if (record.cas.isBlank()) Entry("If no CAS exists, explain why", record.casUnavailableReason, { change(record.copy(casUnavailableReason = it)) }, if (attempted) errors["casUnavailableReason"] else null, enabled = !locked, helper = "An unreadable CAS is unresolved; check the SDS before saving.")
            if (record.casSource.contains("automatically matched")) Text("Filled from PubChem. Check against the label or SDS.", style = MaterialTheme.typography.bodySmall, color = Muted)
            if (record.casSource.isNotBlank()) Text("CAS source: ${record.casSource}", style = MaterialTheme.typography.bodySmall, color = Muted)
        }
        if (!locked && record.cas.isBlank()) CasLookupPanel(record, lookup, onLookup, onAccept)
        SectionCard("Quantity & state", "Enter the amount in each container. Container count is recorded separately; verify gas cylinder quantities against supplier information.") {
            Entry("Amount per container · required", record.amount, { change(record.copy(amount = it)) }, if (attempted) errors["amount"] else null, numeric = true, enabled = !locked)
            ChoiceField("Unit of measure", record.unit, supportedUnits, { change(record.copy(unit = it)) }, enabled = !locked)
            Entry("Number of containers", record.containerCount, { change(record.copy(containerCount = it)) }, if (attempted) errors["containerCount"] else null, numeric = true, enabled = !locked)
            ChoiceField("Physical state", record.physicalState, physicalStates, { change(record.copy(physicalState = it)) }, enabled = !locked)
            Entry("Concentration / mixture composition", record.concentration, { change(record.copy(concentration = it)) }, enabled = !locked, helper = "Include constituent concentrations for mixtures when known.")
        }
        SectionCard("Additional label details") {
            Entry("Supplier", record.supplier, { change(record.copy(supplier = it)) }, enabled = !locked)
            Entry("Catalog number", record.catalogNumber, { change(record.copy(catalogNumber = it)) }, enabled = !locked)
            Entry("Expiration date (YYYY-MM-DD)", record.expiryDate, { change(record.copy(expiryDate = it)) }, if (attempted) errors["expiryDate"] else null, enabled = !locked)
            Entry("Notes / storage location", record.notes, { change(record.copy(notes = it)) }, enabled = !locked, multiline = true)
        }
        if (record.labelText.isNotBlank()) {
            TextButton(onClick = { showLabelText = !showLabelText }) { Text(if (showLabelText) "Hide label text" else "Show label text") }
            if (showLabelText || (attempted && errors.containsKey("labelText"))) SectionCard("Text read from the label") {
                Entry("Label transcription", record.labelText, { change(record.copy(labelText = it)) }, if (attempted) errors["labelText"] else null, enabled = !locked, multiline = true)
            }
        }
        if (!synced) {
            if (!locked) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { onChange(record.copy(reviewed = !record.reviewed)) }) {
                Checkbox(checked = record.reviewed, onCheckedChange = { onChange(record.copy(reviewed = it)) })
                Text("I checked the label or SDS, location, amount and CAS information.", style = MaterialTheme.typography.bodyMedium)
            }
            if (attempted && errors.isNotEmpty()) Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(16.dp)) {
                Text(errors.values.distinct().joinToString("\n"), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
            }
            if (!connected) Text("Connect a worksheet in Lab setup before sending. This draft is saved on this phone.", color = Accent)
            Button(onClick = { attempted = true; if (errors.isEmpty()) onSave(record, false) }, enabled = connected, modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
                Text(if (locked) "Retry save with the same ID" else "Save to worksheet")
            }
            if (!locked) OutlinedButton(onClick = { attempted = true; if (errors.isEmpty()) onSave(record, true) }, enabled = connected, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) { Text("Save & scan next") }
            TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text(if (locked) "Return to records" else "Keep draft for later") }
        }
        Text("Record ID: ${record.id}", style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}

@Composable
internal fun CasLookupPanel(record: InventoryRecord, lookup: CasLookupUiState, onLookup: () -> Unit, onAccept: (CasCandidate) -> Unit) {
    val context = LocalContext.current
    val active = lookup.takeIf { it.recordId == record.id && it.query == record.chemicalName.trim() }
    SectionCard("CAS lookup", "Searches public PubChem by chemical name. Check the exact substance against the label or SDS.") {
        OutlinedButton(onClick = onLookup, enabled = record.chemicalName.isNotBlank() && active?.loading != true,
            modifier = Modifier.fillMaxWidth()) { Text(if (active?.loading == true) "Looking up CAS…" else "Find CAS in PubChem") }
        if (active?.loading == true) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Text("You can keep reviewing the other fields.", style = MaterialTheme.typography.bodySmall, color = Muted)
        }
        if (!active?.message.isNullOrBlank()) Text(active!!.message, style = MaterialTheme.typography.bodySmall, color = Muted)
        active?.result?.candidates?.forEach { candidate ->
            Surface(color = Paper, shape = RoundedCornerShape(8.dp)) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(candidate.cas, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    Text(candidate.title, fontWeight = FontWeight.SemiBold)
                    Text(candidate.molecularFormula, style = MaterialTheme.typography.bodySmall)
                    if (candidate.iupacName != candidate.title) Text(candidate.iupacName, style = MaterialTheme.typography.bodySmall, color = Muted)
                    TextButton(onClick = { openLink(context, candidate.sourceUrl) }) { Text("View PubChem compound ↗") }
                    OutlinedButton(onClick = { onAccept(candidate) }, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) { Text("Use this CAS") }
                }
            }
        }
        Text("Check the exact salt, hydrate and isomer. A solution or mixture may need several constituent CAS numbers; do not assign a pure substance's CAS to the whole mixture.", style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}

@Composable
private fun Entry(label: String, value: String, onChange: (String) -> Unit, error: String? = null, helper: String? = null, numeric: Boolean = false, enabled: Boolean = true, multiline: Boolean = false) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), enabled = enabled,
        singleLine = !multiline, minLines = if (multiline) 3 else 1, isError = error != null, shape = RoundedCornerShape(12.dp),
        keyboardOptions = KeyboardOptions(keyboardType = if (numeric) KeyboardType.Decimal else KeyboardType.Text),
        supportingText = if (error != null || helper != null) { { Text(error ?: helper.orEmpty()) } } else null)
}

@Composable
private fun ChoiceField(label: String, value: String, options: List<String>, onChange: (String) -> Unit, enabled: Boolean) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(16.dp)) {
            Text("$label: ${value.ifBlank { "Select" }}", modifier = Modifier.weight(1f)); Text("⌄")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { onChange(option); expanded = false }) }
        }
    }
}

@Composable
private fun GuidePage(onBack: () -> Unit) {
    val context = LocalContext.current
    PageColumn {
        TextButton(onClick = onBack) { Text("‹  Back to scan") }
        Text("Inventory guidance", style = MaterialTheme.typography.headlineMedium)
        SectionCard("What to include") {
            Text("Include purchased chemicals and gas cylinders. MIT also specifies certain hazardous research samples and unusually large sample quantities. Consult the current guidance for scope.")
        }
        SectionCard("Required information") {
            Text("Record the PI, building-room, full chemical name, amount with units and CAS when one exists. Check the SDS when the label is unclear. This app also collects state, container count, concentration and expiration.")
        }
        SectionCard("MIT reporting") {
            Text("Keep the inventory current and submit it to EHS during annual reporting season. The separate annual regulated-chemical report is submitted through MIT’s reporting process. This worksheet does not submit either report automatically.")
            Text("The current EHSA import template needs additional lab identifiers and formatting. Review your worksheet with your EHS coordinator before import.", color = Muted)
        }
        TextButton(onClick = { openLink(context, "https://ehs.mit.edu/chemical-safety-program/chemical-inventory/") }) { Text("MIT inventory guidance & import template ↗") }
        TextButton(onClick = { openLink(context, "https://ehs.mit.edu/chemical-safety-program/chemical-regulatory-reporting-security/") }) { Text("MIT annual chemical reporting ↗") }
        Text("Lab-developed tool • Not an official MIT EHS application\nOriginal app: Bastien FG Aymon, MIT MechE", style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}

private fun openLink(context: android.content.Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}

@Composable
private fun LabIcon(kind: String, modifier: Modifier = Modifier, tint: Color = Ink) {
    Canvas(modifier) {
        val w = size.width; val h = size.height; val stroke = Stroke(width = w * .07f)
        when (kind) {
            "scan" -> {
                listOf(0 to 0, 1 to 0, 0 to 1, 1 to 1).forEach { (x, y) ->
                    val px = w * if (x == 0) .12f else .88f; val py = h * if (y == 0) .12f else .88f
                    drawLine(tint, Offset(px, py), Offset(px + w * if (x == 0) .2f else -.2f, py), stroke.width)
                    drawLine(tint, Offset(px, py), Offset(px, py + h * if (y == 0) .2f else -.2f), stroke.width)
                }
                drawLine(tint, Offset(w * .25f, h * .5f), Offset(w * .75f, h * .5f), stroke.width)
            }
            "records" -> {
                drawRoundRect(tint, Offset(w * .17f, h * .1f), Size(w * .66f, h * .8f), style = stroke)
                for (i in 0..2) drawLine(tint, Offset(w * .3f, h * (.33f + i * .17f)), Offset(w * .7f, h * (.33f + i * .17f)), stroke.width)
            }
            "setup" -> { drawCircle(tint, w * .34f, style = stroke); drawCircle(tint, w * .1f, style = stroke) }
            else -> {
                val path = Path().apply { moveTo(w * .38f, h * .1f); lineTo(w * .62f, h * .1f); lineTo(w * .62f, h * .4f); lineTo(w * .85f, h * .85f); lineTo(w * .15f, h * .85f); lineTo(w * .38f, h * .4f); close() }
                drawPath(path, tint, style = stroke)
                drawLine(tint, Offset(w * .3f, h * .63f), Offset(w * .7f, h * .63f), stroke.width)
            }
        }
    }
}
