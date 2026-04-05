-- Enable pgvector extension
create extension if not exists vector;

-- ============================================================
-- SOURCES: registered monitoring endpoints
-- ============================================================
create table if not exists sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan_type   text not null check (plan_type in ('employer','medicaid','marketplace','medicare','va_tricare')),
  state       text,                     -- null for national sources (medicare, va_tricare)
  fetch_url   text not null,
  fetch_method text not null check (fetch_method in ('pdf','html','csv','api')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- ARTIFACT_VERSIONS: one row per fetch that detected a change
-- ============================================================
create table if not exists artifact_versions (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references sources(id) on delete cascade,
  content_hash   text not null,          -- SHA-256 of raw content
  storage_path   text not null,          -- Supabase Storage path
  raw_text       text,                   -- extracted text (for smaller docs)
  fetched_at     timestamptz not null default now()
);
create index if not exists idx_artifact_versions_source on artifact_versions(source_id, fetched_at desc);

-- ============================================================
-- ARTIFACT_CHUNKS: Small-to-Big RAG chunks per version
-- ============================================================
create table if not exists artifact_chunks (
  id                   uuid primary key default gen_random_uuid(),
  artifact_version_id  uuid not null references artifact_versions(id) on delete cascade,
  section_title        text,
  page_number          int,
  leaf_text            text not null,        -- ~256 token chunk for retrieval
  parent_text          text not null,        -- full section passed to LLM
  contextual_summary   text,                 -- Cerebras-generated context prefix
  embedding            vector(768),          -- Google text-embedding-004 (768-dim)
  created_at           timestamptz not null default now()
);
create index if not exists idx_chunks_version on artifact_chunks(artifact_version_id);
create index if not exists idx_chunks_embedding on artifact_chunks using hnsw (embedding vector_cosine_ops);

-- ============================================================
-- DRAFT_EXTRACTIONS: AI-extracted rules pending review
-- ============================================================
create table if not exists draft_extractions (
  id                   uuid primary key default gen_random_uuid(),
  artifact_version_id  uuid not null references artifact_versions(id) on delete cascade,
  extracted_json       jsonb not null,        -- ExtractedRule shape
  status               text not null default 'pending_eval'
                         check (status in ('pending_eval','eval_failed','pending_review','approved','rejected')),
  eval_score           int check (eval_score between 0 and 100),
  eval_flags           text[] not null default '{}',
  ragas_metrics        jsonb,                 -- faithfulness, relevancy, recall, precision
  citation_verification jsonb,               -- per-citation pass/fail map
  rejection_reason     text,
  reviewed_by          text,                  -- Auth0 user_id
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists idx_drafts_status on draft_extractions(status, created_at desc);
create index if not exists idx_drafts_version on draft_extractions(artifact_version_id);

-- ============================================================
-- PUBLISHED_RULES: approved extractions visible to viewers
-- ============================================================
create table if not exists published_rules (
  id                    uuid primary key default gen_random_uuid(),
  draft_extraction_id   uuid not null references draft_extractions(id),
  rule_json             jsonb not null,
  embedding             vector(768),          -- for semantic search (HyDE)
  published_by          text not null,        -- Auth0 user_id
  published_at          timestamptz not null default now()
);
create index if not exists idx_published_at on published_rules(published_at desc);
create index if not exists idx_published_embedding on published_rules using hnsw (embedding vector_cosine_ops);

-- ============================================================
-- AUDIT_EVENTS: immutable append-only log
-- ============================================================
create table if not exists audit_events (
  id           uuid primary key default gen_random_uuid(),
  action       text not null,   -- e.g. 'fetch_triggered','draft_created','rule_published','rule_rejected'
  user_id      text,            -- Auth0 sub (null for system/cron actions)
  user_email   text,
  entity_type  text not null,   -- 'source','draft_extraction','published_rule'
  entity_id    uuid not null,
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_entity on audit_events(entity_type, entity_id, created_at desc);
create index if not exists idx_audit_created on audit_events(created_at desc);

-- ============================================================
-- ADMIN_CONFIG: single-row org configuration
-- ============================================================
create table if not exists admin_config (
  id                  uuid primary key default gen_random_uuid(),
  selected_states     text[] not null default '{}',
  enabled_plan_types  text[] not null default '{}',
  updated_by          text not null,
  updated_at          timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Note: auth enforcement is handled at the Next.js middleware
-- layer (Auth0 JWT). RLS here is a defense-in-depth layer using
-- the service role key for writes and anon key for reads.
-- ============================================================

alter table sources enable row level security;
alter table artifact_versions enable row level security;
alter table artifact_chunks enable row level security;
alter table draft_extractions enable row level security;
alter table published_rules enable row level security;
alter table audit_events enable row level security;
alter table admin_config enable row level security;

-- Service role bypasses RLS (used by Next.js API routes with SUPABASE_SERVICE_ROLE_KEY)
-- Anon key can only read published_rules (public viewer data)
create policy "anon read published" on published_rules for select using (true);

-- ============================================================
-- FUNCTIONS: semantic similarity search
-- ============================================================
create or replace function search_published_rules(
  query_embedding vector(768),
  match_threshold float default 0.5,
  match_count int default 20,
  filter_state text default null,
  filter_plan_type text default null
)
returns table (
  id uuid,
  rule_json jsonb,
  published_by text,
  published_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    pr.id,
    pr.rule_json,
    pr.published_by,
    pr.published_at,
    1 - (pr.embedding <=> query_embedding) as similarity
  from published_rules pr
  where
    pr.embedding is not null
    and 1 - (pr.embedding <=> query_embedding) > match_threshold
    and (filter_state is null or pr.rule_json->>'state' = filter_state)
    and (filter_plan_type is null or pr.rule_json->>'plan_type' = filter_plan_type)
  order by pr.embedding <=> query_embedding
  limit match_count;
$$;
