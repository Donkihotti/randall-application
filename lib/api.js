// lib/api.js
import { supabase } from "./supabaseClient";

// Projects
export async function createProject({ title, description = "" }) {
  const session = await supabase.auth.getSession();
  const user = session?.data?.session?.user;
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("projects")
    .insert([{ title, description, owner: user.id }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Nodes
export async function fetchNodesForProject(projectId) {
  const { data, error } = await supabase
    .from("nodes")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw error;
  return data;
}

// Images: return sign URL for storage path
export async function signedUrlForPath(storagePath, expires = 60 * 60) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from("images").createSignedUrl(storagePath, expires);
  if (error) {
    console.warn("signedUrlForPath failed", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
