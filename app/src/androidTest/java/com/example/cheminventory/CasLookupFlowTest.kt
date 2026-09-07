package com.example.cheminventory

import androidx.lifecycle.ViewModelStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Exercises draft identity, persistence, and late-result handling without a network request. */
@RunWith(AndroidJUnit4::class)
class CasLookupFlowTest {
    private val fixtures = mutableListOf<IsolatedInventoryFixture>()
    private val modelStores = mutableListOf<ViewModelStore>()
    private val blockedLookups = mutableListOf<ControlledLookup>()
    private val ethanol = CasCandidate("64-17-5", "Ethanol", "C2H6O", "ethanol", 702L)

    private fun fixture() = IsolatedInventoryFixture().also { fixtures += it }

    private fun createModel(
        fixture: IsolatedInventoryFixture,
        autoLookup: Boolean = false,
        lookup: (String) -> CasLookupResult = ::ethanolResult
    ): Pair<InventoryViewModel, ViewModelStore> {
        val store = InventoryStore(fixture.context)
        store.saveSettings(store.loadSettings().copy(autoCasLookup = autoLookup))
        return onTestMain {
            val model = InventoryViewModel(fixture.application, lookup)
            val holder = ViewModelStore().also { it.put("inventory", model); modelStores += it }
            model to holder
        }.also { (model, _) -> awaitTestCondition { onTestMain { model.ready } } }
    }

    private fun ethanolResult(query: String) = CasLookupResult(
        query = query,
        candidates = listOf(ethanol),
        message = "Check this database match when reviewing the record.",
        status = CasLookupStatus.FOUND,
        matchedCompoundCount = 1
    )

    private fun ambiguousResult(query: String) = ethanolResult(query).copy(
        candidates = listOf(ethanol, CasCandidate("67-56-1", "Methanol", "CH4O", "methanol", 887L)),
        matchedCompoundCount = 2
    )

    private fun draft() = InventoryRecord(
        pi = "Test PI", room = "1-101", chemicalName = "Ethanol", amount = "500", unit = "mL",
        physicalState = "Liquid", casUnavailableReason = "CAS was unreadable on the label", reviewed = true
    )

    private fun controlledLookup() = ControlledLookup().also { blockedLookups += it }

    /** Joining the actual job ensures assertions run after a delayed result was handled or canceled. */
    private fun finish(job: Job?) {
        assertNotNull("A valid draft lookup should launch a job", job)
        runBlocking { withTimeout(10_000) { job!!.join() } }
    }

    private fun awaitPersisted(fixture: IsolatedInventoryFixture, expected: InventoryRecord) {
        awaitTestCondition {
            InventoryStore(fixture.context).loadRecords().singleOrNull { it.id == expected.id } == expected
        }
    }

    @After fun cleanUp() {
        blockedLookups.forEach { it.release.countDown() }
        onTestMain { modelStores.forEach { it.clear() } }
        fixtures.forEach { it.close() }
    }

    @Test fun lookupAutomaticallyFillsAndPersistsAnUnambiguousMatchWithoutAnAcceptanceButton() {
        val fixture = fixture()
        val (model, holder) = createModel(fixture)
        val original = draft()
        onTestMain { model.updateDraft(original) }
        awaitPersisted(fixture, original)

        finish(onTestMain { model.lookupCas() })

        val accepted = onTestMain { model.current!! }
        assertEquals(original.id, accepted.id)
        assertEquals(original.chemicalName, accepted.chemicalName)
        assertEquals("64-17-5", accepted.cas)
        assertEquals("", accepted.casUnavailableReason)
        assertFalse("A database proposal must require renewed human review", accepted.reviewed)
        assertTrue(accepted.casSource.contains("PubChem"))
        assertTrue(accepted.casSource.contains("CID ${ethanol.cid}"))
        assertTrue(accepted.casSource.contains(ethanol.sourceUrl))
        assertTrue(accepted.casSource.contains("automatically matched by full name"))
        assertTrue(accepted.casSource.contains("review required"))
        assertFalse(accepted.casSource.contains("confirmed"))
        awaitPersisted(fixture, accepted)

        onTestMain { holder.clear() }
        val (recreated, _) = createModel(fixture)
        assertEquals(accepted, onTestMain { recreated.records.single() })
    }

    @Test fun ambiguousResultsStayUnfilledUntilACandidateIsSelectedAndStillRequireRecordReview() {
        val fixture = fixture()
        val (model, _) = createModel(fixture, lookup = ::ambiguousResult)
        val original = draft()
        onTestMain { model.updateDraft(original) }
        finish(onTestMain { model.lookupCas() })

        assertEquals(original, onTestMain { model.current })
        assertEquals(2, onTestMain { model.casLookup.result!!.candidates.size })
        onTestMain { model.acceptCasCandidate(ethanol) }
        val selected = onTestMain { model.current!! }
        assertEquals(ethanol.cas, selected.cas)
        assertFalse(selected.reviewed)
        assertTrue(selected.casSource.contains("selected from database"))
        assertTrue(selected.casSource.contains("review required"))
        assertFalse(selected.casSource.contains("confirmed"))
        awaitPersisted(fixture, selected)
    }

    @Test fun candidateMustBeAnExactMemberOfTheDisplayedProposals() {
        val fixture = fixture()
        val (model, _) = createModel(fixture, lookup = ::ambiguousResult)
        val original = draft()
        onTestMain { model.updateDraft(original) }
        finish(onTestMain { model.lookupCas() })

        onTestMain { model.acceptCasCandidate(CasCandidate("67-64-1", "Acetone", "C3H6O", "propan-2-one", 180L)) }
        assertEquals(original, onTestMain { model.current })
        onTestMain { model.acceptCasCandidate(ethanol.copy(cid = 180L)) }
        assertEquals("Matching CAS text alone must not authorize a different source", original, onTestMain { model.current })
        awaitPersisted(fixture, original)
    }

    @Test fun lateProposalCannotReplaceAChangedChemicalName() {
        val fixture = fixture()
        val lookup = controlledLookup()
        val (model, _) = createModel(fixture, lookup = lookup::find)
        val original = draft()
        onTestMain { model.updateDraft(original) }
        val job = onTestMain { model.lookupCas() }
        lookup.awaitStarted()

        val changed = original.copy(chemicalName = "Methanol", reviewed = false)
        onTestMain { model.updateDraft(changed) }
        lookup.release.countDown()
        finish(job)
        onTestMain { model.acceptCasCandidate(ethanol) }

        assertEquals(changed, onTestMain { model.current })
        assertFalse(onTestMain { model.casLookup.result?.candidates.orEmpty().contains(ethanol) })
        awaitPersisted(fixture, changed)
    }

    @Test fun lateProposalCannotFollowTheUserToAnotherDraft() {
        val fixture = fixture()
        val lookup = controlledLookup()
        val (model, _) = createModel(fixture, lookup = lookup::find)
        val first = draft()
        onTestMain { model.updateDraft(first) }
        val job = onTestMain { model.lookupCas() }
        lookup.awaitStarted()

        val second = draft().copy(chemicalName = "Methanol", reviewed = false)
        onTestMain { model.updateDraft(second) }
        lookup.release.countDown()
        finish(job)
        onTestMain { model.acceptCasCandidate(ethanol) }

        assertNotEquals(first.id, second.id)
        assertEquals(second, onTestMain { model.current })
        assertFalse(onTestMain { model.casLookup.result?.candidates.orEmpty().contains(ethanol) })
        awaitPersisted(fixture, first)
        awaitPersisted(fixture, second)
    }

    @Test fun manuallyEnteredCasWinsOverAnOutstandingDatabaseLookup() {
        val fixture = fixture()
        val lookup = controlledLookup()
        val (model, _) = createModel(fixture, lookup = lookup::find)
        val original = draft()
        onTestMain { model.updateDraft(original) }
        val job = onTestMain { model.lookupCas() }
        lookup.awaitStarted()

        val manual = original.copy(cas = "64-17-5", casUnavailableReason = "", casSource = "Checked on supplier SDS", reviewed = true)
        onTestMain { model.updateDraft(manual) }
        lookup.release.countDown()
        finish(job)
        onTestMain { model.acceptCasCandidate(ethanol) }

        assertEquals(manual, onTestMain { model.current })
        assertFalse(onTestMain { model.casLookup.result?.candidates.orEmpty().contains(ethanol) })
        awaitPersisted(fixture, manual)
    }

    @Test fun lateProposalCannotModifyTheSameRecordOnceItsSaveIsPending() {
        val fixture = fixture()
        val lookup = controlledLookup()
        val (model, _) = createModel(fixture, lookup = lookup::find)
        val original = draft()
        onTestMain { model.updateDraft(original) }
        awaitPersisted(fixture, original)
        val job = onTestMain { model.lookupCas() }
        lookup.awaitStarted()

        // Model the persisted state of an uncertain send without contacting a real connector.
        val pending = original.copy(syncState = "pending")
        InventoryStore(fixture.context).saveRecord(pending)
        onTestMain { model.edit(pending) }
        lookup.release.countDown()
        finish(job)
        onTestMain { model.acceptCasCandidate(ethanol) }

        assertEquals(pending, onTestMain { model.current })
        assertEquals(pending, InventoryStore(fixture.context).loadRecords().single())
    }

    @Test fun pendingAndSyncedRecordsCannotStartLookupsOrAcceptProposals() {
        for (state in listOf("pending", "synced")) {
            val fixture = fixture()
            val saved = draft().copy(syncState = state)
            InventoryStore(fixture.context).saveRecord(saved)
            val calls = AtomicInteger()
            val (model, _) = createModel(fixture) { query ->
                calls.incrementAndGet()
                ethanolResult(query)
            }
            onTestMain { model.edit(saved) }

            val job = onTestMain { model.lookupCas() }
            if (job != null) runBlocking { withTimeout(10_000) { job.join() } }
            onTestMain { model.acceptCasCandidate(ethanol) }

            assertEquals("Lookup must stay disabled for a $state record", 0, calls.get())
            assertEquals(saved, onTestMain { model.current })
            assertEquals(saved, InventoryStore(fixture.context).loadRecords().single())
        }
    }

    @Test fun disabledFastScanAndAutomaticCasLookupPersistAcrossReload() {
        val fixture = fixture()
        val settings = LabSettings(pi = "Test PI", fastScan = false, autoCasLookup = false)
        InventoryStore(fixture.context).saveSettings(settings)

        assertEquals(settings, InventoryStore(fixture.context).loadSettings())
        val (model, _) = createModel(fixture)
        assertFalse(onTestMain { model.settings.fastScan })
        assertFalse(onTestMain { model.settings.autoCasLookup })
        assertEquals(settings, onTestMain { model.setupDraft })
    }

    @Test fun changingTheNameClearsAPreviouslyAcceptedPubChemIdentity() {
        val fixture = fixture()
        val (model, _) = createModel(fixture)
        onTestMain { model.updateDraft(draft()) }
        finish(onTestMain { model.lookupCas() })
        onTestMain { model.acceptCasCandidate(ethanol) }
        val accepted = onTestMain { model.current!! }
        assertEquals(ethanol.cas, accepted.cas)

        onTestMain { model.updateDraft(accepted.copy(chemicalName = "Methanol", reviewed = true)) }

        val expected = accepted.copy(chemicalName = "Methanol", cas = "", casSource = "", reviewed = false)
        assertEquals(expected, onTestMain { model.current })
        awaitPersisted(fixture, expected)
    }

    @Test fun changingCompositionClearsAPreviouslyAcceptedPubChemIdentity() {
        val fixture = fixture()
        val (model, _) = createModel(fixture)
        onTestMain { model.updateDraft(draft()) }
        finish(onTestMain { model.lookupCas() })
        onTestMain { model.acceptCasCandidate(ethanol) }
        val accepted = onTestMain { model.current!! }
        assertEquals(ethanol.cas, accepted.cas)

        onTestMain { model.updateDraft(accepted.copy(concentration = "70% ethanol in water", reviewed = true)) }

        val expected = accepted.copy(concentration = "70% ethanol in water", cas = "", casSource = "", reviewed = false)
        assertEquals(expected, onTestMain { model.current })
        awaitPersisted(fixture, expected)
    }

    @Test fun nameAndCompositionEditsPreserveManualAndLabelCasSources() {
        for (source in listOf("manual review", "label")) {
            val fixture = fixture()
            val (model, _) = createModel(fixture)
            val original = draft().copy(cas = ethanol.cas, casUnavailableReason = "", casSource = source)
            onTestMain { model.updateDraft(original) }
            val edited = original.copy(chemicalName = "Ethanol ACS", concentration = "99.9%", reviewed = false)

            onTestMain { model.updateDraft(edited) }

            assertEquals("A $source CAS must not be treated as a database proposal", edited, onTestMain { model.current })
            awaitPersisted(fixture, edited)
        }
    }

    @Test fun responseForADifferentQueryCannotBeOfferedOrLeaveLookupStuck() {
        val fixture = fixture()
        val (model, _) = createModel(fixture) { ethanolResult("Methanol") }
        val original = draft()
        onTestMain { model.updateDraft(original) }

        finish(onTestMain { model.lookupCas() })
        onTestMain { model.acceptCasCandidate(ethanol) }

        assertFalse(onTestMain { model.casLookup.loading })
        assertNull(onTestMain { model.casLookup.result })
        assertTrue(onTestMain { model.casLookup.message.isNotBlank() })
        assertEquals(original, onTestMain { model.current })
        awaitPersisted(fixture, original)
    }

    @Test fun completingAChemicalNameSchedulesOneLookupAndFillsCasWithoutAnyManualLookupCall() {
        val fixture = fixture()
        val calls = AtomicInteger()
        val (model, _) = createModel(fixture, autoLookup = true) { query ->
            calls.incrementAndGet()
            assertEquals("Ethanol", query)
            ethanolResult(query)
        }
        val original = draft()
        onTestMain {
            model.updateDraft(original.copy(chemicalName = "E"))
            model.updateDraft(original.copy(chemicalName = "Ethan"))
            model.updateDraft(original)
        }
        awaitTestCondition { onTestMain { model.current?.cas == ethanol.cas } }

        val filled = onTestMain { model.current!! }
        assertEquals(original.id, filled.id)
        assertEquals(1, calls.get())
        assertEquals("", filled.casUnavailableReason)
        assertFalse(filled.reviewed)
        assertTrue(filled.casSource.contains("automatically matched by full name"))
        awaitPersisted(fixture, filled)
    }

    @Test fun openingAnExistingDraftWithMissingCasStartsAutomaticLookup() {
        val fixture = fixture()
        val original = draft()
        InventoryStore(fixture.context).saveRecord(original)
        val (model, _) = createModel(fixture, autoLookup = true)

        onTestMain { model.edit(model.records.single()) }
        awaitTestCondition { onTestMain { model.current?.cas == ethanol.cas } }

        val filled = onTestMain { model.current!! }
        assertEquals(original.id, filled.id)
        assertEquals("", filled.casUnavailableReason)
        assertFalse(filled.reviewed)
        awaitPersisted(fixture, filled)
    }

    @Test fun automaticLookupOptOutPreventsBothTypingAndOpeningFromSchedulingRequests() {
        val fixture = fixture()
        val calls = AtomicInteger()
        val (model, _) = createModel(fixture, autoLookup = false) { query ->
            calls.incrementAndGet()
            ethanolResult(query)
        }
        val original = draft()
        onTestMain { model.updateDraft(original); model.edit(original) }
        // Give the documented debounce more than one full interval to expose unwanted scheduling.
        runBlocking { delay(1_000) }

        assertEquals(0, calls.get())
        assertEquals(original, onTestMain { model.current })
        assertFalse(onTestMain { model.casLookup.loading })
        awaitPersisted(fixture, original)
    }

    @Test fun concentrationEditedDuringAutomaticLookupCannotReceiveTheEarlierPureSubstanceCas() {
        val fixture = fixture()
        val lookup = controlledLookup()
        val (model, _) = createModel(fixture, autoLookup = true, lookup = lookup::find)
        val original = draft()
        onTestMain { model.updateDraft(original) }
        lookup.awaitStarted()

        val changed = original.copy(concentration = "70% ethanol in water", reviewed = false)
        onTestMain { model.updateDraft(changed) }
        lookup.release.countDown()
        awaitTestCondition { onTestMain { model.casLookup.result != null && !model.casLookup.loading } }

        assertEquals("A refreshed lookup may suggest the compound, but may not assign its CAS to this solution", changed, onTestMain { model.current })
        assertEquals("", onTestMain { model.current!!.cas })
        awaitPersisted(fixture, changed)
    }

    @Test fun unrelatedFieldsEditedDuringAutomaticLookupArePreservedWhenCasIsFilled() {
        val fixture = fixture()
        val lookup = controlledLookup()
        val (model, _) = createModel(fixture, autoLookup = true, lookup = lookup::find)
        val original = draft()
        onTestMain { model.updateDraft(original) }
        lookup.awaitStarted()

        val changed = original.copy(amount = "250", room = "2-202", notes = "Reviewed bottle on second shelf", reviewed = false)
        onTestMain { model.updateDraft(changed) }
        lookup.release.countDown()
        awaitTestCondition { onTestMain { model.current?.cas == ethanol.cas } }

        val filled = onTestMain { model.current!! }
        assertEquals(changed.amount, filled.amount)
        assertEquals(changed.room, filled.room)
        assertEquals(changed.notes, filled.notes)
        assertEquals(changed.id, filled.id)
        assertEquals(1, lookup.calls.get())
        assertEquals("", filled.casUnavailableReason)
        assertFalse(filled.reviewed)
        awaitPersisted(fixture, filled)
    }

    private inner class ControlledLookup {
        private val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()

        fun find(query: String): CasLookupResult {
            calls.incrementAndGet()
            if (query != "Ethanol") return CasLookupResult(query, message = "No fixture match", status = CasLookupStatus.NOT_FOUND)
            started.countDown()
            check(release.await(10, TimeUnit.SECONDS)) { "The test did not release its mocked CAS lookup." }
            return ethanolResult(query)
        }

        fun awaitStarted() {
            assertTrue("The mocked CAS lookup did not start", started.await(10, TimeUnit.SECONDS))
        }
    }
}
