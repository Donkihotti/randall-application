// app/api/projects/[id]/edges/route.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function POST(req, ctx) {
  try {
    const params = await ctx.params;
    const projectId = params?.id;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project id" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const source = body?.sourceNode || body?.sourceId || body?.source;
    const target = body?.targetNode || body?.targetId || body?.target;

    if (!source || !target) {
      return new Response(JSON.stringify({ error: "sourceNode and targetNode required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const payload = {
      project_id: projectId,
      source_node: source,
      target_node: target,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin.from("edges").insert(payload).select().single();

    if (error) {
      console.error("create edge supabase error", error);
      return new Response(JSON.stringify({ error: error.message || error }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ edge: data }), { status: 201, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("create edge error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
