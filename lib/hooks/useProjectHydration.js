// lib/hooks/useProjectHydration.js
import { useEffect, useRef, useState } from "react";

/**
 * Hydrates nodes + edges from Supabase into a NodeCanvas.
 *
 * Args:
 * - projectId: string
 * - nodeCanvasRef: ref to NodeCanvas (imperative API)
 * - addedNodeIdsRef: ref(Set) to dedupe nodes client-side
 * - supabase: supabase client instance (or any object with .from(...).select(...).eq(...) pattern)
 * - getSignedUrls: async function(paths: string[]) -> { [path]: signedUrl } (optional)
 * - normalizeStoragePath: fn to normalize canonical storage path (optional)
 *
 * Returns { loading, error, refresh }.
 */
export function useProjectHydration({
  projectId,
  nodeCanvasRef,
  addedNodeIdsRef,
  supabase,
  getSignedUrls = null,
  normalizeStoragePath = (p) => (typeof p === "string" && p.startsWith("/") ? p.slice(1) : p),
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const waitForCanvasReady = async (timeoutMs = 3000, intervalMs = 50) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (nodeCanvasRef.current &&
          typeof nodeCanvasRef.current.addImageNode === "function" &&
          typeof nodeCanvasRef.current.getNodes === "function") {
        return true;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return !!(nodeCanvasRef.current && typeof nodeCanvasRef.current.addImageNode === "function");
  };

  const refresh = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    try {
      await waitForCanvasReady();

      // clear canvas and dedupe set if possible
      nodeCanvasRef.current?.clear?.();
      addedNodeIdsRef.current?.clear?.();

      // read nodes
      const { data: nodesData = [], error: nodesErr } = await supabase
        .from("nodes")
        .select("id, x, y, width, height, data")
        .eq("project_id", projectId);

      if (nodesErr) throw nodesErr;

      // collect storage paths for batch signed-url request
      const storagePaths = Array.from(
        new Set(
          (nodesData || [])
            .map((r) => r?.data?.image)
            .filter(Boolean)
            .filter((p) => !/^https?:\/\//i.test(p) && !p.includes("/storage/v1/object/sign/"))
        )
      );

      let signedUrlsMap = {};
      if (storagePaths.length && typeof getSignedUrls === "function") {
        try {
          signedUrlsMap = await getSignedUrls(storagePaths);
        } catch (e) {
          // non-fatal: we'll try per-node as fallback
          console.warn("getSignedUrls failed", e);
        }
      }

      for (const nodeRow of nodesData) {
        if (!mountedRef.current) return;
        if (!nodeRow || !nodeRow.id) continue;
        if (addedNodeIdsRef.current?.has(nodeRow.id)) continue;

        const rawImageVal = nodeRow?.data?.image;
        let displayImage = null;

        if (rawImageVal && /^https?:\/\//i.test(rawImageVal)) {
          displayImage = rawImageVal;
        } else if (rawImageVal) {
          displayImage = signedUrlsMap[rawImageVal] ?? null;

          // try single-path fallback
          if (!displayImage && typeof getSignedUrls === "function") {
            try {
              const single = await getSignedUrls([rawImageVal]);
              displayImage = single?.[rawImageVal] ?? null;
            } catch (e) { /* ignore */ }
          }
        }

        try {
          nodeCanvasRef.current.addImageNode({
            id: nodeRow.id,
            image: displayImage,
            prompt: nodeRow.data?.prompt ?? "",
            model: nodeRow.data?.model ?? "",
            position: { x: nodeRow.x ?? 120, y: nodeRow.y ?? 120 },
            width: nodeRow.width ?? 260,
            height: nodeRow.height ?? 180,
          });
          addedNodeIdsRef.current?.add(nodeRow.id);
        } catch (err) {
          console.warn("Failed to add node to canvas during hydration", nodeRow.id, err);
        }
      }

      // edges
      const { data: edgesData = [], error: edgesErr } = await supabase
        .from("edges")
        .select("id, source_node, target_node")
        .eq("project_id", projectId);

      if (edgesErr) throw edgesErr;

      // add edges only when both endpoints are present
      const existingNodes = new Set((nodeCanvasRef.current?.getNodes?.() || []).map((n) => n.id));
      const existingEdges = new Set((nodeCanvasRef.current?.getEdges?.() || []).map((e) => `${e.sourceId}__${e.targetId}`));
      for (const eRow of edgesData) {
        if (!mountedRef.current) return;
        const key = `${eRow.source_node}__${eRow.target_node}`;
        if (existingEdges.has(key)) continue;
        if (!existingNodes.has(eRow.source_node) || !existingNodes.has(eRow.target_node)) continue;
        nodeCanvasRef.current.addEdge?.({ sourceId: eRow.source_node, targetId: eRow.target_node });
      }

      if (mountedRef.current) setLoading(false);
    } catch (err) {
      if (mountedRef.current) {
        setError(err);
        setLoading(false);
      } else {
        console.error("useProjectHydration error while unmounted", err);
      }
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return { loading, error, refresh };
}
