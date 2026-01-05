// components/ProjectsPanel.jsx
"use client";
import { useEffect, useState } from "react";
import { listProjects, createProject } from "@/lib/api";

export default function ProjectsPanel({ onSelectProject }) {
  const [projects, setProjects] = useState([]);
  const [title, setTitle] = useState("");

  async function load() {
    try {
      const data = await listProjects();
      setProjects(data ?? []);
    } catch (err) {
      console.error("load projects", err);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e?.preventDefault();
    if (!title) return;
    try {
      const p = await createProject({ title, description: "" });
      setTitle("");
      setProjects((prev) => [p, ...prev]);
      onSelectProject?.(p);
    } catch (err) {
      console.error("create project", err);
      alert(err.message || String(err));
    }
  }

  return (
    <div style={{ width: 280 }}>
      <form onSubmit={handleCreate} className="mb-4">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New project title" />
        <button type="submit">Create</button>
      </form>

      <div className="space-y-2">
        {projects.map((p) => (
          <div key={p.id} style={{ padding: 8, border: "1px solid #2222", borderRadius: 6, cursor: "pointer" }}
               onClick={() => onSelectProject?.(p)}>
            <div style={{ fontWeight: 600 }}>{p.title}</div>
            <div style={{ fontSize: 12, color: "#888" }}>{new Date(p.updated_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
