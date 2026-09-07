# EHSA export mapping

Verified September 6, 2026 against the [official MIT EHSA Chemical Import Template](https://ehs.mit.edu/wp-content/uploads/MITEHS_Chemical_Import_Template.xlsm). The downloaded workbook was read without running macros. Source ranges are `Chemical Inventory!A1:AA2` for columns and `VendorCodes!AF2:AG45` for unit codes. An export snapshot can preserve these columns for review; acceptance by the live EHSA importer still needs verification with MIT EHS.

## Unit codes

These are exact code strings, including capitalization, spaces, punctuation and micro sign. The table maps an app unit and a reviewed physical state to the template's `chemical_unit`. It does not change the numeric `unit` amount. A blank or unknown physical state must be resolved before export.

| App unit | Solid | Liquid | Gas | Source rows in VendorCodes |
| --- | --- | --- | --- | --- |
| `mg` | `mg` | `mg (L)` | `mg (G)` | 25–27 |
| `g` | `G` | `G (L)` | `G (G)` | 11–13 |
| `kg` | `KG` | `KG (L)` | `KG (G)` | 15–17 |
| `µL` | `µL (S)` | `µL` | `µL (G)` | 42–44 |
| `mL` | `mL (S)` | `mL` | `mL (G)` | 28–30 |
| `L` | `Liters (S)` | `Liters` | `Liters (G)` | 22–24 |
| `oz` | `Ounces` | `Ounces (L)` | `Ounces (G)` | 32–34 |
| `lb` | `LB (S)` | `LB (L)` | `LB` | 19–21 |
| `fl oz` | `Fluid Ounces`* | `Fluid Ounces`* | `Fluid Ounces`* | 10 |
| `gal` | `Gal`* | `Gal`* | `Gal`* | 14 |
| `ft³` | `CU.FT.(S)` | `CU.FT.(L)` | `CU.FT.` | 5–7 |
| `m³` | Unsupported | Unsupported | Unsupported | No matching code |

*The workbook supplies a single generic `Fluid Ounces` code with description “Fluid Ounces” and a single generic `Gal` code with description “Gallons”; it does not specify state-specific codes or restrictions for these entries. Mapping the generic code preserves the source label alongside the separate reviewed `physical_state`; this is not a claim that each state combination is accepted by the live importer. If such acceptance is required before exporting, block the unverified combination for review with EHS.

`oz` is a weight unit and must never map to `Fluid Ounces`. The `µ` character in all microliter codes is U+00B5 MICRO SIGN, not Greek U+03BC. The template also contains an incomplete `µ (L)` code with no description at AF45; do not use it.

There is no direct cubic-meter code. This mapping intentionally marks `m³` unsupported. Do not relabel a cubic-meter value as liters or cubic feet without an explicit, separately tested conversion that also changes the numeric amount. There is no template evidence for an invented `M3`, `m³`, or `CU.M.` code.

The physical-state field itself uses `Solid`, `Liquid`, or `Gas`. Keep state and measurement dimension separate: the template supports weight measurements for liquids/gases and volume measurements for solids. A physically plausible state must not be guessed from the unit alone.

## Exact export columns

Preserve all 27 columns in this order. Row 1 is the human label and row 2 is the import key. Do not substitute intuitive names for the template keys: `receipt_quantity` is container count, `unit` is the numeric amount per container, and `chemical_unit` is the measurement code.

| Column | Row 1 label | Row 2 key | Red header in source |
| --- | --- | --- | --- |
| A | PI CODE | researcher | Yes |
| B | PI Last Name | last_name | Yes |
| C | PI First Name | first_name | Yes |
| D | Bldg Code | building | Yes |
| E | LAB | lab | Yes |
| F | Location Type | storage_device | |
| G | In-Lab Location | storage_location | |
| H | Chemical Name | chemical_description | Yes |
| I | Physical State | physical_state | Yes |
| J | # of Containers | receipt_quantity | Yes |
| K | Amount per Container | unit | Yes |
| L | Unit of Measure | chemical_unit | Yes |
| M | CAS # | cas_num | |
| N | Vendor | vendor | |
| O | Catalog # | catalog_number | |
| P | Receipt Date | receipt_date | |
| Q | Expiration Date | expiration_date | |
| R | Contact | contact | |
| S | Comments | comments | |
| T | Date Entered | date_entered | |
| U | BARCODE | ship_code | |
| V | Private/Share | private_share | |
| W | LAST_CHANGED | last_update | |
| X | CONCENTRATION | concentration | |
| Y | CHEMICAL # | chemical_number | |
| Z | LOT # | lot_number | |
| AA | SDS URL | msds_url | |

The source's red header identifies import-required fields. CAS is not red in the template, but the newer [MIT inventory guidance](https://ehs.mit.edu/wp-content/uploads/EHS_Chemical_Inventory_Guidance_Oct-2025.pdf) requires CAS when one exists. An absent CAS and a reviewed substance with no CAS are different cases.

## Field interpretation and export checks

- `researcher`: PI's Kerberos username. Obtain this explicitly rather than deriving it from a display name.
- `first_name`, `last_name`: PI's corresponding names, explicitly supplied. Do not split a full-name string heuristically.
- `building`: building code, e.g. `66` or `NE47`. `lab`: full building-room, with `66-347` used in the template's example.
- `receipt_quantity`: number of containers. `unit`: quantity in each container. Exporting the total quantity into `unit` would overcount when container count exceeds one.
- `vendor`: an EHSA vendor code from the official lookup, not a scanned supplier name. Leave unresolved codes blank and preserve a supplier name in comments if needed.
- `storage_device`: a recognized location type. `storage_location`: a lab-specific location approved by EHS. Do not claim an arbitrary user-entered storage description is already an EHSA location code.
- `receipt_date`, `expiration_date`, `date_entered`: template examples specify MM/DD/YYYY. Preserve a missing or unreadable date as missing.
- `ship_code`: an existing/new container barcode intended to remain stable in EHSA. A request id is not automatically an EHSA barcode.
- `private_share`: the documented values are `Private` and `Share`. Use an explicit choice or leave blank; do not infer permission to share inventory.
- `chemical_number`: do not substitute an internal app id for this EHSA field. Keep it blank unless the lab has a valid value.

Implementation checks should reject unsupported units, missing required values, invalid numeric amounts/counts, and unreviewed records. They should preserve optional unknowns rather than invent values. Only create an export after the full candidate set passes validation, so the user does not receive a silently incomplete inventory. Include any unresolved annual-reporting usage follow-up in the app's review workflow; this import snapshot does not submit Atlas Annual Chemical Reporting.
