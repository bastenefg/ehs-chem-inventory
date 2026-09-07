package com.example.cheminventory

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import androidx.lifecycle.ViewModelStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class InventoryStoreTest {
    private val fixtures = mutableListOf<IsolatedInventoryFixture>()
    private val modelStores = mutableListOf<ViewModelStore>()

    private fun fixture() = IsolatedInventoryFixture().also { fixtures += it }

    private fun model(fixture: IsolatedInventoryFixture): Pair<InventoryViewModel, ViewModelStore> = onTestMain {
        val model = InventoryViewModel(fixture.application)
        val holder = ViewModelStore().also { it.put("inventory", model); modelStores += it }
        model to holder
    }.also { (model, _) -> awaitTestCondition { onTestMain { model.ready } } }

    @After fun cleanUp() {
        onTestMain { modelStores.forEach { it.clear() } }
        fixtures.forEach { it.close() }
    }

    @Test fun settingsRoundTripThroughKeystoreOutsideBackup() {
        val fixture = fixture()
        val first = InventoryStore(fixture.context)
        val settings = LabSettings(
            labName = "Instrumentation fixture", pi = "Test PI", room = "1-101",
            parleyApiKey = "sk-parley-instrumentation-secret", parleyModel = "fixture-model",
            sheetEndpoint = "https://script.google.com/macros/s/test-fixture/exec",
            sheetToken = "instrumentation-worksheet-secret"
        )
        first.saveSettings(settings)
        assertEquals(settings, InventoryStore(fixture.context).loadSettings())
        val encryptedFile = File(fixture.directory, "lab-settings-v1.enc")
        assertTrue(encryptedFile.exists())
        assertTrue(encryptedFile.canonicalPath.startsWith(fixture.realNoBackup.canonicalPath + File.separator))
        val ciphertext = encryptedFile.readBytes().toString(Charsets.ISO_8859_1)
        assertFalse(ciphertext.contains(settings.parleyApiKey))
        assertFalse(ciphertext.contains(settings.sheetToken))
        assertFalse(ciphertext.contains(settings.labName))
    }

    @Test fun unreadableSettingsDoNotDiscardInventory() {
        val fixture = fixture()
        val store = InventoryStore(fixture.context)
        val record = InventoryRecord(chemicalName = "Preserved draft")
        store.saveRecord(record)
        store.saveSettings(LabSettings(pi = "Test PI", parleyApiKey = "test-secret"))
        File(fixture.directory, "lab-settings-v1.enc").writeBytes(byteArrayOf(1, 2, 3))
        assertThrows(IllegalStateException::class.java) { store.loadSettings() }
        assertEquals(listOf(record), store.loadRecords())
        val (model, _) = model(fixture)
        assertEquals(listOf(record), onTestMain { model.records })
        assertEquals("setup", onTestMain { model.page })
        assertFalse(onTestMain { model.fatal })
        assertTrue(onTestMain { model.notice.contains("settings could not be unlocked") })
    }

    @Test fun corruptInventoryIsReportedAndNeverOverwrittenByAnotherSave() {
        val fixture = fixture()
        val store = InventoryStore(fixture.context)
        store.saveRecord(InventoryRecord(chemicalName = "Existing record"))
        val file = File(fixture.directory, "inventory-records-v1.json")
        val broken = "{this is an interrupted or damaged inventory"
        file.writeText(broken)
        assertThrows(IllegalStateException::class.java) { store.loadRecords() }
        assertThrows(IllegalStateException::class.java) { store.saveRecord(InventoryRecord()) }
        assertEquals(broken, file.readText())
    }

    @Test fun latestDraftEditsSurviveANewViewModelAndKeepTheirIdentity() {
        val fixture = fixture()
        val (first, holder) = model(fixture)
        val finalRecord = onTestMain {
            first.manualEntry()
            var draft = first.current!!
            repeat(12) { index ->
                draft = draft.copy(chemicalName = "Draft revision $index", notes = "Note $index")
                first.updateDraft(draft)
            }
            draft
        }
        val disk = InventoryStore(fixture.context)
        awaitTestCondition { disk.loadRecords().singleOrNull() == finalRecord }
        onTestMain { holder.clear() }
        val (recreated, _) = model(fixture)
        assertEquals(listOf(finalRecord), onTestMain { recreated.records })
        assertEquals("draft", onTestMain { recreated.records.single().syncState })
        assertEquals(finalRecord.id, onTestMain { recreated.records.single().id })
    }

    @Test fun interruptedSendRestoresAsPendingWithTheSameRecordId() {
        val fixture = fixture()
        val record = InventoryRecord(chemicalName = "Interrupted save", syncState = "syncing")
        InventoryStore(fixture.context).saveRecord(record)
        val (restored, _) = model(fixture)
        val recovered = onTestMain { restored.records.single() }
        assertEquals(record.id, recovered.id)
        assertEquals("pending", recovered.syncState)
    }

    @Test fun syncPreflightFailureLeavesDraftEditableWithoutSending() {
        val fixture = fixture()
        val (model, _) = model(fixture)
        val record = InventoryRecord(
            pi = "Test PI", room = "1-101", chemicalName = "Ethanol", amount = "500", unit = "mL",
            physicalState = "Liquid", cas = "64-17-5", reviewed = true
        )
        onTestMain { model.updateDraft(record) }
        awaitTestCondition { InventoryStore(fixture.context).loadRecords().singleOrNull() == record }
        // Default settings have no endpoint, so this must stop before any network operation.
        onTestMain { model.saveToSheet(record) }
        assertEquals("draft", onTestMain { model.current!!.syncState })
        assertEquals("", onTestMain { model.busy })
        assertTrue(onTestMain { model.notice.contains("deployment URL") })
        assertEquals("draft", InventoryStore(fixture.context).loadRecords().single().syncState)
    }
}

/** Every non-UI test gets its own private directory and Keystore alias. */
internal class IsolatedInventoryFixture : AutoCloseable {
    private val base = InstrumentationRegistry.getInstrumentation().targetContext
    val realNoBackup: File = base.noBackupFilesDir
    private val uniqueName = "instrumentation-${UUID.randomUUID()}"
    val directory = File(realNoBackup, uniqueName).apply { check(mkdirs()) }
    private val testPackage = "${base.packageName}.$uniqueName"
    val context: Context = object : ContextWrapper(base) {
        override fun getNoBackupFilesDir(): File = directory
        override fun getPackageName(): String = testPackage
    }
    val application: Application = object : Application() {
        override fun getNoBackupFilesDir(): File = directory
        override fun getPackageName(): String = testPackage
        override fun getApplicationContext(): Context = context
    }
    override fun close() {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        keyStore.deleteEntry("$testPackage.lab-settings.v1")
        check(directory.name == uniqueName && directory.canonicalFile.parentFile == realNoBackup.canonicalFile)
        directory.deleteRecursively()
    }
}

internal fun <T> onTestMain(block: () -> T): T {
    val result = AtomicReference<T>()
    InstrumentationRegistry.getInstrumentation().runOnMainSync { result.set(block()) }
    return result.get()
}

internal fun awaitTestCondition(timeoutMillis: Long = 10_000, condition: () -> Boolean) {
    val deadline = SystemClock.uptimeMillis() + timeoutMillis
    while (!condition()) {
        check(SystemClock.uptimeMillis() < deadline) { "Timed out waiting for inventory state." }
        SystemClock.sleep(20)
    }
}
