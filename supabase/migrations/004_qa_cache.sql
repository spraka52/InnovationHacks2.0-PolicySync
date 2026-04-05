-- Q&A response cache
-- Stores LLM-synthesized answers keyed by a hash of the normalized question.
-- Cache hits cost 0 Groq tokens and respond in <50ms vs ~3s for a fresh call.
-- Rows older than 24h are treated as stale by the application layer.

CREATE TABLE IF NOT EXISTS qa_cache (
  question_hash  text        PRIMARY KEY,
  question       text        NOT NULL,
  response       jsonb       NOT NULL,  -- full QAResponse payload
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Index for fast TTL cleanup
CREATE INDEX IF NOT EXISTS qa_cache_created_at_idx ON qa_cache (created_at);

-- Enable RLS (service role key bypasses it — safe for server-side calls)
ALTER TABLE qa_cache ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service_role_qa_cache" ON qa_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);
