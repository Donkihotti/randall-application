// lib/hooks/useNodeCanvasQueue.js
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useNodeCanvasQueue
 *
 * - nodeCanvasRef: ref to NodeCanvas imperative API
 * - currentProjectId: project id or null
 * - createProjectNode: async function(projectId, payload) -> server response
 * - addedNodeIdsRef: ref to Set used for dedupe
 * - normalizeStoragePath: helper to normalize canonical paths
 *
 * Returns:
 *  - pendingQueue, enqueue(item), addNodeToCanvas(item), flushPending()
 */
export function useNodeCanvasQueue({
  nodeCanvasRef,
  currentProjectId,
  createProjectNode,
  addedNodeIdsRef,
  normalizeStoragePath,
}) {
  const [pendingQueue, setPendingQueue] = useState([]);
  const pendingQueueRef = useRef([]);
  const creatingRef = useRef(new Set());

  // keep refs in sync with state
  const setPendingQueueAndRef = (updater) => {
    setPendingQueue((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      pendingQueueRef.current = Array.isArray(next) ? next : [];
      return next;
    });
  };

  // Helper: local add to canvas; respects nodeCanvasRef API and attaches data carefully.
  const localAdd = useCallback(
    async ({
      id = null,
      image = null,
      prompt = undefined,
      model = undefined,
      position = null,
      width = 260,
      height = 180,
      data = undefined, // undefined => caller didn't provide; {} or object => explicit
    } = {}) => {
      // If NodeCanvas not ready, queue (store data in queue as provided)
      if (!nodeCanvasRef.current || typeof nodeCanvasRef.current.addImageNode !== "function") {
        setPendingQueueAndRef((q) => [...q, { id, image, prompt, model, position, width, height, data }]);
        return null;
      }

      // Call addImageNode and include data only if provided (so NodeCanvas can receive it)
      const payload = {
        id,
        image,
        prompt,
        model,
        position,
        width,
        height,
      };
      if (typeof data !== "undefined") payload.data = data;

      const newId = nodeCanvasRef.current.addImageNode(payload);

      // If caller explicitly provided data (non-empty object), attach it via updateNode (merge-safe)
      if (typeof data !== "undefined" && data && Object.keys(data).length > 0) {
        try {
          nodeCanvasRef.current.updateNode?.(newId, { data });
        } catch (err) {
          // best-effort, ignore
        }
      }

      if (newId) addedNodeIdsRef?.current?.add(newId);
      return newId;
    },
    [nodeCanvasRef, addedNodeIdsRef]
  );

  // Main function: add node with server-first preference. Note: data default is undefined
  const addNodeToCanvas = useCallback(
    async ({
      id = null,
      image = null,
      prompt = undefined,
      model = undefined,
      position = null,
      width = 260,
      height = 180,
      data = undefined,
    } = {}) => {
      // idempotent short-circuit
      if (id && addedNodeIdsRef?.current?.has(id)) return id;

      // If an id is provided and canvas exists -> local add only (preserve/merge data)
      if (id) {
        if (!nodeCanvasRef.current) {
          setPendingQueueAndRef((q) => [...q, { id, image, prompt, model, position, width, height, data }]);
          return id;
        }

        // Pass data into addImageNode only if provided (to avoid stomping)
        const payload = { id, image, prompt, model, position, width, height };
        if (typeof data !== "undefined") payload.data = data;

        nodeCanvasRef.current.addImageNode?.(payload);

        // Only call updateNode if caller provided an explicit non-empty data object.
        if (typeof data !== "undefined" && data && Object.keys(data).length > 0) {
          try {
            nodeCanvasRef.current.updateNode?.(id, { data });
          } catch (_) {}
        }
        addedNodeIdsRef?.current?.add(id);
        return id;
      }

      // Server-first flow
      if (currentProjectId) {
        const payload = {
          externalUrl: image || null,
          x: Math.round(position?.x ?? 120),
          y: Math.round(position?.y ?? 120),
          width,
          height,
          data: { ...(typeof prompt !== "undefined" ? { prompt } : {}), ...(typeof model !== "undefined" ? { model } : {}), ...(data || {}) },
        };

        // Build a conservative key to avoid duplicate server posts
        const key = `${payload.x}__${payload.y}__${payload.width}__${payload.height}__${payload.externalUrl ?? ""}`;
        if (creatingRef.current.has(key)) {
          // short wait and then fallback to a local add — don't block forever
          await new Promise((r) => setTimeout(r, 80));
        } else {
          creatingRef.current.add(key);
          try {
            let json;
            if (typeof createProjectNode === "function") {
              try {
                json = await createProjectNode(currentProjectId, payload);
              } catch (err) {
                try {
                  json = await createProjectNode(payload);
                } catch (err2) {
                  throw err;
                }
              }
            } else {
              throw new Error("createProjectNode is not a function");
            }

            const nodeRow = json?.node ?? null;
            const signedUrl = json?.signedUrl ?? null;
            const storagePath = json?.storagePath ?? nodeRow?.data?.image ?? null;

            // If server didn't return a node id, fallback to local add
            if (!nodeRow || !nodeRow.id) {
              const localId = await localAdd({ id: null, image: image || signedUrl || null, prompt, model, position, width, height, data });
              if (localId) addedNodeIdsRef?.current?.add(localId);
              return localId;
            }

            // store canonical path if provided (consumer may use it)
            if (storagePath && typeof normalizeStoragePath === "function") {
              try {
                const normalized = normalizeStoragePath(storagePath);
                // cannot write caller's nodeStoragePathRef from here; caller should handle if needed
                // keep best-effort: nothing more to do
              } catch (e) {}
            }

            // Build payload for canvas. Use server-provided nodeRow.data if present.
            const imageToUse = signedUrl ?? (nodeRow?.data?.image ?? null);
            const canvasPayload = {
              id: nodeRow.id,
              image: imageToUse,
              prompt: nodeRow.data?.prompt ?? (typeof prompt !== "undefined" ? prompt : undefined),
              model: nodeRow.data?.model ?? (typeof model !== "undefined" ? model : undefined),
              position: { x: nodeRow.x ?? payload.x, y: nodeRow.y ?? payload.y },
              width: nodeRow.width ?? width,
              height: nodeRow.height ?? height,
            };
            // Attach server data only if present (avoid sending empty object that would erase existing)
            if (nodeRow.data && Object.keys(nodeRow.data).length > 0) canvasPayload.data = nodeRow.data;

            nodeCanvasRef.current?.addImageNode?.(canvasPayload);

            // If there is server-side data, ensure canvas has it (best-effort)
            if (nodeRow.data && Object.keys(nodeRow.data).length > 0) {
              try {
                nodeCanvasRef.current.updateNode?.(nodeRow.id, { data: nodeRow.data });
              } catch (e) {}
            }

            addedNodeIdsRef?.current?.add(nodeRow.id);
            return nodeRow.id;
          } finally {
            creatingRef.current.delete(key);
          }
        }
      }

      // fallback local add (no project)
      const newId = await localAdd({ id: null, image, prompt, model, position, width, height, data });
      if (newId) addedNodeIdsRef?.current?.add(newId);
      return newId;
    },
    [currentProjectId, createProjectNode, localAdd, normalizeStoragePath, addedNodeIdsRef]
  );

  // enqueue for later flush
  const enqueue = useCallback((item) => {
    setPendingQueueAndRef((q) => [...q, item]);
  }, []);

  // flush pending queue — stable identity (depends only on addNodeToCanvas)
  const flushPending = useCallback(
    async () => {
      const queue = Array.isArray(pendingQueueRef.current) ? [...pendingQueueRef.current] : [];
      if (!queue.length) return;
      // clear both ref and state synchronously so callers don't see items during flush
      pendingQueueRef.current = [];
      setPendingQueue([]); // triggers state update once

      for (const item of queue) {
        try {
          await addNodeToCanvas(item);
        } catch (e) {
          console.error("Failed to flush pending node", e, item);
        }
      }
    },
    [addNodeToCanvas]
  );

  // Keep pendingQueue stable when nodeCanvasRef becomes available:
  useEffect(() => {
    if (!nodeCanvasRef?.current) return;
    if (!pendingQueueRef.current || pendingQueueRef.current.length === 0) return;
    // flush asynchronously
    (async () => {
      try {
        await flushPending();
      } catch (e) {
        console.warn("flushPending failed", e);
      }
    })();
    // only re-run when nodeCanvasRef.current identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCanvasRef?.current]);

  return { pendingQueue, enqueue, addNodeToCanvas, flushPending };
}

export default useNodeCanvasQueue;
