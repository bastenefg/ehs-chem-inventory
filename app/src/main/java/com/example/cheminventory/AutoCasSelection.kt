package com.example.cheminventory

/**
 * Select only a single complete-name database match for an otherwise unfilled draft.
 * This fills a field, not the record's human-review checkbox. The caller must label the
 * source as an automatic PubChem lookup and keep reviewed=false until ordinary review.
 */
internal fun automaticCasCandidate(record: InventoryRecord, result: CasLookupResult): CasCandidate? {
    val name = record.chemicalName.trim()
    if (record.syncState != "draft" || record.cas.isNotBlank() || name.isEmpty() ||
        result.status != CasLookupStatus.FOUND || result.truncated || result.query != name ||
        result.matchedCompoundCount != 1
    ) return null

    // A concentration alone does not distinguish a solution from a reagent purity claim.
    // Keep those database matches available for review instead of assigning a component CAS
    // to a whole product. Do not strip salts, hydrates, percentages, or solvent qualifiers.
    if (record.concentration.isNotBlank() || hasCompositionQualifier(name) ||
        !casReasonAllowsAutomaticLookup(record.casUnavailableReason)) return null

    val candidate = result.candidates.singleOrNull() ?: return null
    if (candidate.cid <= 0 || !isValidCas(candidate.cas) || candidate.title.isBlank() ||
        hasCompositionQualifier(candidate.title)
    ) return null
    // A name lookup must not undo the label reader's ambiguity guard. Use the current draft's
    // transcription: the user may have corrected it while the database request was running.
    val printedNumbers = casNumbersInLabelText(record.labelText)
    if (printedNumbers.size > 1 || printedNumbers.singleOrNull()?.let { it != candidate.cas } == true) return null
    return candidate
}

/** Preserve declarations of no applicable CAS; only clearly unresolved explanations permit autofill. */
private fun casReasonAllowsAutomaticLookup(value: String): Boolean {
    if (value.isBlank()) return true
    if (hasCompositionQualifier(value) || EXPLICIT_NO_CAS.containsMatchIn(value)) return false
    return UNRESOLVED_CAS.containsMatchIn(value)
}

private val EXPLICIT_NO_CAS = Regex(
    "\\b(?:not\\s+applicable|n\\s*/\\s*a|unassigned|not\\s+(?:assigned|registered)|" +
        "no\\s+(?:single\\s+|assigned\\s+)?cas(?:\\s+(?:number|rn))?\\s*(?:exists|assigned|applicable|\\.?$)|" +
        "cas(?:\\s+(?:number|rn))?\\s+(?:(?:is|was|has\\s+been)\\s+)?(?:not\\s+(?:assigned|applicable)|does\\s+not\\s+exist)|" +
        "multiple\\s+cas)\\b", RegexOption.IGNORE_CASE
)

private val UNRESOLVED_CAS = Regex(
    "\\b(?:unknown|unresolved|unreadable|illegible|missing|" +
        "not\\s+(?:visible|readable|legible|found|printed|shown|listed|provided|available|on\\s+(?:the\\s+)?label)|" +
        "no\\s+cas(?:\\s+(?:number|rn))?\\s+(?:was\\s+)?(?:found|visible|printed|shown|listed|on\\s+(?:the\\s+)?label))\\b",
    RegexOption.IGNORE_CASE
)

private fun hasCompositionQualifier(value: String): Boolean =
    value.contains('%') || value.contains('％') || COMPOSITION_WORDS.containsMatchIn(value) ||
        COMPOSITION_RATIO.containsMatchIn(value) || SOLVENT_QUALIFIER.containsMatchIn(value)

private val COMPOSITION_WORDS = Regex(
    "\\b(?:solution|mixture|mix|blend|buffer|formulation|cocktail|aqueous|suspension|emulsion|denatured)\\b",
    RegexOption.IGNORE_CASE
)
private val COMPOSITION_RATIO = Regex("\\b(?:v\\s*/\\s*v|w\\s*/\\s*v|w\\s*/\\s*w)\\b", RegexOption.IGNORE_CASE)
private val SOLVENT_QUALIFIER = Regex("\\bin\\s+\\S+", RegexOption.IGNORE_CASE)
