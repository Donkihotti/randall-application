// app/api/projects/[id]/nodes/route.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET || "images";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var on server");
}

// server/admin supabase client (service role) — must only run server-side
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * POST /api/projects/:id/nodes
 * Body:
 * {
 *   externalUrl?: string,
 *   x?: number, y?: number,
 *   width?: number, height?: number,
 *   data?: { prompt?: string, model?: string, ... }
 * }
 *
 * Response: { node: <inserted row>, signedUrl?: <url> }
 */
export async function POST(req, { params }) {
  try {
    // Next.js may provide params as an async object — unwrap it
    const { id: projectId } = await params;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project id" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const externalUrl = body?.externalUrl ?? null;
    const x = typeof body?.x === "number" ? body.x : (body?.position?.x ?? 120);
    const y = typeof body?.y === "number" ? body.y : (body?.position?.y ?? 120);
    const width = typeof body?.width === "number" ? body.width : 260;
    const height = typeof body?.height === "number" ? body.height : 180;
    const meta = body?.data ?? {};
    const createdData = { ...meta };

    let storagePath = null;
    let signedUrl = null;

    // If externalUrl provided, ingest + upload it to storage
    if (externalUrl) {
      try {
        const resp = await fetch(externalUrl);
        if (!resp.ok) {
          console.warn("Failed to fetch externalUrl:", externalUrl, resp.status);
        } else {
          const arrayBuffer = await resp.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // determine extension from URL or content-type
          let ext = "png";
          try {
            const urlObj = new URL(externalUrl);
            const pathname = urlObj.pathname || "";
            const match = pathname.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i);
            if (match) ext = match[1].toLowerCase();
            else {
              const ct = resp.headers.get("content-type") || "";
              if (ct.includes("jpeg")) ext = "jpg";
              else if (ct.includes("png")) ext = "png";
              else if (ct.includes("webp")) ext = "webp";
              else if (ct.includes("gif")) ext = "gif";
            }
          } catch (e) {
            // ignore URL parse errors, keep ext default
          }

          const randomName = crypto.randomUUID();
          // path: <projectId>/nodes/<uuid>.<ext>
          storagePath = `projects/${projectId}/nodes/${randomName}.${ext}`;

          // upload to storage
          const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(storagePath, buffer, {
              contentType: resp.headers.get("content-type") || `image/${ext}`,
              upsert: false,
            });

          if (uploadErr) {
            console.warn("Storage upload failed", uploadErr);
            storagePath = null;
          } else {
            // create signed url for immediate client display (1 hour)
            const { data: signedData, error: signedErr } = await supabaseAdmin.storage
              .from(BUCKET)
              .createSignedUrl(storagePath, 60 * 60);

            if (!signedErr && signedData) {
              // signedData shape depends on SDK; prefer signedUrl property
              signedUrl = signedData?.signedUrl ?? signedData?.signedURL ?? null;
            } else {
              console.warn("createSignedUrl failed", signedErr);
            }
          }
        }
      } catch (err) {
        console.warn("Error ingesting externalUrl", err);
      }
    }

    // attach storage path to node data JSON (so nodes.data.image stores bucket path)
    if (storagePath) {
      createdData.image = storagePath;
    }

    const insertPayload = {
      project_id: projectId,
      x,
      y,
      width,
      height,
      data: createdData,
      created_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("nodes")
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr) {
      console.error("Insert node failed", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message || insertErr }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ node: inserted, signedUrl }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("projects/:id/nodes error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
