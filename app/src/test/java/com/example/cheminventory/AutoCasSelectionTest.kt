package com.example.cheminventory

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AutoCasSelectionTest {
    private val record = InventoryRecord(chemicalName = "Ethanol")
    private val candidate = CasCandidate("64-17-5", "Ethanol", "C2H6O", "ethanol", 702L)
    private val result = CasLookupResult("Ethanol", listOf(candidate), "Fixture", CasLookupStatus.FOUND,
        matchedCompoundCount = 1)

    @Test fun oneExactNameAndOneCasCanFillAnUnfilledDraftWithoutMutatingIt() {
        val original = record.copy()
        assertEquals(candidate, automaticCasCandidate(record, result))
        assertEquals(original, record)
        assertEquals("", record.cas)
        assertFalse(record.reviewed)
        assertEquals("", record.casSource)
    }

    @Test fun existingCasAndNonDraftRecordsAreNeverSelectedForAutomaticReplacement() {
        assertNull(automaticCasCandidate(record.copy(cas = "67-56-1"), result))
        assertNull(automaticCasCandidate(record.copy(cas = "an unreadable number"), result))
        listOf("pending", "syncing", "synced", "unknown").forEach { state ->
            assertNull(state, automaticCasCandidate(record.copy(syncState = state), result))
        }
    }

    @Test fun resultMustMatchTheFullCurrentNameIncludingChemicalForm() {
        assertEquals(candidate, automaticCasCandidate(record.copy(chemicalName = " Ethanol "), result))
        assertNull(automaticCasCandidate(record.copy(chemicalName = "Methanol"), result))
        assertNull(automaticCasCandidate(record.copy(chemicalName = ""), result))
        assertNull(automaticCasCandidate(record, result.copy(query = "ethanol")))
        assertNull(automaticCasCandidate(record, result.copy(query = "Ethanol hydrate")))
    }

    @Test fun unknownCompoundCountOrAnotherCompoundWithoutACasPreventsAutomaticChoice() {
        listOf(null, 0, 2, 5).forEach { count ->
            assertNull("count=$count", automaticCasCandidate(record, result.copy(matchedCompoundCount = count)))
        }
        assertNull(automaticCasCandidate(record, result.copy(truncated = true)))
    }

    @Test fun multipleCandidatesRemainForManualReviewEvenForOneCompound() {
        val second = candidate.copy(cas = "67-56-1")
        assertNull(automaticCasCandidate(record, result.copy(candidates = listOf(candidate, second))))
        assertNull(automaticCasCandidate(record, result.copy(candidates = listOf(candidate, candidate.copy(cid = 703L)))))
        assertNull(automaticCasCandidate(record, result.copy(candidates = emptyList())))
    }

    @Test fun unavailableOrInvalidLookupResultsNeverFillCas() {
        CasLookupStatus.entries.filter { it != CasLookupStatus.FOUND }.forEach { status ->
            assertNull(automaticCasCandidate(record, result.copy(status = status)))
        }
        listOf(candidate.copy(cas = "64-17-6"), candidate.copy(cas = ""), candidate.copy(cid = 0),
            candidate.copy(cid = -1), candidate.copy(title = " ")).forEach {
            assertNull(automaticCasCandidate(record, result.copy(candidates = listOf(it))))
        }
    }

    @Test fun explicitMixturesSolutionsAndCompositionQualifiersAreNotAutoAssignedAComponentCas() {
        listOf("Ethanol 70%", "Ethanol 70％", "Ethanol solution", "Aqueous ethanol", "Ethanol mixture",
            "Ethanol mix", "Ethanol blend", "Ethanol formulation", "Ethanol buffer", "Denatured ethanol",
            "Ethanol in water", "Ethanol in acetonitrile", "Ethanol 1:1 v/v", "Ethanol w / v", "Ethanol w/w",
            "Ethanol suspension", "Ethanol emulsion", "Ethanol cocktail").forEach { name ->
            assertNull(name, automaticCasCandidate(record.copy(chemicalName = name), result.copy(query = name)))
        }
        assertNull(automaticCasCandidate(record, result.copy(candidates = listOf(candidate.copy(title = "Ethanol solution")))))
    }

    @Test fun ambiguousConcentrationKeepsSuggestionsUnapplied() {
        listOf("70%", "1 M", "99.5%", "Purity 97%", "v/v").forEach { concentration ->
            assertNull(concentration, automaticCasCandidate(record.copy(concentration = concentration), result))
        }
        assertEquals(candidate, automaticCasCandidate(record.copy(concentration = " "), result))
    }

    @Test fun unreadableCasExplanationDoesNotBlockAnExactNameMatch() {
        listOf("CAS unreadable on label", "CAS was unreadable on the label", "Unknown", "CAS missing",
            "Not on the label", "No CAS number found", "No CAS on the label", "CAS is not visible").forEach { reason ->
            assertEquals(reason, candidate, automaticCasCandidate(record.copy(casUnavailableReason = reason), result))
        }
    }

    @Test fun explicitNoCasOrMixtureExplanationsAreNeverErasedByAutoLookup() {
        listOf("No CAS", "No CAS number exists", "CAS is not assigned", "No single CAS assigned",
            "CAS does not exist", "Not applicable", "N/A", "Unassigned", "Multiple CAS numbers in supplier SDS",
            "Proprietary mixture; CAS unknown", "CAS unreadable; blend of ingredients",
            "No CAS assigned; label unreadable", "See supplier documentation for this product").forEach { reason ->
            assertNull(reason, automaticCasCandidate(record.copy(casUnavailableReason = reason), result))
        }
    }

    @Test fun nameLookupCannotOverrideTheLabelReadersMixtureAmbiguity() {
        listOf("Ethanol CAS 64-17-5; Water CAS 7732-18-5", "CAS 64 - 17 - 5; CAS 7732\u201118\u20116").forEach { label ->
            val extracted = JSONObject().put("chemicalName", "Ethanol").put("labelText", label).put("cas", "64-17-5")
            val response = JSONObject().put("choices", JSONArray().put(JSONObject()
                .put("message", JSONObject().put("content", extracted.toString()))))
            val scanned = parseScanResponse(LabSettings(), response)
            assertEquals(label, "", scanned.cas)
            assertNull(label, automaticCasCandidate(scanned, result))
        }
    }

    @Test fun conflictingCurrentLabelNumberPreventsNameBasedAutofill() {
        listOf("CAS 7732-18-5", "CAS 64-17-6").forEach { label ->
            assertNull(label, automaticCasCandidate(record.copy(labelText = label), result))
        }
        assertEquals(candidate, automaticCasCandidate(record.copy(labelText = "64-17-5; 64 - 17 - 5"), result))
    }

    @Test fun currentExplanationAndTranscriptionAreCheckedRatherThanOnlyLookupQuery() {
        assertEquals(candidate, automaticCasCandidate(record, result))
        assertNull(automaticCasCandidate(record.copy(casUnavailableReason = "Proprietary mixture"), result))
        assertNull(automaticCasCandidate(record.copy(labelText = "CAS 64-17-5; CAS 7732-18-5"), result))
    }

    @Test fun exactHydratesSaltsAndSynonymsRemainEligibleWithoutRemovingQualifiers() {
        val hydrateName = "Copper(II) sulfate pentahydrate"
        val hydrate = CasCandidate("7758-99-8", "Copper sulfate pentahydrate", "CuH10O9S", "copper;sulfate;pentahydrate", 24463L)
        val hydrateResult = result.copy(query = hydrateName, candidates = listOf(hydrate))
        assertEquals(hydrate, automaticCasCandidate(record.copy(chemicalName = hydrateName), hydrateResult))
        assertNull(automaticCasCandidate(record.copy(chemicalName = "Copper(II) sulfate"), hydrateResult))
        val saltName = "Sodium chloride"
        val salt = CasCandidate("7647-14-5", saltName, "ClNa", "sodium;chloride", 5234L)
        assertEquals(salt, automaticCasCandidate(record.copy(chemicalName = saltName), result.copy(query = saltName, candidates = listOf(salt))))
        assertEquals(candidate, automaticCasCandidate(record.copy(chemicalName = "Ethyl alcohol"), result.copy(query = "Ethyl alcohol")))
    }
}
