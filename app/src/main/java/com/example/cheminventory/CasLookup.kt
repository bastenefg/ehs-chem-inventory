package com.example.cheminventory

import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A database match that still needs the ordinary record review against the label/SDS. */
data class CasCandidate(
    val cas: String,
    val title: String,
    val molecularFormula: String,
    val iupacName: String,
    val cid: Long
) {
    val sourceUrl: String get() = "https://pubchem.ncbi.nlm.nih.gov/compound/$cid"
}

enum class CasLookupStatus { FOUND, NOT_FOUND, INVALID_QUERY, UNAVAILABLE }

data class CasLookupResult(
    val query: String,
    val candidates: List<CasCandidate> = emptyList(),
    val message: String,
    val status: CasLookupStatus,
    val truncated: Boolean = false,
    /** All exact-name compound matches, including compounds that supplied no usable CAS. */
    val matchedCompoundCount: Int? = null
)

/**
 * Public PubChem lookup. Call on Dispatchers.IO. Only the complete chemical name is sent;
 * no Parley key, worksheet credentials, photo, room, or PI is available to this adapter.
 *
 * Two bounded requests: exact-name properties, then CAS-specific identifiers for up to five
 * matched compounds. Do not use xrefs/RN or regex-match synonyms: those include unrelated
 * registry references. A unique match can fill a draft; ordinary label/SDS review remains required.
 * API: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
 */
class CasLookup internal constructor(
    private val fetchJson: (Request) -> JSONObject,
    private val nowMillis: () -> Long = { TimeUnit.NANOSECONDS.toMillis(System.nanoTime()) }
) {
    constructor() : this(::fetchPubChemJson)

    private val cache = linkedMapOf<String, Pair<Long, CasLookupResult>>()

    fun lookup(name: String): CasLookupResult {
        val query = name.trim()
        if (query.isEmpty() || query.length > 512 || query.any { it.isISOControl() }) {
            return CasLookupResult(query, message = "Enter the full chemical name, including any salt or hydrate, before looking up CAS.", status = CasLookupStatus.INVALID_QUERY)
        }
        synchronized(cache) {
            cache[query]?.takeIf { nowMillis() - it.first in 0 until CACHE_TTL_MILLIS }?.let { return it.second }
        }
        val result = try {
            // Form encoding preserves slashes, charges, punctuation, and hydrate/salt qualifiers.
            // A complete synonym match is required; there is no broad/fuzzy-name fallback.
            val nameRequest = Request.Builder()
                .url("$PUBCHEM_API/name/property/Title,MolecularFormula,IUPACName/JSON?name_type=complete")
                .header("Accept", "application/json")
                .post(FormBody.Builder().add("name", query).build())
                .build()
            val properties = fetchJson(nameRequest).optJSONObject("PropertyTable")?.optJSONArray("Properties")
                ?: throw IOException()
            if (properties.length() == 0) return notFound(query)
            val compounds = linkedMapOf<Long, CasCompound>()
            for (i in 0 until properties.length()) {
                val value = properties.optJSONObject(i) ?: throw IOException()
                val cid = positiveCid(value.opt("CID")) ?: throw IOException()
                val title = boundedText(value, "Title")
                val iupac = boundedText(value, "IUPACName")
                if (title.isEmpty() && iupac.isEmpty()) throw IOException()
                compounds.putIfAbsent(cid, CasCompound(cid, title.ifEmpty { iupac }, boundedText(value, "MolecularFormula"), iupac))
            }
            val selected = compounds.values.take(MAX_COMPOUNDS)
            val ids = selected.joinToString(",") { it.cid.toString() }
            val identifierRequest = Request.Builder()
                .url("$PUBCHEM_API/cid/$ids/identifiers/JSON?identifier_type=CAS")
                .header("Accept", "application/json").get().build()
            val identifiers = fetchJson(identifierRequest).optJSONObject("InformationList")?.optJSONArray("Information")
                ?: throw IOException()
            val candidates = parseCasIdentifiers(selected, identifiers)
            val truncated = compounds.size > MAX_COMPOUNDS || candidates.size > MAX_CANDIDATES
            if (candidates.isEmpty()) {
                CasLookupResult(query, message = if (truncated)
                    "The name has many matches, and the first five have no usable CAS identifier. Refine the full chemical name or check the supplier SDS."
                else "PubChem found the name but no usable CAS identifier. Check the supplier SDS; this does not mean the product has no CAS number.",
                    status = CasLookupStatus.NOT_FOUND, truncated = truncated, matchedCompoundCount = compounds.size)
            } else {
                CasLookupResult(query, candidates.take(MAX_CANDIDATES), message = when {
                    truncated -> "More matches exist. Refine the name or check the supplier SDS before choosing a CAS number."
                    compounds.size > 1 || candidates.size > 1 -> "Multiple matches found. Check the exact chemical, salt/hydrate, and product composition against the supplier SDS."
                    else -> "PubChem found one exact-name match. Check the CAS and chemical form against the label or supplier SDS when reviewing the record."
                }, status = CasLookupStatus.FOUND, truncated = truncated, matchedCompoundCount = compounds.size)
            }
        } catch (error: CasLookupHttpException) {
            when (error.statusCode) {
                404 -> notFound(query)
                429, 503 -> unavailable(query, "PubChem is busy. Wait a moment and try again, or check the supplier SDS.")
                else -> unavailable(query, "PubChem could not complete the lookup. Try again later or check the supplier SDS.")
            }
        } catch (_: IOException) {
            unavailable(query, "PubChem could not be reached or returned an unusable response. Try again or check the supplier SDS.")
        } catch (_: Exception) {
            unavailable(query, "PubChem returned an unusable response. Check the full name or use the supplier SDS.")
        }
        if (result.status == CasLookupStatus.FOUND) synchronized(cache) {
            cache.remove(query)
            cache[query] = nowMillis() to result
            if (cache.size > 32) cache.remove(cache.keys.first())
        }
        return result
    }

    private fun notFound(query: String) = CasLookupResult(query,
        message = "No exact-name CAS match found. Check the complete chemical name or supplier SDS; a missing result does not mean no CAS number exists.",
        status = CasLookupStatus.NOT_FOUND)

    private fun unavailable(query: String, message: String) = CasLookupResult(query,
        message = message, status = CasLookupStatus.UNAVAILABLE)
}

private data class CasCompound(val cid: Long, val title: String, val formula: String, val iupac: String)

private fun parseCasIdentifiers(compounds: List<CasCompound>, information: JSONArray): List<CasCandidate> {
    val byCid = compounds.associateBy { it.cid }
    val candidates = linkedMapOf<Pair<Long, String>, CasCandidate>()
    for (i in 0 until information.length()) {
        val entry = information.optJSONObject(i) ?: throw IOException()
        val cid = positiveCid(entry.opt("CID")) ?: continue
        val compound = byCid[cid] ?: continue
        val identifiers = entry.optJSONArray("Identifiers") ?: continue
        for (j in 0 until identifiers.length()) {
            val identifier = identifiers.optJSONObject(j) ?: continue
            if (identifier.opt("Type") != "CAS") continue
            val cas = (identifier.opt("Identifier") as? String)?.trim() ?: continue
            if (!isValidCas(cas)) continue
            candidates.putIfAbsent(compound.cid to cas, CasCandidate(cas, compound.title, compound.formula, compound.iupac, compound.cid))
        }
    }
    return candidates.values.toList()
}

private fun positiveCid(value: Any?): Long? = (value as? Number)?.toString()
    ?.takeIf { Regex("[1-9][0-9]*").matches(it) }?.toLongOrNull()

private fun boundedText(value: JSONObject, key: String): String {
    val text = (value.opt(key) as? String)?.trim().orEmpty()
    if (text.length > 2_048 || text.any { it.isISOControl() }) throw IOException()
    return text
}

internal class CasLookupHttpException(val statusCode: Int) : IOException()

private const val PUBCHEM_API = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound"
private const val MAX_COMPOUNDS = 5
private const val MAX_CANDIDATES = 20
private const val MAX_PUBCHEM_RESPONSE_BYTES = 512_000L
private const val CACHE_TTL_MILLIS = 15 * 60 * 1_000L

// Separate credential-free client: it cannot inherit the Parley bearer header or Sheet token.
private val pubChemClient = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .readTimeout(8, TimeUnit.SECONDS)
    .writeTimeout(5, TimeUnit.SECONDS)
    .callTimeout(10, TimeUnit.SECONDS)
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .build()

private val pubChemRateLock = Any()
private var lastPubChemRequestNanos = 0L

private fun fetchPubChemJson(request: Request): JSONObject {
    val url = request.url
    val allowedRoot = PUBCHEM_API.toHttpUrl()
    if (url.scheme != "https" || url.host != allowedRoot.host || url.port != 443 ||
        url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null ||
        !url.encodedPath.startsWith(allowedRoot.encodedPath + "/") || request.header("Authorization") != null
    ) throw IOException()
    // Keep this app below PubChem's per-second limit, including overlapping lookups.
    synchronized(pubChemRateLock) {
        val waitNanos = TimeUnit.MILLISECONDS.toNanos(300) - (System.nanoTime() - lastPubChemRequestNanos)
        if (waitNanos > 0) TimeUnit.NANOSECONDS.sleep(waitNanos)
        lastPubChemRequestNanos = System.nanoTime()
    }
    return pubChemClient.newCall(request).execute().use(::parsePubChemResponse)
}

internal fun parsePubChemResponse(response: Response): JSONObject {
    if (!response.isSuccessful) throw CasLookupHttpException(response.code)
    val source = response.body?.source() ?: throw IOException()
    source.request(MAX_PUBCHEM_RESPONSE_BYTES + 1)
    if (source.buffer.size > MAX_PUBCHEM_RESPONSE_BYTES) throw IOException()
    return JSONObject(source.readUtf8())
}
