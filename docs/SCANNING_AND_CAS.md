# Faster scans and CAS lookup

Version 2.2 shows progress from capture or import through label reading, opens the editable draft before temporary-photo cleanup, and automatically fills eligible missing CAS numbers in the background. It uses the existing worksheet protocol: a working connection needs no connector reinstall, new API key or Google permission.

Version 2.2.1 adds checks so automatic lookup cannot replace multiple/conflicting label CAS numbers or an explicit no-CAS/mixture explanation. Plain missing or unreadable CAS explanations still permit lookup. Parley credentials are restricted to the approved API host `parley.api.mit.edu`.

## Speed

**Fast scan**, enabled by default in Lab setup, uses `reasoning_effort: minimal` and a 6,000-token completion limit for `gpt-5`, `gpt-5-mini`, `gpt-5-nano` and their `2025-08-07` snapshots. Other model IDs keep their normal parameters. Turning Fast scan off restores the previous request settings.

Lower reasoning effort can reduce latency for transcription. MIT Parley may apply its own routing, queues or parameter restrictions, so the actual speedup needs measurement with the lab's account. If a request is rejected, disable Fast scan and retry; the app does not silently issue a second paid request. [GPT-5 parameters](https://developers.openai.com/api/docs/models/gpt-5), [Chat Completions controls](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

An animated progress bar appears immediately during capture or photo import. Photo processing then shows the actual stage: **Preparing photo**, **Reading label**, and **Opening record**, with elapsed seconds. The bar is indeterminate because Parley does not report a completion percentage. The editable fields open as soon as the response has been parsed and the draft saved locally; photo cleanup and CAS lookup do not hold the form closed. Extracted label text is collapsed below the fields.

After a successful scan, the review form and Scan page show Parley request time separately from photo preparation. The Parley measurement includes upload, processing and download, and cannot distinguish model time from MIT queue time. The owner reported a 3–5 second wait with the previous version; this update improves feedback and removes cleanup from the wait but has not been benchmarked through the owner's Parley account. Model request settings and image quality are unchanged from 2.1.

Compare available image-capable models using the same clear label and check accuracy as well as time. Frame the label closely and avoid glare. Image detail is retained because reducing it can hide small CAS print. [Image text limitations](https://developers.openai.com/api/docs/guides/images-vision).

## CAS numbers

1. **Printed CAS:** the app accepts a unique, checksum-valid number from the label transcription, including spaces and common dash characters. It never repairs digits or trusts an unsupported generated CAS. Multiple distinct numbers remain unresolved for review.
2. **Missing CAS:** **Automatically fill missing CAS**, on by default in Lab setup, queries PubChem while the draft is editable. It runs after a scan, when reopening an incomplete draft, and after changes to its chemical name or composition. Typing pauses for 450 ms before a request starts. There is no need to press a lookup button. Switching the option off preserves the manual **Find CAS in PubChem** action.
3. **Single clear match:** the app fills a checksum-valid CAS when the complete chemical name resolves to exactly one compound with exactly one CAS result. The source identifies an automatic PubChem match. It clears the missing-CAS explanation and resets the overall review checkbox; check the label or SDS before saving.
4. **Ambiguous or composition-qualified results:** the app leaves CAS blank for multiple compounds/CAS numbers, incomplete results, mixture or solution wording, or a nonblank concentration/composition field. Each candidate shows its CAS, name, molecular formula, IUPAC name and source link. Check the exact form, then select **Use this CAS**. The ordinary record review is still required. A concentration can describe purity or a solution, so those records are intentionally left for selection.

The lookup uses complete-name matching and CAS-specific identifiers. It does not extract arbitrary numbers from synonyms or generic registry cross-references. Missing results do not establish that no CAS number exists; capped results are marked as incomplete. [PubChem PUG REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest).

Only the chemical name goes to public PubChem. Photos, transcription, PI, room and credentials are excluded. No PubChem key is needed. Successful exact-name queries are cached in memory for 15 minutes, up to 32 names. Short timeouts and no automatic retries keep service failures separate from draft editing. See [data handling](PRIVACY.md).

Automatic filling and manual selection both save the CAS and PubChem compound link in **CAS source**, with wording that identifies how it was filled. Neither claims that the user has already checked the SDS. Provenance is retained on the phone and in the shared worksheet. Changing the chemical name or concentration clears a previously selected PubChem CAS/source and triggers a new lookup when enabled; manually entered CAS takes priority over outstanding lookups. Other field edits are preserved when a lookup completes. Late results cannot modify a different draft or a pending/synced record. A lookup failure leaves the form usable and reports the problem next to the lookup controls.

Check salts, hydrates and stereoisomers carefully. For mixtures, preserve constituent names/concentrations and review the supplier SDS with EHS. Do not assign a pure compound's CAS to an entire mixture merely because PubChem finds it. This app stores one primary CAS per record and does not resolve multi-constituent reporting automatically.
