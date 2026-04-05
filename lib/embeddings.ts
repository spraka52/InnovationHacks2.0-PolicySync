/**
 * Embeddings via local sentence-transformers (all-mpnet-base-v2, 768-dim)
 * served by the fetcher FastAPI service at /embed.
 * Falls back to HuggingFace Inference API (free, same model) if fetcher is offline.
 * HyDE generation uses Groq (Llama 3.3 70B) — no rate limits.
 */

const FETCHER_URL = process.env.FETCHER_SERVICE_URL || "http://localhost:8000";
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY ?? "";
const GROQ_KEYS = [
  process.env.GROQ_API_KEY ?? "",
  process.env.GROQ_API_KEY_2 ?? "",
].filter(Boolean);

// HuggingFace free inference API — same model as local fetcher (768-dim)
async function embedViaHuggingFace(text: string): Promise<number[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (HF_API_KEY) headers["Authorization"] = `Bearer ${HF_API_KEY}`;

  const res = await fetch(
    "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-mpnet-base-v2",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
    }
  );

  if (!res.ok) throw new Error(`HuggingFace embedding failed: ${res.status}`);

  const data = await res.json();
  // HF returns a nested array for single input — unwrap one level
  return (Array.isArray(data[0]) ? data[0] : data) as number[];
}

export async function embedText(text: string): Promise<number[]> {
  // Try local fetcher first (faster, no cold-start)
  try {
    const res = await fetch(`${FETCHER_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000), // 5s timeout so fallback kicks in quickly
    });

    if (res.ok) {
      const data = await res.json();
      return data.embedding as number[];
    }
  } catch {
    console.warn("[embeddings] Local fetcher unavailable — falling back to HuggingFace");
  }

  // Fallback: HuggingFace free Inference API (same model, $0, no rate limit for small usage)
  return embedViaHuggingFace(text);
}

/**
 * HyDE: generate a hypothetical policy excerpt, then embed it for better retrieval.
 */
export async function hydeEmbed(userQuery: string): Promise<number[]> {
  const hypothetical = await generateHypotheticalDoc(userQuery);
  return embedText(hypothetical);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generateHypotheticalDoc(query: string): Promise<string> {
  if (GROQ_KEYS.length === 0) return query;

  // Use 8b for HyDE to preserve 70b quota for answer synthesis
  const attempts = [
    ...GROQ_KEYS.map(k => ({ key: k, model: "llama-3.1-8b-instant" })),
    ...GROQ_KEYS.map(k => ({ key: k, model: "llama-3.3-70b-versatile" })),
  ];

  let retryCount = 0;
  for (const { key, model } of attempts) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "You are a medical benefits policy expert. Write realistic health plan drug coverage policy excerpts.",
            },
            {
              role: "user",
              content: `A user is searching for: "${query}"\n\nWrite a 3-5 sentence excerpt from a typical health plan drug coverage policy that would directly answer this query. Include specific clinical criteria, drug names, and coverage conditions. Output only the policy excerpt, no preamble.`,
            },
          ],
          max_tokens: 128,
          temperature: 0.3,
        }),
      });

      if (res.status === 429) {
        const backoffMs = Math.min(1000 * 2 ** retryCount, 8000) + Math.random() * 500;
        console.warn(`[hyde] ${model} key=...${key.slice(-6)} rate limited — backing off ${backoffMs.toFixed(0)}ms`);
        await sleep(backoffMs);
        retryCount++;
        continue;
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? query;
    } catch {
      continue;
    }
  }
  return query;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map(embedText));
}
