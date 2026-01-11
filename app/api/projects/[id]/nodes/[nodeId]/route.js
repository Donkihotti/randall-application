// app/api/projects/[id]/nodes/[nodeId]/route.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Helpers
 */
const looksLikeAbsoluteUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
const looksLikeSignedUrl = (s) => typeof s === "string" && s.includes("/storage/v1/object/sign/");
const canonicalStorageRegex = /^(?:\/)?projects\/[0-9a-fA-F-]{36}\/images\/.+$/i;
const normalizeStoragePath = (p) => (typeof p === "string" ? (p.startsWith("/") ? p.slice(1) : p) : p);

/**
 * PATCH: update node fields (x, y, width, height, data) with defensive guard on data.image
 */
export async function PATCH(req, ctx) {
  try {
    const params = await ctx.params;
    const projectId = params?.id;
    const nodeId = params?.nodeId;
    if (!projectId || !nodeId) {
      return new Response(JSON.stringify({ error: "Missing params" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));

    // Build base update (positional/size fields)
    const update = {};
    if (typeof body.x === "number") update.x = Math.round(body.x);
    if (typeof body.y === "number") update.y = Math.round(body.y);
    if (typeof body.width === "number") update.width = Math.round(body.width);
    if (typeof body.height === "number") update.height = Math.round(body.height);

    // If no data payload provided, simply update positional/size fields (if any)
    // but still require at least one field to update.
    const incomingData = body.data;

    // If client attempted to modify data, we must fetch the existing node first
    let mergedDataToPersist = null;
    if (incomingData !== undefined) {
      // fetch existing node (we only need existing data)
      const { data: existingNode, error: fetchErr } = await supabaseAdmin
        .from("nodes")
        .select("data")
        .eq("id", nodeId)
        .eq("project_id", projectId)
        .single();

      if (fetchErr) {
        console.error("PATCH node fetch existing error", fetchErr);
        // If node not found, respond 404-ish
        return new Response(JSON.stringify({ error: "Node not found or fetch error" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }

      const existingData = existingNode?.data ?? {};
      // Start with existing data to avoid accidental nullification of keys the client didn't intend to change
      mergedDataToPersist = { ...existingData };

      // Merge non-image keys from incomingData
      for (const k of Object.keys(incomingData || {})) {
        if (k === "image") continue; // handle image field below defensively
        mergedDataToPersist[k] = incomingData[k];
      }

      // Handle the image field defensively:
      const incomingImage = incomingData && Object.prototype.hasOwnProperty.call(incomingData, "image") ? incomingData.image : undefined;
      const existingImage = existingData && Object.prototype.hasOwnProperty.call(existingData, "image") ? existingData.image : undefined;

      if (incomingImage === undefined) {
        // Client didn't attempt to change image -> keep existingImage (already in mergedDataToPersist)
      } else if (incomingImage === null) {
        // Client asked to clear image.
        // If there's an existing canonical image, ignore the clear to avoid accidental deletion.
        if (!existingImage) {
          // no existing image -> allow null (explicitly set)
          mergedDataToPersist.image = null;
        } else {
          // ignore attempt to overwrite/clear canonical image
          mergedDataToPersist.image = existingImage;
          console.warn(`Ignored request to clear existing node image for node ${nodeId}`);
        }
      } else if (typeof incomingImage === "string") {
        // Client provided a string. Only accept it if:
        //  - there is no existing image AND the provided value is a canonical storage path
        //  - if existing image already set -> ignore incoming (do not overwrite)
        if (existingImage) {
          // existing canonical image present -> do not overwrite
          mergedDataToPersist.image = existingImage;
        } else {
          // no existing image
          if (canonicalStorageRegex.test(incomingImage)) {
            // canonical path — normalize and accept
            mergedDataToPersist.image = normalizeStoragePath(incomingImage);
          } else {
            // incoming is an absolute URL / signed url / unknown -> ignore (do not persist ephemeral URL)
            if (looksLikeSignedUrl(incomingImage) || looksLikeAbsoluteUrl(incomingImage)) {
              console.warn(`Ignoring ephemeral image value on node ${nodeId} (will not persist signed/external URL).`);
            } else {
              // Unknown format — be conservative and ignore
              console.warn(`Ignoring non-canonical image value for node ${nodeId}.`);
            }
            // keep existing (which may be undefined/null)
            if (existingImage) mergedDataToPersist.image = existingImage;
            else if (mergedDataToPersist.hasOwnProperty("image")) {
              // leave whatever existingData had (likely undefined)
            } else {
              // no image to persist
              delete mergedDataToPersist.image;
            }
          }
        }
      } else {
        // unexpected type — ignore image change
        if (existingImage) mergedDataToPersist.image = existingImage;
      }

      // assign sanitized data to update
      update.data = mergedDataToPersist;
    }

    if (Object.keys(update).length === 0) {
      return new Response(JSON.stringify({ error: "Nothing to update" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Perform the update guarded by project/node
    const { data, error } = await supabaseAdmin
      .from("nodes")
      .update(update)
      .eq("id", nodeId)
      .eq("project_id", projectId)
      .select()
      .single();

    if (error) {
      console.error("PATCH node supabase error", error);
      return new Response(JSON.stringify({ error: error.message || error }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ node: data }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("PATCH node error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

/**
 * DELETE: delete node row (and optionally cascade edges server-side if you want)
 */
export async function DELETE(req, ctx) {
  try {
    const params = await ctx.params;
    const projectId = params?.id;
    const nodeId = params?.nodeId;
    if (!projectId || !nodeId) {
      return new Response(JSON.stringify({ error: "Missing params" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // delete edges referencing the node first (optional; useful to keep referential integrity)
    await supabaseAdmin.from("edges").delete().eq("project_id", projectId).or(`source_node.eq.${nodeId},target_node.eq.${nodeId}`);

    const { data, error } = await supabaseAdmin
      .from("nodes")
      .delete()
      .eq("id", nodeId)
      .eq("project_id", projectId)
      .select()
      .single();

    if (error) {
      console.error("DELETE node supabase error", error);
      return new Response(JSON.stringify({ error: error.message || error }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ node: data }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("DELETE node error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
