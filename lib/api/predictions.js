// lib/api/predictions.js
// Small API wrapper used by page.js and tests.
// - createPredictionApi({ prompt, references = [], options = {} }) -> parsed JSON (throws on non-ok)
// - fetchPredictionApi(id, { signal }) -> parsed JSON (throws on non-ok)

export async function createPredictionApi({ prompt, references = [], options = {} } = {}) {
    if (typeof prompt !== "string") prompt = String(prompt ?? "");
    const payload = { prompt, references: Array.isArray(references) ? references : [], options: options || {} };
  
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  
    const contentType = res.headers.get?.("content-type") || "";
    // Try to parse JSON when possible
    if (!contentType.includes("application/json")) {
      const text = await res.text().catch(() => "");
      throw new Error(`CreatePrediction: non-JSON response ${res.status} — ${text.slice(0, 300)}`);
    }
  
    const data = await res.json();
  
    if (!res.ok) {
      const upstreamMsg = data?.error?.message || data?.error || JSON.stringify(data);
      throw new Error(`CreatePrediction failed: ${upstreamMsg}`);
    }
  
    return data;
  }
  
  export async function fetchPredictionApi(id, { signal } = {}) {
    if (!id || typeof id !== "string") throw new Error("fetchPredictionApi requires a valid id string");
    const url = `/api/predictions/${encodeURIComponent(id)}`;
    const res = await fetch(url, signal ? { signal } : {});
  
    const contentType = res.headers.get?.("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text().catch(() => "");
      throw new Error(`fetchPredictionApi: non-JSON response (status ${res.status}): ${text.slice(0, 400)}`);
    }
  
    const data = await res.json();
  
    if (!res.ok) {
      const upstreamMsg = data?.error || data?.upstream || data?.raw || JSON.stringify(data);
      throw new Error(`fetchPredictionApi polling failed: ${upstreamMsg}`);
    }
  
    if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
      throw new Error("fetchPredictionApi returned empty object — check server logs/upstream");
    }
  
    return data;
  }
  