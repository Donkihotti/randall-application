// app/api/getSignedUrl/route.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var on server");
}
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET || "images";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { paths } = body || {};
    if (!paths || !Array.isArray(paths)) {
      return new Response(JSON.stringify({ error: "paths must be an array" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const signedUrls = {};

    for (const rawPath of paths) {
      if (!rawPath) continue;

      // If it's already a full URL (http/https), return as-is (external URL)
      if (typeof rawPath === "string" && (rawPath.startsWith("http://") || rawPath.startsWith("https://"))) {
        signedUrls[rawPath] = rawPath;
        continue;
      }

      // If stored as a signed URL by mistake, return as-is
      if (typeof rawPath === "string" && rawPath.includes("/storage/v1/object/")) {
        signedUrls[rawPath] = rawPath;
        continue;
      }

      // Normalize key: remove leading slash(es)
      let key = String(rawPath).replace(/^\/+/, "");

      if (!key) {
        signedUrls[rawPath] = null;
        continue;
      }

      try {
        const expires = 60 * 60; // 1 hour
        const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(key, expires);
        if (error || !data) {
          console.warn("createSignedUrl failed for", rawPath, error);
          signedUrls[rawPath] = null;
        } else {
          // SDK may return { signedUrl } or { signedURL } depending on version
          signedUrls[rawPath] = data?.signedUrl ?? data?.signedURL ?? null;
        }
      } catch (err) {
        console.warn("createSignedUrl exception for", rawPath, err);
        signedUrls[rawPath] = null;
      }
    }

    return new Response(JSON.stringify({ signedUrls }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("getSignedUrl error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
