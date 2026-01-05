// client-side helper
export async function finalizeGeneratedImage({ externalUrl, projectId, position, width = 260, height = 180, prompt = "", model = "", sourceNodeId = null, nodeCanvasRef }) {
    try {
      // get access token from supabase client
      const session = await (await import('../lib/supabaseClient')).supabase.auth.getSession();
      const token = session?.data?.session?.access_token;
      if (!token) throw new Error("Not authenticated");
  
      const body = { externalUrl, projectId, position, width, height, prompt, model, sourceNodeId };
      const r = await fetch("/api/finalizeGeneratedImage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
  
      const json = await r.json();
      if (!r.ok || !json?.ok) {
        throw new Error(json?.error || "Server finalize failed");
      }
  
      const { node, image, edge, signedUrl } = json;
  
      // If NodeCanvas supports a server-side id in addImageNode, pass it
      const payload = {
        id: node.id, // only use this if you applied the NodeCanvas tweak above
        image: signedUrl || (image?.storage_path ? `/api/getPublicOrSigned?path=${encodeURIComponent(image.storage_path)}` : null),
        prompt: (node.data?.prompt ?? prompt),
        model: node.data?.model ?? model,
        position: { x: node.x ?? position?.x ?? 80, y: node.y ?? position?.y ?? 80 },
        width: node.width ?? width,
        height: node.height ?? height
      };
  
      const newNodeId = nodeCanvasRef?.current?.addImageNode?.(payload);
      // If server created an edge, add it to canvas (ensure NodeCanvas has addEdge)
      if (edge && nodeCanvasRef?.current?.addEdge && sourceNodeId) {
        // edge.source_node = sourceNodeId, edge.target_node = node.id
        nodeCanvasRef.current.addEdge({ sourceId: sourceNodeId, targetId: node.id });
      } else if (sourceNodeId && nodeCanvasRef?.current?.addEdge) {
        // if server didn't return edge row but you requested one, attempt to add it client side
        nodeCanvasRef.current.addEdge({ sourceId: sourceNodeId, targetId: node.id });
      }
  
      return { node, image, edge, newNodeId };
    } catch (err) {
      console.error("finalizeGeneratedImage (client) error", err);
      throw err;
    }
  }
  