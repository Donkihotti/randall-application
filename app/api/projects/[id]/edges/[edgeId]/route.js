// app/api/projects/[id]/edges/[edgeId]/route.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function DELETE(req, ctx) {
  try {
    const params = await ctx.params;
    const projectId = params?.id;
    const edgeId = params?.edgeId;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project id" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!edgeId) {
      return new Response(JSON.stringify({ error: "Missing edge id in path" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const { data, error } = await supabaseAdmin
      .from("edges")
      .delete()
      .eq("id", edgeId)
      .eq("project_id", projectId)
      .select()
      .single();

    if (error) {
      console.error("delete edge by id supabase error", error);
      // If not found, return 404 (PostgREST returns error codes differently; we surface 404 for missing rows)
      return new Response(JSON.stringify({ error: error.message || String(error) }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    if (!data) {
      return new Response(JSON.stringify({ error: "Edge not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ edge: data }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("delete edge error (item)", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
