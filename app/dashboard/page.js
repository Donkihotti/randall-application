'use client';

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import CreateProjectButton from "../components/buttons/CreateProjectButton";
import ProjectsPanel from "./components/ProjectsPanel";

export default function Dashboard () {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); 

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
    <div className="p-4 bg-black">
    <h1>Projects</h1>
    <div className="w-full mt-8">
      <CreateProjectButton />
      {loading && <div>Loading...</div>}
      <div style={{ display: "grid", gap: 8,}} className="mt-4">
        {projects.map(p => (
          <a key={p.id} href={`/create?projectId=${p.id}`} className="border rounded-xs justify-between items-center px-2 py-1 flex flex-row border-border-main hover:bg-canvas transition-all duration-100">
            <div>
                <div className="text-medium">{p.title}</div>
                <div style={{ fontSize: 12, color: "#666" }}>{new Date(p.updated_at).toLocaleString()}</div>
            </div>
            <div className="button-icon text-xs hover:bg-main-white hover:text-black h-fit">Delete</div>
          </a>
        ))}
      </div>
      </div>
    </div>
  );
}
