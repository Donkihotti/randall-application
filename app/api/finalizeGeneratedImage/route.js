// app/api/finalizeGeneratedImage/route.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "images";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function extFromContentType(ct) {
  if (!ct) return "png";
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("bmp")) return "bmp";
  return "png";
}

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  if (!a) return b || 1;
  if (!b) return a || 1;
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function computeAspect(width, height) {
  const w = Math.max(1, Math.round(width || 1));
  const h = Math.max(1, Math.round(height || 1));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function isUuid(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      externalUrl,
      projectId,
      prompt = "",
      model = "",
      sourceNodeId = null,
      position = null, // optional { x, y }
      width = 260,
      height = 180,
    } = body;

    if (!externalUrl || !projectId) {
      return new Response(JSON.stringify({ error: "externalUrl and projectId required" }), { status: 400 });
    }

    // Expect Authorization: Bearer <access_token>
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), { status: 401 });
    }

    // Verify token and get user id (service role client can verify any JWT)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.error("auth.getUser failed", userErr);
      return new Response(JSON.stringify({ error: "Invalid user token" }), { status: 401 });
    }
    const userId = userData.user.id;

    // Download the external image
    const fetchRes = await fetch(externalUrl, { method: "GET" });
    if (!fetchRes.ok) {
      const text = await fetchRes.text().catch(() => "<no body>");
      console.error("Failed to fetch external image:", fetchRes.status, text);
      return new Response(JSON.stringify({ error: "Failed to download external image" }), { status: 502 });
    }

    const contentType = fetchRes.headers.get("content-type") || "image/png";
    const ext = extFromContentType(contentType);

    const ab = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(ab);

    // canonical path in bucket (no leading slash)
    const fileName = `${crypto.randomUUID()}.${ext}`;
    const pathInBucket = `projects/${projectId}/images/${fileName}`;

    // Upload bytes into bucket using service role
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(pathInBucket, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error", uploadError);
      return new Response(JSON.stringify({ error: "Failed to upload to storage", details: uploadError.message }), { status: 500 });
    }

    // Insert into images table (store the storage path - pathInBucket)
    const { data: imageRow, error: imageInsertErr } = await supabaseAdmin
      .from("images")
      .insert([
        {
          project_id: projectId,
          user_id: userId,
          storage_path: pathInBucket,
          metadata: { prompt, model },
        },
      ])
      .select()
      .single();

    if (imageInsertErr) {
      console.error("images insert failed", imageInsertErr);
      // try cleanup
      try {
        await supabaseAdmin.storage.from(BUCKET).remove([pathInBucket]);
      } catch (e) {}
      return new Response(JSON.stringify({ error: "Failed to create image record", details: imageInsertErr.message }), { status: 500 });
    }

    // compute aspect to store (reduced ratio like "1:1")
    const aspect = computeAspect(width, height);

    // Build nodeData (image is canonical storage path WITHOUT leading slash)
    const nodeData = {
      image: pathInBucket,
      prompt,
      model,
      status: "done",
      aspect,
    };

    const posX = position?.x ?? 120;
    const posY = position?.y ?? 120;

    // If a sourceNodeId is provided and looks like a server UUID, update that node IN PLACE
    // instead of creating a duplicate node. This avoids duplicate nodes for placeholders.
    let nodeRow = null;
    let createdNewNode = false;
    if (sourceNodeId && isUuid(sourceNodeId)) {
      try {
        // fetch existing node so we can merge data safely
        const { data: existingNode, error: fetchErr } = await supabaseAdmin
          .from("nodes")
          .select("id, data, x, y, width, height, project_id")
          .eq("id", sourceNodeId)
          .eq("project_id", projectId)
          .single();

        if (!fetchErr && existingNode) {
          const mergedData = { ...(existingNode.data || {}), ...nodeData };
          // prefer existing node position/size unless caller explicitly provided width/height
          const newWidth = width || existingNode.width || 260;
          const newHeight = height || existingNode.height || 180;
          const newX = typeof position?.x === "number" ? position.x : (existingNode.x ?? posX);
          const newY = typeof position?.y === "number" ? position.y : (existingNode.y ?? posY);

          const { data: updatedNode, error: updateErr } = await supabaseAdmin
            .from("nodes")
            .update({
              data: mergedData,
              width: newWidth,
              height: newHeight,
              x: newX,
              y: newY,
            })
            .eq("id", sourceNodeId)
            .eq("project_id", projectId)
            .select()
            .single();

          if (updateErr) {
            console.warn("Failed to update existing source node, will fallback to create new node:", updateErr);
          } else {
            nodeRow = updatedNode;
          }
        } else {
          // couldn't find existing node for the given id -> fallback to creating a new node
          console.warn("sourceNodeId provided but node not found in DB, creating new node instead");
        }
      } catch (e) {
        console.warn("Error while trying to update source node (fallback to create):", e);
      }
    }

    // If we didn't update an existing node, create a new one.
    if (!nodeRow) {
      createdNewNode = true;
      const { data: newNode, error: nodeInsertErr } = await supabaseAdmin
        .from("nodes")
        .insert([
          {
            project_id: projectId,
            user_id: userId,
            x: posX,
            y: posY,
            width,
            height,
            data: nodeData,
          },
        ])
        .select()
        .single();

      if (nodeInsertErr) {
        console.error("nodes insert failed", nodeInsertErr);
        // cleanup image + db image row
        try {
          await supabaseAdmin.from("images").delete().match({ id: imageRow.id });
        } catch (_) {}
        try {
          await supabaseAdmin.storage.from(BUCKET).remove([pathInBucket]);
        } catch (_) {}
        return new Response(JSON.stringify({ error: "Failed to create node record", details: nodeInsertErr.message }), { status: 500 });
      }
      nodeRow = newNode;
    }

    // Optionally create an edge from sourceNodeId -> new node, only if sourceNodeId is a real UUID
    let edgeRow = null;
    if (sourceNodeId && isUuid(sourceNodeId)) {
      // If we updated the same node (sourceNodeId === nodeRow.id), don't create a self-edge.
      if (sourceNodeId !== nodeRow.id) {
        try {
          const { data: eRow, error: eErr } = await supabaseAdmin
            .from("edges")
            .insert([
              {
                project_id: projectId,
                source_node: sourceNodeId,
                target_node: nodeRow.id,
              },
            ])
            .select()
            .single();
          if (!eErr) edgeRow = eRow;
          else console.warn("edges insert failed", eErr);
        } catch (e) {
          console.warn("edge insert error", e);
        }
      }
    }

    // Create a signed URL for immediate client display
    const { data: signed, error: signedErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(pathInBucket, 60 * 60);
    const signedUrl = (signedErr || !signed) ? null : signed.signedUrl;

    return new Response(
      JSON.stringify({
        ok: true,
        node: nodeRow,
        image: imageRow,
        edge: edgeRow,
        signedUrl,
        storagePath: pathInBucket,
        createdNewNode,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("finalizeGeneratedImage error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
