from __future__ import annotations
"""
Priority Health Medical Drug List (MDL) extractor.

Document format: priority_health_mdl
- 205-page consolidated table: HCPCS Code | Drug Name | Description | Coverage Level | Notes
- Coverage levels: PA (Prior Auth), SOS (Site of Service), CC (Coverage Change),
  CA (Covered Alternative = has a preferred alternative), Not Covered
- NO LLM NEEDED — pure deterministic table parsing
- This is a formulary list, not a narrative policy

Coverage level mapping:
  PA  → coverage_tier="non_preferred" (or preferred if no step), prior_auth_required=True
  SOS → coverage_tier="preferred", site_of_care_restrictions filled
  CC  → coverage_tier varies (Coverage Change — check notes)
  CA  → coverage_tier="covered_alternative", has preferred_alternatives in notes
  Not Covered → coverage_tier="not_covered"

Strategy:
- Parse ALL table rows from the PDF
- Map each row to an ExtractedRule
- Notes column often has: "CA: [preferred drug name]" → preferred_alternatives
- Group by drug name (same drug may appear multiple times with different HCPCS)
"""

import re
from typing import Any


def _parse_coverage_level(level: str, notes: str) -> dict[str, Any]:
    """Map Priority Health coverage level abbreviation to ExtractedRule fields."""
    level = (level or "").strip().upper()
    notes = (notes or "").strip()

    result: dict[str, Any] = {
        "prior_auth_required": False,
        "step_therapy_required": False,
        "biosimilar_step_required": False,
        "coverage_tier": "non_preferred",
        "access_status": "non_preferred",
        "site_of_care_restrictions": None,
        "preferred_alternatives": [],
    }

    if level == "PA":
        result["prior_auth_required"] = True
        result["coverage_tier"] = "non_preferred"
        result["access_status"] = "non_preferred"
    elif level == "SOS":
        result["coverage_tier"] = "preferred"
        result["access_status"] = "preferred_exclusive"
        result["site_of_care_restrictions"] = notes if notes else "Site of service restriction applies"
    elif level == "CC":
        # Coverage Change — treat as covered, details in notes
        result["coverage_tier"] = "non_preferred"
        result["access_status"] = "non_preferred"
    elif level == "CA":
        # Covered Alternative — extract the preferred alternative from notes
        result["coverage_tier"] = "covered_alternative"
        result["access_status"] = "covered_alternative"
        # Notes often: "CA: Eylea, Eylea HD, Pavblu" or "CA: Mvasi"
        ca_match = re.search(r"CA:\s*(.+)", notes, re.IGNORECASE)
        if ca_match:
            alts = [a.strip() for a in ca_match.group(1).split(",") if a.strip()]
            result["preferred_alternatives"] = alts
        result["step_therapy_required"] = len(result["preferred_alternatives"]) > 0
    elif "not covered" in level.lower() or level == "NC":
        result["coverage_tier"] = "not_covered"
        result["access_status"] = "not_covered"
    else:
        # Default: assume PA required
        result["prior_auth_required"] = True

    return result


def _normalize_drug_name(raw_name: str) -> tuple[str, str, list[str]]:
    """Return (generic_name, drug_name, brand_names) from raw drug name string."""
    raw = raw_name.strip()
    # Pattern: "brandname (genericname)" or "genericname"
    paren_match = re.match(r"^(.+?)\s*\((.+?)\)\s*$", raw)
    if paren_match:
        brand = paren_match.group(1).strip()
        generic = paren_match.group(2).strip().lower()
        return generic, brand, [brand]
    else:
        # No parens — treat entire string as drug name
        lower = raw.lower()
        return lower, raw, [raw]


async def extract(
    chunks: list[dict],
    source_id: str,
    artifact_version_id: str,
    payer_name: str = "Priority Health",
    raw_text: str = "",
    table_rows: list[list[str]] | None = None,
) -> list[dict]:
    """
    Priority Health uses purely deterministic table parsing — no LLM.

    table_rows: pre-parsed from pdfplumber's extract_tables(), expected format:
      [hcpcs_code, drug_name, description, coverage_level, notes]
    If table_rows not provided, falls back to regex parsing of raw_text.
    """

    rules: list[dict] = []

    if table_rows:
        rows = table_rows
    else:
        # Fallback: extract rows from raw text via regex
        rows = _parse_raw_text_to_rows(raw_text or _chunks_to_text(chunks))

    effective_date = _extract_effective_date(raw_text or "")

    for row in rows:
        if len(row) < 4:
            continue

        hcpcs = (row[0] or "").strip()
        drug_raw = (row[1] or "").strip()
        description = (row[2] or "").strip() if len(row) > 2 else ""
        coverage_level = (row[3] or "").strip() if len(row) > 3 else ""
        notes = (row[4] or "").strip() if len(row) > 4 else ""

        # Skip header rows and empty rows
        if not hcpcs or not drug_raw or hcpcs.upper() in ("HCPCS", "CODE", "J-CODE"):
            continue
        if not re.match(r"^[A-Z]\d{4}", hcpcs):
            continue

        generic_name, drug_name, brand_names = _normalize_drug_name(drug_raw)
        coverage_fields = _parse_coverage_level(coverage_level, notes)

        # Build indications from description column
        indications = []
        if description:
            indications = [description]

        # Build PA criteria from coverage level
        pa_criteria = []
        if coverage_fields["prior_auth_required"]:
            pa_criteria.append(f"Prior authorization required. Coverage level: {coverage_level}")
        if notes and notes not in ("", coverage_level):
            pa_criteria.append(f"Note: {notes}")

        rule: dict = {
            "drug_name": drug_name,
            "brand_names": brand_names,
            "generic_name": generic_name,
            "hcpcs_codes": [hcpcs] if hcpcs else [],
            "drug_category": _infer_drug_category(hcpcs, drug_name),
            "payer_name": payer_name,
            "policy_number": "MDL-2026",
            "policy_title": "Priority Health Medical Drug List 2026",
            "effective_date": effective_date,
            "plan_type": "commercial",
            "peers_in_category": [],
            "indications_covered": indications,
            "indications_not_covered": [],
            "prior_auth_criteria": pa_criteria,
            "step_therapy_requirements": [],
            "quantity_limits": None,
            "reauthorization_period": None,
            "change_summary": None,
            "citations": [{"page": None, "section": "Medical Drug List Table", "url": None,
                           "text_snippet": f"{hcpcs} | {drug_raw} | {coverage_level} | {notes}"}],
            "source_id": source_id,
            "artifact_version_id": artifact_version_id,
            **coverage_fields,
        }
        rules.append(rule)

    return rules


def _chunks_to_text(chunks: list[dict]) -> str:
    return "\n".join(
        c.get("parent_text", c.get("leaf_text", "")) for c in chunks
    )


def _parse_raw_text_to_rows(text: str) -> list[list[str]]:
    """Regex-based fallback row extraction when pdfplumber tables not available."""
    rows = []
    # Match lines starting with J-code or Q-code pattern
    pattern = re.compile(
        r"^([A-Z]\d{4})\s+(.+?)\s{2,}(.+?)\s{2,}(PA|SOS|CC|CA|Not Covered)\s*(.*)?$",
        re.MULTILINE
    )
    for m in pattern.finditer(text):
        rows.append([m.group(1), m.group(2), m.group(3), m.group(4), m.group(5) or ""])
    return rows


def _extract_effective_date(text: str) -> str:
    """Extract effective date from document header."""
    m = re.search(r"effective\s+(?:date[:\s]+)?(\d{1,2}/\d{1,2}/\d{4})", text, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if m:
        return m.group(1)
    return "2026-01-01"


# J-code to drug category mapping (common oncology J-codes)
_JCODE_CATEGORIES: dict[str, str] = {
    "J9035": "VEGF Inhibitor / Anti-angiogenic",       # bevacizumab
    "J9145": "Anti-CD20 mAb",                          # daratumumab
    "J9312": "Anti-CD20 mAb",                          # rituximab
    "J9355": "HER2-targeted mAb",                      # trastuzumab
    "J0585": "Botulinum Toxin Type A",                 # onabotulinumtoxinA (Botox)
    "J0586": "Botulinum Toxin Type A",                 # abobotulinumtoxinA (Dysport)
    "J0587": "Botulinum Toxin Type B",                 # rimabotulinumtoxinB (Myobloc)
    "J0588": "Botulinum Toxin Type A",                 # incobotulinumtoxinA (Xeomin)
    "J0589": "Botulinum Toxin Type A",                 # daxibotulinumtoxinA (Daxxify)
    "J0897": "RANK Ligand Inhibitor",                  # denosumab (Prolia/Xgeva)
}


def _infer_drug_category(hcpcs: str, drug_name: str) -> str:
    """Look up drug category by J-code, or infer from drug name."""
    if hcpcs in _JCODE_CATEGORIES:
        return _JCODE_CATEGORIES[hcpcs]
    name_lower = drug_name.lower()
    if "bevacizumab" in name_lower or "avastin" in name_lower:
        return "VEGF Inhibitor / Anti-angiogenic"
    if "rituximab" in name_lower:
        return "Anti-CD20 mAb"
    if "trastuzumab" in name_lower or "herceptin" in name_lower:
        return "HER2-targeted mAb"
    if "botulinum" in name_lower or "botox" in name_lower or "dysport" in name_lower:
        return "Botulinum Toxin"
    if "denosumab" in name_lower or "prolia" in name_lower or "xgeva" in name_lower:
        return "RANK Ligand Inhibitor"
    return "Specialty / Biologic"
