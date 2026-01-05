// app/api/projects/[id]/nodes/[nodeId]/route.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * PATCH: update node fields (x, y, width, height, data)
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

    const update = {};
    if (typeof body.x === "number") update.x = body.x;
    if (typeof body.y === "number") update.y = body.y;
    if (typeof body.width === "number") update.width = body.width;
    if (typeof body.height === "number") update.height = body.height;
    if (body.data !== undefined) update.data = body.data;

    if (Object.keys(update).length === 0) {
      return new Response(JSON.stringify({ error: "Nothing to update" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

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
