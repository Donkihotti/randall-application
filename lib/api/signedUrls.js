export async function getSignedUrls(paths = []) {
    if (!paths || !paths.length) return {};
    const res = await fetch("/api/getSignedUrl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
    });
    if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`getSignedUrls failed: ${res.status} ${t}`);
    }
    const json = await res.json();
    return json.signedUrls ?? {};
    }