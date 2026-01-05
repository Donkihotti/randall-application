'use client';

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import CreateProjectButton from "../components/buttons/CreateProjectButton";
import ProjectsPanel from "./components/ProjectsPanel";

export default function Dashboard () {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data, error } = await supabase.from("projects").select("*").order("updated_at", { ascending: false });
      if (error) {
        console.error("list projects", error);
      } else if (mounted) {
        setProjects(data || []);
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, []);

  return (
    <div style={{ padding: 16 }}>
    <h1>Projects</h1>
    <div className="w-full mt-8">
      <CreateProjectButton />
      {loading && <div>Loading...</div>}
      <div style={{ display: "grid", gap: 8,}} className="mt-4">
        {projects.map(p => (
          <a key={p.id} href={`/create?projectId=${p.id}`} className="border rounded-xs px-2 py-1 border-border-main hover:bg-canvas transition-all duration-100">
            <div className="text-medium">{p.title}</div>
            <div style={{ fontSize: 12, color: "#666" }}>{new Date(p.updated_at).toLocaleString()}</div>
          </a>
        ))}
      </div>
      </div>
    </div>
  );
}
