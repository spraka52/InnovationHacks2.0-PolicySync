-- ============================================================
-- 003_payer_schema.sql
-- Payer-centric schema update for medical benefit drug policies
-- ============================================================

-- ─── 1. Extend sources table for payer identity ──────────────────────────────

alter table sources
  add column if not exists payer_name    text,
  add column if not exists payer_format  text check (payer_format in (
    'uhc_narrative',
    'cigna_narrative',
    'bcbs_nc_multi_drug',
    'florida_blue_mcg',
    'priority_health_mdl',
    'emblemhealth_docx',
    'upmc_narrative'
  )),
  add column if not exists last_fetched_at  timestamptz,
  add column if not exists last_changed_at  timestamptz,
  add column if not exists policy_count     int not null default 0;

-- Relax plan_type constraint to include 'commercial' and 'exchange'
alter table sources drop constraint if exists sources_plan_type_check;
alter table sources add constraint sources_plan_type_check
  check (plan_type in ('employer','medicaid','marketplace','medicare','va_tricare','commercial','exchange'));

-- ─── 2. Add change_summary to published_rules ────────────────────────────────

alter table published_rules
  add column if not exists change_summary jsonb;  -- ChangeSummary shape

-- ─── 3. Clear old GLP-1 seed data, insert real payer sources ─────────────────

truncate table admin_config restart identity cascade;
delete from sources;

insert into sources (name, payer_name, payer_format, plan_type, fetch_url, fetch_method, active) values

  -- UnitedHealthcare: commercial medical drug policies index
  ('UnitedHealthcare Medical Benefit Drug Policies',
   'UnitedHealthcare',
   'uhc_narrative',
   'commercial',
   'https://www.uhcprovider.com/en/policies-protocols/commercial-policies/commercial-medical-drug-policies.html',
   'html',
   true),

  -- Cigna: drug coverage policies A-Z index
  ('Cigna Drug Coverage Policies',
   'Cigna',
   'cigna_narrative',
   'commercial',
   'https://www.cigna.com/healthcare-professionals/coverage-and-claims/coverage-policies/drug-coverage-policies',
   'html',
   true),

  -- BCBS NC: medical policies index
  ('Blue Cross Blue Shield NC Medical Policies',
   'BCBS NC',
   'bcbs_nc_multi_drug',
   'commercial',
   'https://www.bluecrossnc.com/providers/policies-and-guidelines/medical-policies',
   'html',
   false),

  -- Florida Blue: MCG portal
  ('Florida Blue MCG Coverage Guidelines',
   'Florida Blue',
   'florida_blue_mcg',
   'commercial',
   'https://mcgs.bcbsfl.com/',
   'html',
   false),

  -- Priority Health: consolidated Medical Drug List
  ('Priority Health Medical Drug List 2026',
   'Priority Health',
   'priority_health_mdl',
   'commercial',
   'https://www.priorityhealth.com/provider/medical-policies',
   'pdf',
   false),

  -- EmblemHealth: GatewayPA prior auth portal
  ('EmblemHealth Prior Authorization Policies',
   'EmblemHealth',
   'emblemhealth_docx',
   'commercial',
   'https://www.gatewaypa.com/emblemhealth',
   'html',
   false),

  -- UPMC Health Plan: PA policies
  ('UPMC Health Plan Prior Authorization Policies',
   'UPMC Health Plan',
   'upmc_narrative',
   'commercial',
   'https://www.upmchealthplan.com/providers/medicalpolicies/priorauthorization.aspx',
   'html',
   false);

-- ─── 4. Update semantic search function to support payer_name filter ─────────

create or replace function search_published_rules(
  query_embedding   vector(768),
  match_threshold   float    default 0.5,
  match_count       int      default 20,
  filter_payer_name text     default null,
  filter_drug_name  text     default null,
  filter_state      text     default null,
  filter_plan_type  text     default null
)
returns table (
  id              uuid,
  rule_json       jsonb,
  published_by    text,
  published_at    timestamptz,
  change_summary  jsonb,
  similarity      float
)
language sql stable
as $$
  select
    pr.id,
    pr.rule_json,
    pr.published_by,
    pr.published_at,
    pr.change_summary,
    1 - (pr.embedding <=> query_embedding) as similarity
  from published_rules pr
  where
    pr.embedding is not null
    and 1 - (pr.embedding <=> query_embedding) > match_threshold
    and (filter_payer_name is null
         or lower(pr.rule_json->>'payer_name') = lower(filter_payer_name))
    and (filter_drug_name is null
         or lower(pr.rule_json->>'drug_name') ilike '%' || lower(filter_drug_name) || '%'
         or lower(pr.rule_json->>'generic_name') ilike '%' || lower(filter_drug_name) || '%'
         or pr.rule_json->'brand_names' ? filter_drug_name)
    and (filter_state is null
         or pr.rule_json->>'state' = filter_state)
    and (filter_plan_type is null
         or pr.rule_json->>'plan_type' = filter_plan_type)
  order by pr.embedding <=> query_embedding
  limit match_count;
$$;

-- ─── 5. Add helper function: get all rules for a drug (cross-payer compare) ──

create or replace function get_drug_comparison(drug_query text)
returns table (
  id              uuid,
  rule_json       jsonb,
  published_at    timestamptz,
  change_summary  jsonb
)
language sql stable
as $$
  select
    pr.id,
    pr.rule_json,
    pr.published_at,
    pr.change_summary
  from published_rules pr
  where
    lower(pr.rule_json->>'drug_name') ilike '%' || lower(drug_query) || '%'
    or lower(pr.rule_json->>'generic_name') ilike '%' || lower(drug_query) || '%'
    or exists (
      select 1
      from jsonb_array_elements_text(pr.rule_json->'brand_names') bn
      where lower(bn) ilike '%' || lower(drug_query) || '%'
    )
    or exists (
      select 1
      from jsonb_array_elements_text(pr.rule_json->'hcpcs_codes') hc
      where lower(hc) ilike '%' || lower(drug_query) || '%'
    )
  order by pr.rule_json->>'payer_name', pr.published_at desc;
$$;

-- ─── 6. Changelog view: recent clinical/cosmetic changes ─────────────────────

create or replace view recent_changes as
select
  pr.id                                          as rule_id,
  pr.rule_json->>'payer_name'                    as payer_name,
  pr.rule_json->>'drug_name'                     as drug_name,
  pr.rule_json->>'policy_number'                 as policy_number,
  pr.published_at                                as detected_at,
  pr.change_summary->'clinical_changes'          as clinical_changes,
  pr.change_summary->'cosmetic_changes'          as cosmetic_changes,
  jsonb_array_length(coalesce(pr.change_summary->'clinical_changes', '[]'::jsonb)) as clinical_count,
  jsonb_array_length(coalesce(pr.change_summary->'cosmetic_changes', '[]'::jsonb)) as cosmetic_count,
  pr.change_summary->>'previous_version_id'      as previous_rule_id
from published_rules pr
where
  pr.change_summary is not null
  and pr.published_at > now() - interval '90 days'
order by pr.published_at desc;
