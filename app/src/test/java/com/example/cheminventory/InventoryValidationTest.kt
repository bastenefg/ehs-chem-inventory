package com.example.cheminventory

import org.junit.Assert.*
import org.junit.Test

class InventoryValidationTest {
    private val valid = InventoryRecord(
        pi = "Example PI", room = "1-101", chemicalName = "Ethanol", amount = "500", unit = "mL",
        physicalState = "Liquid", cas = "64-17-5", reviewed = true
    )

    @Test fun reviewedCompleteRecordPasses() { assertTrue(validateRecord(valid).isEmpty()) }

    @Test fun casChecksBothFormatAndChecksum() {
        listOf("64-17-5", "67-56-1", "7732-18-5", " 64-17-5 ").forEach { assertTrue(it, isValidCas(it)) }
        listOf("64-17-6", "64175", "6-17-5", "12345678-12-3", "ethanol", "").forEach { assertFalse(it, isValidCas(it)) }
    }

    @Test fun noCasRequiresAnExplanationAndNeverSkipsInvalidCas() {
        assertTrue(validateRecord(valid.copy(cas = "")).containsKey("casUnavailableReason"))
        assertTrue(validateRecord(valid.copy(cas = "", casUnavailableReason = "Proprietary mixture; see SDS")).isEmpty())
        assertTrue(validateRecord(valid.copy(cas = "64-17-6", casUnavailableReason = "Unknown")).containsKey("cas"))
    }

    @Test fun quantitiesRejectZeroNegativeNonfiniteAndExpressions() {
        listOf("0", "0.00", "-2", "NaN", "Infinity", "1,000", "1e999", "=1+1", " ").forEach {
            assertTrue(it, validateRecord(valid.copy(amount = it)).containsKey("amount"))
        }
        listOf(".5", "0.01", "500", " 12.50 ").forEach {
            assertFalse(it, validateRecord(valid.copy(amount = it)).containsKey("amount"))
        }
    }

    @Test fun containerCountMustBeAPositiveWholeNumber() {
        listOf("0", "-1", "1.5", "NaN", "2147483648", "1000001", "1e2").forEach {
            assertTrue(it, validateRecord(valid.copy(containerCount = it)).containsKey("containerCount"))
        }
        assertFalse(validateRecord(valid.copy(containerCount = "12")).containsKey("containerCount"))
    }

    @Test fun optionalExpiryRejectsImpossibleDates() {
        assertFalse(validateRecord(valid.copy(expiryDate = "2028-02-29")).containsKey("expiryDate"))
        listOf("2027-02-29", "2026-13-01", "09/06/2026").forEach {
            assertTrue(it, validateRecord(valid.copy(expiryDate = it)).containsKey("expiryDate"))
        }
    }

    @Test fun identityUnitsStateAndHumanReviewAreRequired() {
        val errors = validateRecord(valid.copy(pi = " ", room = "", chemicalName = "", unit = "bottle", physicalState = "unknown", reviewed = false))
        assertTrue(errors.keys.containsAll(listOf("pi", "room", "chemicalName", "unit", "physicalState", "reviewed")))
    }

    @Test fun locationRequiresBothBuildingAndRoom() {
        listOf("1-101", "N52-496", " 76-123A ").forEach {
            assertFalse(it, validateRecord(valid.copy(room = it)).containsKey("room"))
        }
        listOf("", "101", "N52", "N52-", "-496", "N52 496").forEach {
            assertTrue(it, validateRecord(valid.copy(room = it)).containsKey("room"))
        }
    }

    @Test fun credentialsCanOnlyGoToTheApprovedHttpsParleyApiHost() {
        listOf("https://parley.api.mit.edu/v1", "https://parley.api.mit.edu/v1/", "https://PARLEY.API.MIT.EDU/v1",
            "https://parley.api.mit.edu:443/v1").forEach { assertTrue(it, isValidParleyBaseUrl(it)) }
        listOf("https://mit.edu/v1", "https://www.mit.edu/v1", "https://lab.mit.edu/v1", "https://personal.mit.edu/v1",
            "https://parley.mit.edu/v1", "https://other.parley.api.mit.edu/v1", "https://parley.api.mit.edu.example.org/v1",
            "http://parley.api.mit.edu/v1", "https://mit.edu.example.org/v1", "https://example.org/mit.edu", "https://user:secret@parley.api.mit.edu/v1", "https://parley.api.mit.edu/v1?key=secret", "https://parley.api.mit.edu/v1#key", "https://parley.api.mit.edu:8080/v1").forEach {
            assertFalse(it, isValidParleyBaseUrl(it))
        }
    }

    @Test fun sheetConnectionAcceptsOnlyDeploymentExecRoutes() {
        val endpoint = "https://script.google.com/macros/s/deployment-id_123/exec"
        assertTrue(isValidSheetEndpoint(endpoint))
        assertEquals(endpoint, normalizedSheetEndpoint(" $endpoint/ "))
        listOf("$endpoint?token=secret", "$endpoint#secret", endpoint.replace("/exec", "/dev"), endpoint.replace("script.google.com", "script.google.com.evil.test"), endpoint.replace("https://", "http://"), "https://script.google.com/macros/s/id/../exec").forEach {
            assertFalse(it, isValidSheetEndpoint(it))
        }
    }

    @Test fun canonicalSheetLinksRejectUnrelatedDocumentsAndQueries() {
        assertTrue(isValidSheetUrl("https://docs.google.com/spreadsheets/d/example_123/edit"))
        assertTrue(isValidSheetUrl("https://docs.google.com/spreadsheets/d/example_123"))
        assertFalse(isValidSheetUrl("https://docs.google.com/document/d/example_123/edit"))
        assertFalse(isValidSheetUrl("https://docs.google.com/spreadsheets/d/example_123/edit?token=secret"))
    }

    @Test fun editsPreserveIdAndCreationTimeForIdempotentRetries() {
        val edited = valid.copy(chemicalName = "Ethanol 95%", syncState = "pending")
        assertEquals(valid.id, edited.id)
        assertEquals(valid.createdAt, edited.createdAt)
        assertNotEquals(valid.id, InventoryRecord().id)
    }

    @Test fun fieldLengthsMatchWorksheetLimitsWithoutSilentlyTruncating() {
        assertFalse(validateRecord(valid.copy(chemicalName = "a".repeat(512))).containsKey("chemicalName"))
        assertTrue(validateRecord(valid.copy(chemicalName = "a".repeat(513))).containsKey("chemicalName"))
        assertFalse(validateRecord(valid.copy(labelText = "a".repeat(16_000))).containsKey("labelText"))
        assertTrue(validateRecord(valid.copy(labelText = "a".repeat(16_001))).containsKey("labelText"))
        assertFalse(validateRecord(valid.copy(notes = "a".repeat(4_000))).containsKey("notes"))
        assertTrue(validateRecord(valid.copy(notes = "a".repeat(4_001))).containsKey("notes"))
    }

    @Test fun controlCharactersAreRejectedButReadableMultilineTextIsAllowed() {
        assertTrue(validateRecord(valid.copy(notes = "Line one\nLine two\tcomment")).isEmpty())
        assertTrue(validateRecord(valid.copy(notes = "Hidden\u0000character")).containsKey("notes"))
    }

    @Test fun appendPreflightRejectsSetupTyposAndMovingRecordsBetweenLabs() {
        val settings = LabSettings(sheetEndpoint = "https://script.google.com/macros/s/lab-a/exec", sheetToken = "token")
        assertNull(validateAppendSettings(settings, valid))
        assertNull(validateAppendSettings(settings, valid.copy(destinationEndpoint = settings.sheetEndpoint + "/")))
        assertNotNull(validateAppendSettings(settings.copy(sheetToken = ""), valid))
        assertNotNull(validateAppendSettings(settings.copy(sheetEndpoint = "wrong-url"), valid))
        assertNotNull(validateAppendSettings(settings, valid.copy(destinationEndpoint = "https://script.google.com/macros/s/lab-b/exec")))
        assertNotNull(validateAppendSettings(settings.copy(sheetUrl = "https://example.org"), valid))
    }
}
