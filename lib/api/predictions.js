export async function fetchPredictionApi(id, { signal } = {}) {
    const res = await fetch(`/api/predictions/${encodeURIComponent(id)}`, { signal });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    throw new Error(`fetchPredictionApi non-JSON response: ${res.status} ${txt}`);
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || JSON.stringify(json));
    return json;
    }
    
    
    export async function createPredictionApi(payload) {
    const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    throw new Error(`createPredictionApi non-JSON response: ${txt}`);
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || JSON.stringify(json));
    return json;
    }