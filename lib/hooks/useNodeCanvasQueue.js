// lib/hooks/useNodeCanvasQueue.js
import { useCallback, useRef, useState } from "react";

/**
 * Manage pending node queue and server-first add flow.
 *
 * Args:
 * - nodeCanvasRef: ref for NodeCanvas (imperative)
 * - currentProjectId: string | null
 * - createProjectNode: async (projectId, payload) => { node, signedUrl?, storagePath? } (optional)
 * - addedNodeIdsRef: ref(Set) for dedupe
 * - normalizeStoragePath: fn (optional)
 *
 * Returns:
 * { pendingQueue, enqueue(item), addNodeToCanvas(item), flushPending() }
 */
export function useNodeCanvasQueue({
  nodeCanvasRef,
  currentProjectId,
  createProjectNode = null,
  addedNodeIdsRef,
  normalizeStoragePath = (p) => (typeof p === "string" && p.startsWith("/") ? p.slice(1) : p),
}) {
  const [pendingQueue, setPendingQueue] = useState([]);
  const pendingQueueRef = useRef([]);
  // keep ref in sync with state
  pendingQueueRef.current = pendingQueueRef.current || [];
  // Ensure enqueue updates both state and ref
  const enqueue = useCallback((item) => {
    pendingQueueRef.current = [...pendingQueueRef.current, item];
    setPendingQueue((q) => [...q, item]);
  }, []);

  // addNodeToCanvas: server-first then local fallback
  const addNodeToCanvas = useCallback(
    async ({ id = null, image = null, prompt = "", model = "", position = null, width = 260, height = 180 } = {}) => {
      // dedupe when id present
      if (id && addedNodeIdsRef.current.has(id)) return id;

      // If id present but canvas not ready, queue it
      if (id && !nodeCanvasRef.current) {
        enqueue({ id, image, prompt, model, position, width, height });
        return id;
      }

      // If id present and canvas ready, local add (server row assumed already created)
      if (id) {
        try {
          nodeCanvasRef.current.addImageNode({ id, image, prompt, model, position, width, height });
          addedNodeIdsRef.current.add(id);
        } catch (e) {
          // fallback to queue if canvas throws
          enqueue({ id, image, prompt, model, position, width, height });
        }
        return id;
      }

      // server-first if project + createProjectNode provided
      if (currentProjectId && typeof createProjectNode === "function") {
        try {
          const payload = { externalUrl: image || null, x: position?.x ?? 120, y: position?.y ?? 120, width, height, data: { prompt, model } };
          const res = await createProjectNode(currentProjectId, payload);
          if (res && res.node && res.node.id) {
            const nodeRow = res.node;
            try {
              nodeCanvasRef.current.addImageNode({
                id: nodeRow.id,
                image: res.signedUrl ?? null,
                prompt: nodeRow.data?.prompt ?? prompt,
                model: nodeRow.data?.model ?? model,
                position: { x: nodeRow.x ?? payload.x, y: nodeRow.y ?? payload.y },
                width: nodeRow.width ?? width,
                height: nodeRow.height ?? height,
              });
              addedNodeIdsRef.current.add(nodeRow.id);
            } catch (e) {
              // If canvas add failed, enqueue for later
              enqueue({ id: nodeRow.id, image: res.signedUrl ?? null, prompt: nodeRow.data?.prompt ?? prompt, model: nodeRow.data?.model ?? model, position: { x: nodeRow.x ?? payload.x, y: nodeRow.y ?? payload.y }, width: nodeRow.width ?? width, height: nodeRow.height ?? height });
            }
            return nodeRow.id;
          }
        } catch (err) {
          // server create failed; fall through to local add
          console.warn("createProjectNode failed in queue, falling back to local add", err);
        }
      }

      // local add fallback (queue if canvas missing)
      if (!nodeCanvasRef.current) {
        enqueue({ id, image, prompt, model, position, width, height });
        return null;
      }

      try {
        const newId = nodeCanvasRef.current.addImageNode({ id, image, prompt, model, position, width, height });
        const effectiveId = id || newId;
        if (effectiveId) addedNodeIdsRef.current.add(effectiveId);
        return effectiveId;
      } catch (err) {
        // On unexpected error, enqueue for later
        enqueue({ id, image, prompt, model, position, width, height });
        return null;
      }
    },
    [currentProjectId, createProjectNode, nodeCanvasRef, addedNodeIdsRef, enqueue]
  );

  // flushPending: stable identity (does NOT depend on pendingQueue state directly)
  const flushPending = useCallback(async () => {
    // take current queue snapshot from ref
    const queueSnapshot = pendingQueueRef.current ? [...pendingQueueRef.current] : [];
    if (!queueSnapshot.length) {
      // nothing to do
      return;
    }

    // clear both ref and state immediately (so subsequent enqueues start fresh)
    pendingQueueRef.current = [];
    setPendingQueue([]);

    for (const item of queueSnapshot) {
      try {
        // await each add to preserve order & allow server-first flow
        // if addNodeToCanvas enqueues again (e.g., canvas still not ready) it'll go into pendingQueueRef
        // which will be handled by subsequent flushPending calls when appropriate
        // Note: addNodeToCanvas is in deps, so useCallback ensures correct function used.
        // eslint-disable-next-line no-await-in-loop
        await addNodeToCanvas(item);
      } catch (e) {
        console.error("Failed to flush pending node", e, item);
      }
    }
  }, [addNodeToCanvas]);

  return { pendingQueue, enqueue, addNodeToCanvas, flushPending };
}
