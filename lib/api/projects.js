export async function createProjectNode(projectId, payload) {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    });
    if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`createProjectNode failed: ${res.status} ${txt}`);
    }
    return res.json(); // expected: { node, signedUrl, storagePath }
    }
    
    
    export async function patchProjectNode(projectId, nodeId, body) {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    });
    if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`patchProjectNode failed: ${res.status} ${txt}`);
    }
    return res.json();
    }
    
    
    export async function deleteProjectNode(projectId, nodeId) {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`, {
    method: "DELETE",
    });
    if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`deleteProjectNode failed: ${res.status} ${txt}`);
    }
    return res;
    }
    
    
    export async function createProjectEdge(projectId, payload) {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/edges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    });
    if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`createProjectEdge failed: ${res.status} ${txt}`);
    }
    return res.json();
    }