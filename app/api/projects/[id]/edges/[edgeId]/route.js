// DELETE handler (pseudo-code)
import { getSupabaseServer } from '@/lib/supabase-server';

export async function DELETE(req, { params }) {
  const { projectId, edgeId } = params;
  const supabase = getSupabaseServer(); // whatever helper you use for server supabase

  // optional: verify ownership / auth
  const { error } = await supabase
    .from('edges')
    .delete()
    .eq('id', edgeId)
    .eq('project_id', projectId);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
