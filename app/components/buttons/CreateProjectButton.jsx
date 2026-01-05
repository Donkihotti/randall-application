// components/CreateProjectButton.jsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * CreateProjectButton
 * - prompts for a project name
 * - inserts project row with owner = current user's uid
 * - navigates to /create?projectId=<newId>
 */
export default function CreateProjectButton({ redirectTo = "/create" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  async function handleCreate() {
    setErrorMsg(null);
    // basic name prompt — replace with custom modal/form if you want
    const title = window.prompt("Project name", "Untitled project");
    if (title === null) return; // cancelled
    const trimmed = String(title || "").trim();
    if (!trimmed) {
      setErrorMsg("Project name is required");
      return;
    }

    setLoading(true);
    try {
      // get current session / user
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData?.session?.user ?? null;
      if (!user || !user.id) {
        // not signed in
        setErrorMsg("You must be signed in to create a project.");
        // optional: redirect to signin
        router.replace("/signin");
        return;
      }

      // insert project (RLS will enforce owner = auth.uid())
      const { data, error } = await supabase
        .from("projects")
        .insert([{ title: trimmed, owner: user.id }])
        .select()
        .single();

      if (error) throw error;
      const projectId = data?.id;
      if (!projectId) throw new Error("Missing project id in response");

      // redirect to create page with projectId
      router.push(`${redirectTo}?projectId=${projectId}`);
    } catch (err) {
      console.error("Create project failed:", err);
      setErrorMsg(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleCreate}
        className="rounded-xs bg-button-create max-h-[34px] px-2.5 py-2 text-black text-medium leading-4 font-medium hover:cursor-pointer disabled:cursor-not-allowed"
        disabled={loading}
      >
        {loading ? "Creating…" : "Create project"}
      </button>
      {errorMsg && <div className="text-red-400 mt-2">{errorMsg}</div>}
    </div>
  );
}
