package com.example.cheminventory

import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

/** Offline protocol fixtures; no network or lab credentials are needed by these tests. */
class CasLookupTest {
    private fun properties(vararg compounds: Pair<Long, String>): JSONObject = JSONObject().put("PropertyTable",
        JSONObject().put("Properties", JSONArray().apply {
            compounds.forEach { (cid, title) -> put(JSONObject().put("CID", cid).put("Title", title)
                .put("MolecularFormula", "C2H6O").put("IUPACName", title.lowercase())) }
        }))

    private fun identifiers(vararg compounds: Pair<Long, List<String>>): JSONObject = JSONObject().put("InformationList",
        JSONObject().put("Information", JSONArray().apply {
            compounds.forEach { (cid, values) -> put(JSONObject().put("CID", cid).put("Identifiers", JSONArray().apply {
                values.forEach { put(JSONObject().put("Type", "CAS").put("Identifier", it)) }
            })) }
        }))

    private fun ethanol() = properties(702L to "Ethanol")
    private fun ethanolCas() = identifiers(702L to listOf("64-17-5"))

    @Test fun exactNameUsesOnlyNameFormAndFixedCredentialFreeEndpoints() {
        val requests = mutableListOf<Request>()
        val api = CasLookup({ request ->
            requests += request
            if (requests.size == 1) ethanol() else ethanolCas()
        })
        val result = api.lookup(" Ethanol ")
        assertEquals(CasLookupStatus.FOUND, result.status)
        assertEquals(1, result.matchedCompoundCount)
        assertEquals("Ethanol", result.query)
        assertEquals(2, requests.size)
        val search = requests[0]
        assertEquals("POST", search.method)
        assertEquals("complete", search.url.queryParameter("name_type"))
        val form = search.body as FormBody
        assertEquals(1, form.size)
        assertEquals("name", form.name(0))
        assertEquals("Ethanol", form.value(0))
        assertEquals("GET", requests[1].method)
        assertEquals("CAS", requests[1].url.queryParameter("identifier_type"))
        requests.forEach {
            assertEquals("https", it.url.scheme)
            assertEquals("pubchem.ncbi.nlm.nih.gov", it.url.host)
            assertNull(it.header("Authorization"))
            assertNull(it.header("Cookie"))
        }
        val candidate = result.candidates.single()
        assertEquals("64-17-5", candidate.cas)
        assertEquals("Ethanol", candidate.title)
        assertEquals("C2H6O", candidate.molecularFormula)
        assertEquals("ethanol", candidate.iupacName)
        assertEquals("https://pubchem.ncbi.nlm.nih.gov/compound/702", candidate.sourceUrl)
    }

    @Test fun chemicalQualifiersAndUrlCharactersAreNeverStrippedOrBroadened() {
        val name = "Copper(II) sulfate pentahydrate / reagent + salt?&name=ethanol"
        var calls = 0
        val api = CasLookup({ request ->
            calls++
            assertEquals(name, (request.body as FormBody).value(0))
            assertFalse(request.url.encodedPath.contains("ethanol"))
            throw CasLookupHttpException(404)
        })
        val result = api.lookup(name)
        assertEquals(name, result.query)
        assertEquals(1, calls)
        assertEquals(CasLookupStatus.NOT_FOUND, result.status)
        assertTrue(result.message.contains("does not mean"))
    }

    @Test fun multipleCompoundsAndMultipleCasNumbersStayVisibleAsProposals() {
        var call = 0
        val api = CasLookup({
            if (++call == 1) properties(702L to "Ethanol", 111L to "Another exact-name match")
            else identifiers(702L to listOf("64-17-5", "67-56-1"), 111L to listOf("7732-18-5"))
        })
        val result = api.lookup("Ambiguous name")
        assertEquals(3, result.candidates.size)
        assertEquals(2, result.matchedCompoundCount)
        assertTrue(result.message.contains("Multiple matches"))
        assertFalse(result.truncated)
        assertEquals(listOf(702L, 702L, 111L), result.candidates.map { it.cid })
    }

    @Test fun onlyCasIdentifiersWithValidChecksumsFromRequestedCompoundsAreUsed() {
        var call = 0
        val api = CasLookup({
            if (++call == 1) ethanol() else identifiers(702L to listOf("64-17-5", "64-17-6", "64-17-5", "not CAS"),
                999L to listOf("7732-18-5")).apply {
                getJSONObject("InformationList").getJSONArray("Information").getJSONObject(0).apply {
                    put("RN", JSONArray().put("67-56-1"))
                    getJSONArray("Identifiers").put(JSONObject().put("Type", "RegistryID").put("Identifier", "67-56-1"))
                }
            }
        })
        assertEquals(listOf("64-17-5"), api.lookup("Ethanol").candidates.map { it.cas })
    }

    @Test fun identifierLookupRequestsOnlyFirstFiveCompoundsAndDisclosesOmissions() {
        var call = 0
        val api = CasLookup({ request ->
            if (++call == 1) properties(*(1L..7L).map { it to "Compound $it" }.toTypedArray())
            else {
                assertEquals("/rest/pug/compound/cid/1,2,3,4,5/identifiers/JSON", request.url.encodedPath)
                identifiers(*(1L..5L).map { it to listOf("64-17-5") }.toTypedArray())
            }
        })
        val result = api.lookup("Ambiguous name")
        assertEquals(2, call)
        assertEquals(5, result.candidates.size)
        assertEquals(7, result.matchedCompoundCount)
        assertTrue(result.truncated)
        assertTrue(result.message.contains("More matches"))
    }

    @Test fun excessiveCasCandidatesAreCappedWithoutPretendingUniqueMatch() {
        var call = 0
        val cases = (10..34).map { prefix ->
            val digits = "${prefix}00"
            val checksum = digits.reversed().mapIndexed { index, digit -> (index + 1) * digit.digitToInt() }.sum() % 10
            "$prefix-00-$checksum"
        }
        val api = CasLookup({ if (++call == 1) ethanol() else identifiers(702L to cases) })
        val result = api.lookup("Ethanol")
        assertEquals(20, result.candidates.size)
        assertTrue(result.truncated)
    }

    @Test fun invalidQueriesDoNotMakeNetworkRequests() {
        val api = CasLookup({ fail("Invalid queries must stay local"); JSONObject() })
        listOf("", "  ", "x".repeat(513), "ethanol\u0000", "ethanol\nwater").forEach {
            assertEquals(CasLookupStatus.INVALID_QUERY, api.lookup(it).status)
        }
    }

    @Test fun failedLookupIsSanitizedAndNeverCached() {
        var calls = 0
        val api = CasLookup({ calls++; throw IOException("secret-sensitive-response") })
        repeat(2) {
            val result = api.lookup("Ethanol")
            assertEquals(CasLookupStatus.UNAVAILABLE, result.status)
            assertTrue(result.candidates.isEmpty())
            assertFalse(result.message.contains("secret"))
        }
        assertEquals(2, calls)
    }

    @Test fun successfulExactQueryCacheExpiresAndDoesNotCombineSimilarNames() {
        var calls = 0
        var time = 0L
        val api = CasLookup({ if (++calls % 2 == 1) ethanol() else ethanolCas() }, { time })
        api.lookup("Ethanol")
        time = 100
        api.lookup(" Ethanol ")
        assertEquals(2, calls)
        api.lookup("Ethanol solution")
        assertEquals(4, calls)
        time = 15 * 60 * 1_000L
        api.lookup("Ethanol")
        assertEquals(6, calls)
    }

    @Test fun successfulCacheHasBoundedEntryCount() {
        var calls = 0
        val api = CasLookup({ if (++calls % 2 == 1) ethanol() else ethanolCas() }, { 0L })
        repeat(33) { api.lookup("Name $it") }
        assertEquals(66, calls)
        api.lookup("Name 0")
        assertEquals(68, calls)
    }

    @Test fun emptyOrMissingCasResultsNeverDeclareCasDoesNotExist() {
        var calls = 0
        val api = CasLookup({ if (++calls % 2 == 1) ethanol() else identifiers(702L to emptyList()) })
        val result = api.lookup("Ethanol")
        assertEquals(CasLookupStatus.NOT_FOUND, result.status)
        assertEquals(1, result.matchedCompoundCount)
        assertTrue(result.message.contains("does not mean"))
        assertTrue(result.candidates.isEmpty())
        api.lookup("Ethanol")
        assertEquals(4, calls)
    }

    @Test fun aSecondCompoundWithoutCasStillMakesTheNameAmbiguous() {
        var calls = 0
        val api = CasLookup({
            if (++calls == 1) properties(702L to "Ethanol", 999L to "Another compound")
            else identifiers(702L to listOf("64-17-5"), 999L to emptyList())
        })
        val result = api.lookup("Ambiguous name")
        assertEquals(CasLookupStatus.FOUND, result.status)
        assertEquals(1, result.candidates.size)
        assertEquals(2, result.matchedCompoundCount)
        assertTrue(result.message.contains("Multiple matches"))
        assertNull(automaticCasCandidate(InventoryRecord(chemicalName = "Ambiguous name"), result))
    }

    @Test fun malformedPropertyAndIdentifierResponsesReturnActionableErrors() {
        listOf(JSONObject(), JSONObject().put("PropertyTable", JSONObject().put("Properties", JSONArray().put(JSONObject().put("CID", 702.5).put("Title", "wrong"))))).forEach { malformed ->
            val result = CasLookup({ malformed }).lookup("Ethanol")
            assertEquals(CasLookupStatus.UNAVAILABLE, result.status)
            assertTrue(result.candidates.isEmpty())
        }
        var calls = 0
        val result = CasLookup({ if (++calls == 1) ethanol() else JSONObject() }).lookup("Ethanol")
        assertEquals(CasLookupStatus.UNAVAILABLE, result.status)
    }

    @Test fun noExactCompoundStopsAfterFirstCall() {
        var calls = 0
        val result = CasLookup({ calls++; properties() }).lookup("Mixture product")
        assertEquals(1, calls)
        assertEquals(CasLookupStatus.NOT_FOUND, result.status)
        assertTrue(result.candidates.isEmpty())
    }

    @Test fun rateLimitAndServiceErrorsDoNotRetryOrExposeBodies() {
        listOf(429, 503, 403, 302).forEach { status ->
            var calls = 0
            val result = CasLookup({ calls++; throw CasLookupHttpException(status) }).lookup("Ethanol")
            assertEquals(1, calls)
            assertEquals(CasLookupStatus.UNAVAILABLE, result.status)
            assertTrue(result.candidates.isEmpty())
        }
    }

    @Test fun responseSizeBoundAppliesBeforeJsonParsing() {
        val oversized = "{\"text\":\"" + "x".repeat(512_000) + "\"}"
        response(oversized).use {
            assertThrows(IOException::class.java) { parsePubChemResponse(it) }
        }
        response("{\"ok\":true}").use { assertTrue(parsePubChemResponse(it).getBoolean("ok")) }
    }

    @Test fun redirectAndErrorResponsesAreRejectedWithoutReadingSensitiveBody() {
        response("private-detail-do-not-display", 302).use {
            assertEquals(302, assertThrows(CasLookupHttpException::class.java) { parsePubChemResponse(it) }.statusCode)
        }
        response("private-detail-do-not-display", 500).use {
            assertEquals(500, assertThrows(CasLookupHttpException::class.java) { parsePubChemResponse(it) }.statusCode)
        }
    }

    private fun response(text: String, status: Int = 200) = Response.Builder()
        .request(Request.Builder().url("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/JSON").build())
        .protocol(Protocol.HTTP_1_1).code(status).message("Fixture")
        .body(text.toResponseBody("application/json".toMediaType())).build()
}
