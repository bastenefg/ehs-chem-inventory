package com.example.cheminventory

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ScanExtractionTest {
    private val settings = LabSettings(parleyModel = "gpt-5", fastScan = true,
        pi = "Example PI", room = "1-101", sheetEndpoint = "https://script.google.com/macros/s/example/exec")

    private fun response(labelText: String, cas: String = "", finishReason: String = "stop"): JSONObject {
        val record = JSONObject().put("chemicalName", "Ethanol").put("amount", "500")
            .put("unit", "mL").put("cas", cas).put("labelText", labelText)
        return JSONObject().put("choices", JSONArray().put(JSONObject().put("finish_reason", finishReason)
            .put("message", JSONObject().put("content", record.toString()))))
    }

    @Test fun knownOriginalGpt5ModelsUseMinimalReasoningWithRoomForLabelText() {
        listOf("gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-2025-08-07", "gpt-5-mini-2025-08-07", "gpt-5-nano-2025-08-07").forEach {
            val request = buildScanRequest(settings.copy(parleyModel = it), "jpeg")
            assertEquals(it, "minimal", request.getString("reasoning_effort"))
            assertEquals(it, 6000, request.getInt("max_completion_tokens"))
            assertFalse(request.has("max_tokens"))
            assertFalse(request.has("temperature"))
        }
    }

    @Test fun disablingFastScanRestoresGatewayCompatibleParameters() {
        val request = buildScanRequest(settings.copy(fastScan = false), "jpeg")
        assertFalse(request.has("reasoning_effort"))
        assertFalse(request.has("max_completion_tokens"))
        assertEquals("gpt-5", request.getString("model"))
    }

    @Test fun otherModelsAndGatewayAliasesDoNotReceiveUnverifiedSpeedParameters() {
        listOf("gpt-5.1", "gpt-5.2", "gpt-5-pro", "gpt-5-chat-latest", "gpt-5-2026-01-01", "openai/gpt-5", "gpt-4.1", "claude-sonnet-4", "my-gpt-5").forEach {
            val request = buildScanRequest(settings.copy(parleyModel = it), "jpeg")
            assertFalse(it, request.has("reasoning_effort"))
            assertFalse(it, request.has("max_completion_tokens"))
            assertEquals(it, request.getString("model"))
        }
    }

    @Test fun scanRequestKeepsImageDetailAndSendsNoLabCredentialsOrPersonalFieldsInBody() {
        val request = buildScanRequest(settings.copy(parleyApiKey = "private-api", sheetToken = "private-sheet"), "jpeg")
        val image = request.getJSONArray("messages").getJSONObject(1).getJSONArray("content")
            .getJSONObject(1).getJSONObject("image_url")
        assertEquals("data:image/jpeg;base64,jpeg", image.getString("url"))
        assertFalse(image.has("detail"))
        listOf("private-api", "private-sheet", settings.pi, settings.room, settings.sheetEndpoint).forEach {
            assertFalse(it, request.toString().contains(it))
        }
    }

    @Test fun casIsRecoveredFromLabelEvenWhenModelOmittedCasField() {
        val record = parseScanResponse(settings, response("Ethanol\nCAS: 64-17-5\n500 mL"))
        assertEquals("64-17-5", record.cas)
        assertEquals("label", record.casSource)
        assertFalse(record.reviewed)
        assertEquals(settings.sheetEndpoint, record.destinationEndpoint)
    }

    @Test fun casNormalizesSpacingAndUnicodeDashesWithoutChangingDigits() {
        listOf("64 - 17 - 5", "64\u00a0-\u00a017\u00a0-\u00a05", "64\u201117\u20115", "64\u201317\u22125", "64 -\n17 - 5").forEach {
            assertEquals(it, "64-17-5", casFromLabelText("CAS RN: $it"))
        }
    }

    @Test fun repeatedSameCasRemainsUnambiguous() {
        assertEquals("64-17-5", casFromLabelText("CAS 64-17-5; CAS RN 64 - 17 - 5"))
    }

    @Test fun differentMixtureCasNumbersStayBlankDespiteModelPickingOne() {
        val record = parseScanResponse(settings, response("Ethanol 64-17-5\nWater 7732-18-5", "64-17-5"))
        assertEquals("", record.cas)
        assertEquals("", record.casSource)
    }

    @Test fun anotherMalformedCasAlsoPreventsAutomaticMixtureSelection() {
        assertEquals("", casFromLabelText("64-17-5; 7732-18-6"))
    }

    @Test fun generatedCasNeverSubstitutesForMissingTranscriptionEvidence() {
        assertEquals("", parseScanResponse(settings, response("Ethanol 500 mL", "64-17-5")).cas)
        assertEquals("7732-18-5", parseScanResponse(settings, response("CAS 7732-18-5", "64-17-5")).cas)
    }

    @Test fun invalidOrEmbeddedNumbersAreNotRepairedOrAccepted() {
        listOf("64-17-6", "64175", "64-I7-5", "1234567864-17-5", "64-17-50", "A64-17-5", "64-17-5B", "2026-09-07").forEach {
            assertEquals(it, "", casFromLabelText(it))
        }
    }

    @Test fun truncatedButParseableRecordIsRejectedWithManualRetryGuidance() {
        val error = assertThrows(InventoryApiException::class.java) {
            parseScanResponse(settings, response("CAS 64-17-5", finishReason = "length"))
        }
        assertTrue(error.message.orEmpty().contains("Turn off Fast scan"))
    }

    @Test fun emptyResponseIncludesFastModeEscapeHatch() {
        val error = assertThrows(InventoryApiException::class.java) { parseScanResponse(settings, JSONObject()) }
        assertTrue(error.message.orEmpty().contains("Turn off Fast scan"))
    }

    @Test fun malformedRecordNeverSilentlyCreatesAnEmptyDraft() {
        val json = JSONObject().put("choices", JSONArray().put(JSONObject()
            .put("message", JSONObject().put("content", "not a JSON record"))))
        assertThrows(InventoryApiException::class.java) { parseScanResponse(settings.copy(fastScan = false), json) }
    }
}
