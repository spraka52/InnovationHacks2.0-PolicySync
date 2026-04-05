// ─── User & Auth ──────────────────────────────────────────────────────────────
export type UserRole = "admin" | "reviewer" | "viewer";

// ─── Draft/Extraction Status ───────────────────────────────────────────────────
export type DraftStatus = "pending_eval" | "eval_failed" | "pending_review" | "approved" | "rejected";

// ─── Payer / Document Format ──────────────────────────────────────────────────
export type PayerFormat =
  | "uhc_narrative"          // UHC: HCPCS table + per-drug narrative sections
  | "cigna_narrative"        // Cigna: pure narrative, no tables
  | "bcbs_nc_multi_drug"     // BCBS NC: preferred/non-preferred tables + narrative
  | "florida_blue_mcg"       // Florida Blue: MCG portal, Indication|Criteria table
  | "priority_health_mdl"    // Priority Health: 205-page consolidated table, no LLM
  | "emblemhealth_docx"      // EmblemHealth: DOCX format
  | "upmc_narrative";        // UPMC: narrative PA policy

export type PlanType = "commercial" | "medicare" | "medicaid" | "exchange";

// Keep old PlanType alias for backward compat during migration
export type LegacyPlanType = "employer" | "medicaid" | "marketplace" | "medicare" | "va_tricare";

// ─── Coverage / Access ────────────────────────────────────────────────────────
export type CoverageTier = "preferred" | "non_preferred" | "covered_alternative" | "not_covered";

/**
 * Access status drives rebate economics:
 * "preferred_exclusive" → highest rebate (sole preferred agent)
 * "preferred_1_of_2"    → strong rebate (competing with 1 other preferred)
 * "preferred_1_of_3"    → weaker rebate
 * "non_preferred"       → minimal rebate
 * "not_covered"         → zero rebate potential
 */
export type AccessStatus =
  | "preferred_exclusive"
  | "preferred_1_of_2"
  | "preferred_1_of_3"
  | "preferred_1_of_4_plus"
  | "non_preferred"
  | "covered_alternative"
  | "not_covered";

// ─── Citation ─────────────────────────────────────────────────────────────────
export interface Citation {
  page: number | null;
  section: string | null;
  url: string | null;
  text_snippet: string;
}

// ─── Change Tracking ──────────────────────────────────────────────────────────
export interface ChangeSummary {
  clinical_changes: string[];   // ⚠️ meaningful changes that affect coverage/criteria
  cosmetic_changes: string[];   // ℹ️ formatting, date, wording-only changes
  previous_version_id: string | null;
  detected_at: string;
}

// ─── Core Extraction Schema ───────────────────────────────────────────────────
export interface ExtractedRule {
  // Drug identity
  drug_name: string;                    // Normalized: "Bevacizumab"
  brand_names: string[];                // ["Avastin", "Mvasi", "Zirabev"]
  generic_name: string;                 // "bevacizumab"
  hcpcs_codes: string[];                // ["J9035"] — J-codes for cross-payer normalization
  drug_category: string;                // "VEGF Inhibitor / Anti-angiogenic" — drives rebate grouping

  // Payer & policy identity
  payer_name: string;                   // "UnitedHealthcare", "Cigna", "BCBS NC", "Florida Blue"
  policy_number: string | null;         // "2026D0017AN", "IP0319"
  policy_title: string | null;          // "Commercial Medical Benefit Drug Policy"
  effective_date: string;               // "2026-01-01"
  plan_type: PlanType;                  // "commercial" | "medicare" | "medicaid" | "exchange"

  // Access position (critical for rebate economics)
  coverage_tier: CoverageTier;          // preferred / non_preferred / covered_alternative / not_covered
  access_status: AccessStatus;          // preferred_1_of_2, non_preferred, etc.
  peers_in_category: string[];          // other drugs at same payer in same drug_category

  // Clinical criteria
  indications_covered: string[];        // List of approved indications
  indications_not_covered: string[];    // "Unproven" or excluded indications
  prior_auth_required: boolean;
  prior_auth_criteria: string[];
  step_therapy_required: boolean;
  step_therapy_requirements: string[];  // "Must fail Mvasi or Zirabev first"
  biosimilar_step_required: boolean;    // Brand requires biosimilar trial first
  preferred_alternatives: string[];     // Names of preferred biosimilars/alternatives

  // Restrictions
  site_of_care_restrictions: string | null;   // "Hospital outpatient, physician office"
  quantity_limits: string | null;             // "10mg/kg q2w OR 15mg/kg q3w"
  reauthorization_period: string | null;      // "12 months"

  // Change tracking (populated on subsequent versions)
  change_summary: ChangeSummary | null;

  // Source traceability
  citations: Citation[];
  source_id: string;
  artifact_version_id: string;
}

// ─── Database Row Types ───────────────────────────────────────────────────────
export interface Source {
  id: string;
  name: string;
  payer_name: string;                   // "UnitedHealthcare", "Cigna", etc.
  payer_format: PayerFormat;            // document structure type
  plan_type: PlanType;
  state?: string | null;                // kept for backward compat with existing components
  fetch_url: string;
  fetch_method: "pdf" | "html" | "csv" | "api" | "docx";
  active: boolean;
  last_fetched_at: string | null;
  last_changed_at: string | null;
  policy_count: number;
  created_at: string;
}

// ─── Legacy / Admin Config ─────────────────────────────────────────────────────
export interface AdminConfig {
  id: string;
  selected_states: string[];
  enabled_plan_types: LegacyPlanType[];
  updated_by: string;
  updated_at: string;
}

export interface ArtifactVersion {
  id: string;
  source_id: string;
  content_hash: string;
  storage_path: string;
  fetched_at: string;
  sources?: Source;
}

export interface EvalMetrics {
  schema_valid: boolean;
  citation_verification: Record<string, boolean>;
  ragas_faithfulness: number;
  ragas_relevancy: number;
  consistency_flags: string[];
  final_score: number;
}

export interface DraftExtraction {
  id: string;
  artifact_version_id: string;
  extracted_json: ExtractedRule;
  status: DraftStatus;
  eval_score: number | null;
  eval_flags: string[];
  ragas_metrics: EvalMetrics | null;
  citation_verification: Record<string, boolean> | null;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  artifact_versions?: ArtifactVersion;
}

export interface PublishedRule {
  id: string;
  draft_extraction_id: string;
  rule_json: ExtractedRule;
  embedding: number[] | null;
  published_by: string;
  published_at: string;
  change_summary: ChangeSummary | null;
  source_name?: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  user_id: string;
  user_email: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Q&A Feature ──────────────────────────────────────────────────────────────
export interface QARequest {
  question: string;
}

export interface QAResponse {
  answer: string;
  citations: Array<{
    payer_name: string;
    policy_number: string | null;
    drug_name: string;
    page: number | null;
    section: string | null;
    text_snippet: string;
  }>;
  rules_used: PublishedRule[];
  /** Confidence from top vector similarity (retrieval), not keyword presence */
  confidence: "high" | "medium" | "low";
  /** Raw top similarity score (0–1); null when keyword fallback was used */
  top_similarity: number | null;
}

// ─── Changelog Feature ────────────────────────────────────────────────────────
export interface ChangelogEntry {
  id: string;
  payer_name: string;
  drug_name: string;
  policy_number: string | null;
  detected_at: string;
  clinical_changes: string[];
  cosmetic_changes: string[];
  clinical_count: number;
  cosmetic_count: number;
  previous_rule_id: string | null;
  current_rule_id: string;
}

// ─── Admin / Payer Config ──────────────────────────────────────────────────────
export interface PayerConfig {
  id: string;
  payer_name: string;
  payer_format: PayerFormat;
  fetch_url: string;
  active: boolean;
  last_fetched_at: string | null;
  last_changed_at: string | null;
  policy_count: number;
}

// ─── Search ───────────────────────────────────────────────────────────────────
export interface SearchResult {
  id: string;
  rule_json: ExtractedRule;
  published_by: string;
  published_at: string;
  similarity: number;
  change_summary: ChangeSummary | null;
}

export interface PayerResult {
  payer_name: string;
  coverage_tier: CoverageTier;
  access_status: AccessStatus;
  prior_auth_required: boolean;
  biosimilar_step_required: boolean;
  step_therapy_requirements: string[];
  quantity_limits: string | null;
  site_of_care_restrictions: string | null;
  published_at: string;
  rule_id: string;
  rule_json: ExtractedRule;
}

export interface DrugComparison {
  drug_name: string;
  generic_name: string;
  hcpcs_codes: string[];
  drug_category: string;
  payer_results: PayerResult[];
}
