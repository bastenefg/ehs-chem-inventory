# MIT inventory and Parley integration references

Verified September 6, 2026. These notes distinguish source requirements from implementation recommendations. The app prepares records for review; saving a worksheet does not submit an MIT report.

## Inventory requirements

The [MIT EHS Chemical Inventory Guidance](https://ehs.mit.edu/wp-content/uploads/EHS_Chemical_Inventory_Guidance_Oct-2025.pdf), sections B–C, requires PI/supervisor, building-room, full chemical name, amount with weight/volume unit, and CAS number when one exists. It recommends concentration, physical state, container count, and applicable expiration date.

Include purchased hazardous chemicals and gas cylinders; the guidance also covers specified high-hazard research samples, unusually large research sample quantities, and engineered nanomaterials. Maintain records continuously and update them before submission. The entire inventory must be submitted annually during reporting season, generally beginning in October, and on additional EHS/regulatory requests. This entire-inventory submission is separate from Annual Chemical Reporting.

Implementation recommendations: require human review of OCR; do not infer CAS, concentration, physical state, or quantity from a name alone. Preserve unknowns and distinguish a missing CAS from confirmation that no CAS exists. Let the lab set PI and location defaults, then verify location on each container record.

## EHSA import structure

The official [MIT EHSA import template](https://ehs.mit.edu/wp-content/uploads/MITEHS_Chemical_Import_Template.xlsm) was downloaded and read without executing macros. `Chemical Inventory!A1:AA2` contains these labels and import keys:

| Label | Key | Red required header |
| --- | --- | --- |
| PI CODE | researcher | Yes |
| PI Last Name | last_name | Yes |
| PI First Name | first_name | Yes |
| Bldg Code | building | Yes |
| LAB | lab | Yes |
| Location Type | storage_device | |
| In-Lab Location | storage_location | |
| Chemical Name | chemical_description | Yes |
| Physical State | physical_state | Yes |
| # of Containers | receipt_quantity | Yes |
| Amount per Container | unit | Yes |
| Unit of Measure | chemical_unit | Yes |
| CAS # | cas_num | |
| Vendor | vendor | |
| Catalog # | catalog_number | |
| Receipt Date | receipt_date | |
| Expiration Date | expiration_date | |
| Contact | contact | |
| Comments | comments | |
| Date Entered | date_entered | |
| BARCODE | ship_code | |
| Private/Share | private_share | |
| LAST_CHANGED | last_update | |
| CONCENTRATION | concentration | |
| CHEMICAL # | chemical_number | |
| LOT # | lot_number | |
| SDS URL | msds_url | |

Template instructions identify PI CODE as the PI's Kerberos username, Bldg Code as e.g. `66`, and LAB as e.g. `66-347`. Physical states are Solid/Liquid/Gas. Container count and amount per container are separate quantities. Vendor requires an EHSA vendor code. Date examples use MM/DD/YYYY. CAS is not red in the template, but current guidance requires it when one exists.

`VendorCodes!AF:AG` defines state-specific unit codes. Examples: `G` (solid grams), `G (L)` (liquid grams), `G (G)` (gas grams), `Liters` (liquid), `Liters (G)` (gas), `mL` (liquid), `LB` (gas pounds), `LB (S)` (solid pounds), and `CU.FT.` (gas cubic feet). Map reviewed state and unit deliberately when producing an EHSA import. A generic app worksheet should not be described as an exact EHSA import template.

The [MIT chemical inventory page](https://ehs.mit.edu/chemical-safety-program/chemical-inventory/) describes initial upload assistance. Self-service template uploads require account authorization from EHS. EHSA is the supported inventory system, but using it is not itself mandatory.

## Annual Chemical Reporting

The [MIT reporting page](https://ehs.mit.edu/chemical-safety-program/chemical-regulatory-reporting-security/) requires a report for each lab/work area with chemicals even when no listed substances are present. Submit through Atlas Annual Chemical Reporting. Its currently published dates describe the 2025 season; do not display them as a 2026 deadline.

The [regulatory worksheet](https://ehs.mit.edu/wp-content/uploads/dhs_sara_worksheet.xlsx), `Chemical_Reporting_Worksheet`, has Department, PI/Supervisor, Chemical Reporter, Rooms, and Submission Date fields. Columns are Chemical Name, CAS Number, Quan, Unit, Room #, and Changes. It contains 127 chemical rows plus a footnote. CAS alone is insufficient for final classification: entries distinguish physical forms, hydrogen peroxide above 35%, and some shared CAS numbers. One combined formaldehyde/paraformaldehyde/formalin row uses CAS 50-00-0. Do not use a simple CAS match to declare other forms nonreportable.

The [Chemical Reporter Instruction Sheet](https://ehs.mit.edu/wp-content/uploads/Chemical_Reporter_Instruction_Sheet.pdf), steps 6–9, instructs users to review substance, quantity, unit and room before submitting. Gas units may be cubic feet or pounds. Formaldehyde/paraformaldehyde/formalin and dichloromethane require people count and procedure information, including amount, concentration, frequency and ventilation/work location. Dichloromethane additionally asks whether use exceeds 30 days per year. These usage facts cannot be recovered from a label photograph.

Implementation recommendations: retain an explicit reviewed status; flag relevant usage follow-up; show official reporting links. Do not claim that OCR, a stored row, or a generic worksheet establishes compliance or completes Atlas submission. Confirm submission format with the lab's EHS coordinator.

## MIT Parley

[MIT Sloan's official API overview](https://mitsloanedtech.mit.edu/tools/parley-api/) documents: visit `https://parley.mit.edu/`, sign in with MIT credentials, select Parley API, and generate a key. It links the API reference at `https://parley-docs.mit.edu/` and limits data usage to low/medium risk. [MIT's July 8, 2026 announcement](https://orgchart.mit.edu/letters/parley-api-now-available-mit-community) confirms availability to the MIT community and supports separate collaborative accounts for labs, grants and classes.

Both the [API reference](https://parley-docs.mit.edu/) and [IS&T knowledge-base article](https://mit.service-now.com/esc?id=kb_article&sysparm_article=KB0034692) require MIT sign-in. The reference was checked in a browser and reached Touchstone login. The user supplied `https://parley.api.mit.edu/v1` as the endpoint. An unauthenticated read-only GET to `https://parley.api.mit.edu/v1/models` returned HTTP 401 and explicitly accepted an API key through `x-api-key` or Bearer `sk-parley-*`, or a JWT Bearer token. This verifies connectivity and the documented-by-server authentication choice; it does not verify an authenticated model-list response.

An authenticated model list and image request example were not available during this research. OpenAI-compatible `/chat/completions`, the successful `/models` response shape and base64 `image_url` remain integration assumptions until checked against the authenticated docs or an authorized connection test. Use the user-provided base URL, and do not invent a default model name.

Implementation recommendations: each user/lab obtains its own key through Parley, never a key embedded in a shared APK or repository. Let users enter the official endpoint and an image-capable model. Protect the device key with Android Keystore, exclude it from backup, omit it from logs and worksheets, and support clearing/replacing it. Model availability and API credits can change, so link to the live portal. Support: parley-support@mit.edu.
