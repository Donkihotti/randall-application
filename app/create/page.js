// app/page.js (app router) — patched, drop-in ready
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

import Tools from "./components/Tools";
import DownloadButton from "./components/DownloadButton";
import ExpandButton from "./components/ExpandButton";
import OptionsButton from "./components/OptionsButton";
import NodeCanvas from "./components/node/NodeCanvas";
import ImageContainer from "./components/ImageContainer";
import EditSideBar from "./components/edit/EditSideBar";
import EditScreen from "./components/edit/EditScreen";
import ProtectedRoute from "../components/ProtectedRoute";

import { finalizeGeneratedImage } from "@/lib/finalize";

// supabase browser client (RLS enforced). Ensure NEXT_PUBLIC_* env vars exist.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function Page() {
  // ---- Core UI state ----
  const [prompt, setPrompt] = useState("");
  const latestGenerationPromptRef = useRef("");
  const processedPredictionsRef = useRef(new Set());
  const [generating, setGenerating] = useState(false);
  const [predictionId, setPredictionId] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [images, setImages] = useState([]);
  const [error, setError] = useState(null);
  const [referenceUrls, setReferenceUrls] = useState([]);
  const pollRef = useRef(null);

  const creatingEdgesRef = useRef(new Set()); // keys currently being POSTed
  const createdEdgesRef = useRef(new Set());  // keys we've already created successfully

  const suppressNodeChangeRef = useRef(false); // when true, handleNodeChange will ignore events
  const nodeStoragePathRef = useRef(new Map()); // nodeId -> canonical storage path (e.g. projects/<id>/images/...)
  const looksLikeAbsoluteUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
  const looksLikeSignedUrl = (s) => typeof s === "string" && s.includes("/storage/v1/object/sign/");
  const canonicalStorageRegex = /^(?:\/)?projects\/[0-9a-fA-F-]{36}\/images\/.+$/i;
  const normalizeStoragePath = (p) => (typeof p === "string" ? (p.startsWith("/") ? p.slice(1) : p) : p);

  const searchParams = useSearchParams();
  const [currentProjectId, setCurrentProjectId] = useState(null);

  const [mode, setMode] = useState("create"); // 'create'|'generating'|'preview'|'edit'

  // ---- Node canvas refs & selection ----
  const nodeCanvasRef = useRef(null);

  // Selected node object (from canvas). We store it in state.
  const [selectedNode, setSelectedNode] = useState(null);

  // When a generation starts that targets a selected node or placeholder, we lock the target here
  // so selection changes by the user won't steal the final image.
  const currentTargetRef = useRef(null);

  // Pending node payloads when NodeCanvas isn't mounted yet
  const [pendingNodeQueue, setPendingNodeQueue] = useState([]);

  const latestImage = images.length ? images[images.length - 1] : null;

  // dedupe set of canvas node ids already added (prevents duplicate adds on hydration/finalize)
  const addedNodeIdsRef = useRef(new Set());

  const isUuid = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

   // Clear per-project caches when project changes
   useEffect(() => {
    creatingEdgesRef.current.clear();
    createdEdgesRef.current.clear();
  }, [currentProjectId]);

  const edgeKey = (src, tgt) => `${src}__${tgt}`;

  // files + uploads
  const [files, setFiles] = useState([]);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => {
        try {
          URL.revokeObjectURL(f.previewUrl);
        } catch (e) {}
      });
    };
  }, []);

  // ===== Options / panels =====
  const panelDefinitions = {
    ratio: {
      label: "Aspect Ratio",
      defaults: { selected: "9:16" },
      options: [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
      ],
      valueKey: "selected",
    },
    quality: {
      label: "Quality",
      defaults: { level: "high" },
      options: ["low", "medium", "high"],
    },
    model: {
      label: "Model",
      defaults: { selected: "nano-banana-pro" },
      options: ["nano-banana-pro", "nano-banana", "seedream 4.0"],
    },
    output: {
      label: "Output",
      defaults: { selected: "png" },
      options: ["png", "jpg", "jpeg"],
    },
  };

  const [panelValues, setPanelValues] = useState(() => {
    const init = {};
    for (const id in panelDefinitions) {
      init[id] = { ...(panelDefinitions[id].defaults || {}) };
    }
    return init;
  });

  const setPanelValue = (panelId, key, value) => {
    setPanelValues((prev) => ({
      ...prev,
      [panelId]: { ...(prev[panelId] || {}), [key]: value },
    }));
  };

  const options = {
    aspect_ratio: panelValues.ratio?.selected ?? "9:16",
    quality: panelValues.quality?.level ?? "medium",
    output_format: panelValues.output?.selected ?? "png",
  };

  // safe update helper: suppress onNodeChange while programmatically updating
  function safeUpdateNode(nodeId, patch) {
    try {
      suppressNodeChangeRef.current = true;
      nodeCanvasRef.current?.updateNode?.(nodeId, patch);
    } catch (e) {
      console.warn("safeUpdateNode failed", e);
    } finally {
      // let any synchronous onNodeChange handlers run and ignore them
      // clear suppression on next tick to allow user interactions to flow normally
      setTimeout(() => {
        suppressNodeChangeRef.current = false;
      }, 0);
    }
  }

  // helper to avoid duplicates from finalizeGeneratedImage
  const finalizeLocksRef = useRef(new Map()); // key -> Promise for in-flight finalize

  async function finalizeOnce(key, finalizeArgs) {
    if (!key) throw new Error("finalizeOnce requires a key");

    // already handled
    if (processedPredictionsRef.current.has(key)) {
      return { alreadyProcessed: true };
    }

    // in-flight
    if (finalizeLocksRef.current.has(key)) {
      try {
        return await finalizeLocksRef.current.get(key);
      } catch (err) {
        finalizeLocksRef.current.delete(key);
        throw err;
      }
    }

    const p = (async () => {
      // optimistic mark (so other code paths skip immediately)
      processedPredictionsRef.current.add(key);
      try {
        const res = await finalizeGeneratedImage(finalizeArgs);
        return res;
      } catch (err) {
        // rollback optimistic mark so retry can happen later
        processedPredictionsRef.current.delete(key);
        throw err;
      } finally {
        finalizeLocksRef.current.delete(key);
      }
    })();

    finalizeLocksRef.current.set(key, p);
    return await p;
  }

  // read projectId from querystring once
  useEffect(() => {
    const pid = searchParams?.get("projectId");
    if (pid) setCurrentProjectId(pid);
  }, [searchParams]);

  // helper: add node to canvas with dedupe by id (uses addedNodeIdsRef)
  const addNodeToCanvas = useCallback(
    async ({ id = null, image = null, prompt = "", model = "", position = null, width = 260, height = 180 } = {}) => {
      // if id provided and already added, short-circuit
      if (id && addedNodeIdsRef.current.has(id)) return id;

      // If id provided, assume server row exists -> local-only add (do NOT POST)
      if (id) {
        // if NodeCanvas not ready, queue it
        if (!nodeCanvasRef.current) {
          setPendingNodeQueue((q) => [...q, { id, image, prompt, model, position, width, height }]);
          return id;
        }
        nodeCanvasRef.current.addImageNode({
          id,
          image,
          prompt,
          model,
          position,
          width,
          height,
        });
        addedNodeIdsRef.current.add(id);
        return id;
      }

      // If we have a project and no id, prefer server-first flow:
      if (currentProjectId) {
        try {
          // Build payload for server. If image is a remote URL (external) we'll pass as externalUrl.
          // If image is already a signedUrl / data URL you can also pass it; server code handles fetch/upload.
          const payload = {
            externalUrl: image || null,
            x: position?.x ?? 120,
            y: position?.y ?? 120,
            width,
            height,
            data: { prompt, model },
          };

          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/nodes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.warn("Server node create failed:", res.status, text);
            throw new Error("Server node create failed");
          }

          const json = await res.json().catch(() => ({}));
          const nodeRow = json?.node ?? null;
          const signedUrl = json?.signedUrl ?? null;

          if (!nodeRow || !nodeRow.id) {
            console.warn("Server returned no node id, falling back to local add", json);
            // fallback to local add if server didn't return an id
            const localId = nodeCanvasRef.current?.addImageNode?.({ id, image, prompt, model, position, width, height });
            if (localId) addedNodeIdsRef.current.add(localId);
            return localId;
          }

          // add (idempotent) to canvas using server id and signed url for immediate display
          nodeCanvasRef.current?.addImageNode?.({
            id: nodeRow.id,
            image: signedUrl ?? null,
            prompt: nodeRow.data?.prompt ?? prompt,
            model: nodeRow.data?.model ?? model,
            position: { x: nodeRow.x ?? payload.x, y: nodeRow.y ?? payload.y },
            width: nodeRow.width ?? width,
            height: nodeRow.height ?? height,
          });

          addedNodeIdsRef.current.add(nodeRow.id);
          return nodeRow.id;
        } catch (err) {
          console.warn("addNodeToCanvas server-first failed, falling back to local add:", err);
          // fallback local
        }
      }

      // If no project or server flow failed — local add (same as before)
      if (!nodeCanvasRef.current) {
        // queue if not ready
        setPendingNodeQueue((q) => [...q, { id, image, prompt, model, position, width, height }]);
        return null;
      }

      // final local add
      const newId = nodeCanvasRef.current.addImageNode({
        id,
        image,
        prompt,
        model,
        position,
        width,
        height,
      });
      const effectiveId = id || newId;
      if (effectiveId) addedNodeIdsRef.current.add(effectiveId);
      return effectiveId;
    },
    [currentProjectId]
  );

  // Hydrate project nodes & edges when projectId changes (drop-in replacement)
  useEffect(() => {
    if (!currentProjectId) return;
    let mounted = true;

    // small helper: wait for nodeCanvasRef.current to become available
    async function waitForCanvasReady(timeoutMs = 3000, intervalMs = 50) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (nodeCanvasRef.current && typeof nodeCanvasRef.current.addImageNode === "function" && typeof nodeCanvasRef.current.getNodes === "function") {
          return true;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return !!(nodeCanvasRef.current && typeof nodeCanvasRef.current.addImageNode === "function");
    }

    async function loadProject() {
      const ready = await waitForCanvasReady();
      if (!mounted) return;

      // clear canvas and dedupe set
      if (nodeCanvasRef.current?.clear) nodeCanvasRef.current.clear();
      addedNodeIdsRef.current.clear();

      // fetch nodes via supabase client (RLS enforced)
      const { data: nodesData = [], error: nodesErr } = await supabase
        .from("nodes")
        .select("id, x, y, width, height, data")
        .eq("project_id", currentProjectId);

      if (nodesErr) {
        console.error("loadProject nodes fetch failed", nodesErr);
        return;
      }

      // collect storage paths to request signed urls in one call
      const storagePaths = Array.from(
        new Set(
          (nodesData || [])
            .map((r) => r?.data?.image)
            .filter(Boolean)
            .filter((p) => !/^https?:\/\//i.test(p) && !p.includes("/storage/v1/object/sign/"))
        )
      );

      let signedUrlsMap = {};
      if (storagePaths.length > 0) {
        try {
          const r = await fetch("/api/getSignedUrl", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: storagePaths }),
          });
          if (r.ok) {
            const j = await r.json();
            signedUrlsMap = j.signedUrls ?? {};
          } else {
            console.warn("getSignedUrl failed", await r.text());
          }
        } catch (err) {
          console.warn("getSignedUrl request error", err);
        }
      }

      // Add nodes deterministically
      for (const nodeRow of nodesData) {
        if (!mounted) return;

        const rawImageVal = nodeRow?.data?.image;
        let displayImage = null;

        // If data.image is an absolute URL — use it directly.
        if (rawImageVal && /^https?:\/\//i.test(rawImageVal)) {
          displayImage = rawImageVal;
        } else if (rawImageVal) {
          // It's likely a storage path -> look up signed URL from the map.
          displayImage = signedUrlsMap[rawImageVal] ?? null;

          // If we didn't get a signed URL (null), try a single-path retry (helps if the initial batch failed).
          if (!displayImage) {
            try {
              const rr = await fetch("/api/getSignedUrl", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths: [rawImageVal] }),
              });
              if (rr.ok) {
                const jj = await rr.json();
                displayImage = jj.signedUrls?.[rawImageVal] ?? null;
              }
            } catch (e) {
              // ignore retry failure
            }
          }
        }

        // If already added (dedupe), skip
        if (addedNodeIdsRef.current.has(nodeRow.id)) continue;

        try {
          nodeCanvasRef.current.addImageNode({
            id: nodeRow.id,
            image: displayImage, // either signed url, external url, or null (empty node)
            prompt: nodeRow.data?.prompt ?? "",
            model: nodeRow.data?.model ?? "",
            position: { x: nodeRow.x ?? 120, y: nodeRow.y ?? 120 },
            width: nodeRow.width ?? 260,
            height: nodeRow.height ?? 180,
          });
          addedNodeIdsRef.current.add(nodeRow.id);
        } catch (err) {
          console.warn("Failed to add node to canvas during hydration", nodeRow.id, err);
        }
      }

      // Load edges
      const { data: edgesData = [], error: edgesErr } = await supabase
        .from("edges")
        .select("id, source_node, target_node")
        .eq("project_id", currentProjectId);

      if (edgesErr) {
        console.warn("Failed to fetch edges", edgesErr);
      } else {
        // add edges if both endpoints present
        const existingNodes = new Set((nodeCanvasRef.current?.getNodes?.() || []).map((n) => n.id));
        const existingEdges = new Set((nodeCanvasRef.current?.getEdges?.() || []).map((e) => `${e.sourceId}__${e.targetId}`));
        for (const eRow of edgesData) {
          if (!mounted) return;
          const key = `${eRow.source_node}__${eRow.target_node}`;
          if (existingEdges.has(key)) continue;
          if (!existingNodes.has(eRow.source_node) || !existingNodes.has(eRow.target_node)) {
            console.warn("Skipping edge because node(s) missing", eRow);
            continue;
          }
          nodeCanvasRef.current.addEdge?.({ sourceId: eRow.source_node, targetId: eRow.target_node });
        }
      }
    }

    loadProject();
    return () => { mounted = false; };
  }, [currentProjectId]);

  // ===== Node queue flush (when NodeCanvas becomes ready) =====
  useEffect(() => {
    if (!nodeCanvasRef.current) return;
    if (!pendingNodeQueue || pendingNodeQueue.length === 0) return;

    let cancelled = false;

    (async () => {
      for (const item of pendingNodeQueue) {
        if (cancelled) break;
        try {
          // await server-first add
          await addNodeToCanvas(item);
        } catch (err) {
          console.error("Failed to flush pending node to NodeCanvas", err, item);
        }
      }
      if (!cancelled) setPendingNodeQueue([]);
    })();

    return () => { cancelled = true; };
  }, [pendingNodeQueue, addNodeToCanvas]);

  // ---- Helpers for node add/update ----
  function findPlaceholderNodeId() {
    const nodes = nodeCanvasRef.current?.getNodes?.() ?? null;
    if (!nodes || !Array.isArray(nodes)) return null;
    const placeholder = nodes.find((n) => !n?.data?.image);
    return placeholder ? placeholder.id : null;
  }

  function enqueueOrAddImageNode({ imageUrl, promptText = "", modelName = "" }) {
    if (!imageUrl || typeof imageUrl !== "string") {
      console.warn("enqueueOrAddImageNode called with invalid imageUrl:", imageUrl);
      return;
    }

    // Prefer updating the selected node if we're not in edit mode
    if (mode !== "edit" && selectedNode?.id && nodeCanvasRef.current?.updateNode) {
      try {
        nodeCanvasRef.current.updateNode(selectedNode.id, {
          data: { image: imageUrl, status: "done", prompt: promptText, model: modelName },
        });
        const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === selectedNode.id) ?? null;
        if (updated) setSelectedNode(updated);
        return;
      } catch (err) {
        console.error("updateNode failed, falling back to addImageNode", err);
      }
    }

    // If nothing selected, prefer placeholder
    const placeholderId = findPlaceholderNodeId();
    if (placeholderId && nodeCanvasRef.current?.updateNode && mode !== "edit") {
      try {
        nodeCanvasRef.current.updateNode(placeholderId, {
          data: { image: imageUrl, status: "done", prompt: promptText, model: modelName },
        });
        const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === placeholderId) ?? null;
        if (updated) setSelectedNode(updated);
        return;
      } catch (err) {
        console.error("updateNode(placeholder) failed, falling back to addImageNode", err);
      }
    }

    // Otherwise add a new node (immediate or queued)
    addNodeToCanvas({ image: imageUrl, prompt: promptText, model: modelName });
  }

  function addEmptyNode({ position = null, width = 260, height = 180 } = {}) {
    addNodeToCanvas({ image: null, prompt: "", model: "", position, width, height });
  }

  // keyboard delete/backspace handler — don't run while typing
  useEffect(() => {
    const isTypingInEditable = (ev) => {
      const el = document.activeElement ?? ev?.target;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (el.isContentEditable) return true;
      return false;
    };

    function onKeyDown(e) {
      if (e.isComposing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isTypingInEditable(e)) return; // don't intercept while typing
        if (!selectedNode?.id) return;

        try {
          if (nodeCanvasRef.current?.removeNode) {
            // Call the canvas remove API (local)
            nodeCanvasRef.current.removeNode(selectedNode.id);
            // inform server about removal
            handleNodeRemove?.(selectedNode.id);
          } else {
            console.warn("NodeCanvas.removeNode not available");
          }
        } catch (err) {
          console.error("Failed to remove node", err);
        }
        // remove from dedupe set
        if (selectedNode?.id) addedNodeIdsRef.current.delete(selectedNode.id);
        setSelectedNode(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNode]); // handleNodeRemove is defined below

  // ===== File handlers =====
  const handleFilesAdded = (pickedFiles) => {
    const items = pickedFiles.map((file, i) => {
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
      const previewUrl = URL.createObjectURL(file);
      return { id, file, previewUrl, name: file.name, size: file.size, status: "ready" };
    });
    setFiles((prev) => [...prev, ...items]);
  };

  const removeFile = (id) => {
    setFiles((prev) => {
      const toRemove = prev.find((p) => p.id === id);
      if (toRemove) {
        try {
          URL.revokeObjectURL(toRemove.previewUrl);
        } catch (e) {}
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  // ===== Prediction API helpers =====
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function isValidId(id) {
    return typeof id === "string" && id.trim().length > 0 && id !== "undefined" && id !== "null";
  }

  async function createPrediction(promptText, options = {}) {
    const absoluteRefs = referenceUrls.map((u) =>
      u && typeof window !== "undefined" && u.startsWith("/") ? `${window.location.origin}${u}` : u
    );

    const payload = { prompt: promptText, references: absoluteRefs, options };

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(`Non-JSON response: ${res.status} — ${text.slice(0, 200)}`);
    }

    const data = await res.json();

    if (!res.ok) {
      const upstreamMsg = data?.error?.message || data?.error || JSON.stringify(data);
      throw new Error(`Create failed: ${upstreamMsg}`);
    }

    const id = data?.id || data?.prediction?.id || data?.predictionId || (data?.prediction && data.prediction.id) || null;

    if (isValidId(id)) return { id, raw: data };

    if (data && (data.status === "succeeded" || data.status === "processing" || data.status === "starting" || data.status === "failed")) {
      return { id: null, rawPrediction: data };
    }

    throw new Error(`Create endpoint did not return an id. Response: ${JSON.stringify(data).slice(0, 400)}`);
  }

  async function fetchPrediction(id) {
    if (!id || typeof id !== "string" || id.trim() === "") throw new Error(`fetchPrediction called with invalid id: ${String(id)}`);

    const url = `/api/predictions/${encodeURIComponent(id)}`;
    const res = await fetch(url);
    const contentType = res.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(`Polling non-JSON response (status ${res.status}): ${text.slice(0, 400)}`);
    }

    const data = await res.json();

    if (!res.ok) {
      const upstreamMsg = data?.error || data?.upstream || data?.raw || JSON.stringify(data);
      throw new Error(`Polling failed: ${upstreamMsg}`);
    }

    if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
      throw new Error("Polling returned empty object — check server logs and upstream response.");
    }

    return data;
  }

  // ===== Polling loop (keeps pred up to date) =====
  function startPolling(id) {
    if (!id) return;
    // If we've already processed this prediction id, don't start another poll
    const procKeyCheck = `pred:${id}`;
    if (processedPredictionsRef.current.has(procKeyCheck)) {
      console.debug("startPolling: prediction already processed", id);
      return;
    }

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    let sawAnyOutput = false;

    pollRef.current = setInterval(async () => {
      try {
        const pred = await fetchPrediction(id);
        setPrediction(pred);

        const out = pred.output || pred.result || pred.images;
        if (out) {
          const arr = typeof out === "string" ? [out] : Array.isArray(out) ? out.flat() : [];
          if (arr.length) {
            setImages(arr);
            sawAnyOutput = true;

            // If we have partial output and a locked target, update the target with processing preview
            const targetIdForPreview = currentTargetRef.current ?? (mode !== "edit" ? selectedNode?.id : null);
            if (targetIdForPreview && nodeCanvasRef.current?.updateNode) {
              try {
                safeUpdateNode(targetIdForPreview, {
                  data: { image: arr[arr.length - 1], status: pred.status === "succeeded" ? "done" : "processing", prompt: latestGenerationPromptRef.current || "" },
                });
                const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === targetIdForPreview) ?? null;
                if (updated && selectedNode?.id === updated.id) setSelectedNode(updated);
              } catch (e) {
                // ignore preview update errors
              }
            }
          }
        }

        if (sawAnyOutput && mode !== "preview" && mode !== "edit" && !generating) {
          setMode("preview");
        }

        if (pred.status === "succeeded") {
          const procKey = `pred:${id}`;
          if (processedPredictionsRef.current.has(procKey)) {
            // already handled by some other path — just cleanup and return
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            currentTargetRef.current = null;
            setGenerating(false);
            setMode("edit");
            return;
          }

          // Build finalization args & use finalizeOnce to dedupe across code paths
          try {
            const outFinal = pred.output || pred.result || pred.images;
            if (outFinal) {
              const arr = typeof outFinal === "string" ? [outFinal] : Array.isArray(outFinal) ? outFinal.flat() : [];
              setImages(arr);

              const last = arr[arr.length - 1];
              if (last) {
                const externalUrl = last;
                const projectId = currentProjectId ?? null;
                const positionForNewNode = selectedNode
                  ? { x: (selectedNode.x ?? 0) + (selectedNode.width ?? 260) + 80, y: (selectedNode.y ?? 0) }
                  : { x: 120, y: 120 };

                if (projectId) {
                  const procKeyForFinalize = `pred:${id}`;
                  try {
                    const res = await finalizeOnce(procKeyForFinalize, {
                      externalUrl,
                      projectId,
                      position: positionForNewNode,
                      prompt: latestGenerationPromptRef.current || "",
                      model: panelValues.model?.selected,
                      sourceNodeId: mode === "edit" ? selectedNode?.id : null,
                      nodeCanvasRef,
                    });

                    // res might be { alreadyProcessed: true } or server result
                    const signedUrl = res?.signedUrl ?? externalUrl;
                    if (res?.node) {
                      const nodeRow = res.node;
                      const canonical = res.storagePath ?? nodeRow?.data?.image ?? null;
                      if (canonical) {
                        const normalized = normalizeStoragePath(canonical);
                        nodeStoragePathRef.current.set(nodeRow.id, normalized);
                      }
                    
                      addNodeToCanvas({
                        id: nodeRow.id,
                        image: res.signedUrl ?? (canonical ? /* construct signed url later by hydration */ null : null),
                        prompt: nodeRow.data?.prompt ?? "",
                        model: nodeRow.data?.model ?? "",
                        position: { x: nodeRow.x ?? 120, y: nodeRow.y ?? 120 },
                        width: nodeRow.width ?? 260,
                        height: nodeRow.height ?? 180,
                      });

                      if (res?.edge) {
                        const edge = res.edge;
                        const src = edge.source_node ?? edge.sourceId ?? edge.source;
                        const tgt = edge.target_node ?? edge.targetId ?? edge.target;
                        nodeCanvasRef.current?.addEdge?.({ sourceId: src, targetId: tgt });
                      }
                    } else if (res?.alreadyProcessed) {
                      // already handled elsewhere — no-op
                    } else {
                      // fallback local add if server didn't return node
                      enqueueOrAddImageNode({ imageUrl: signedUrl, promptText: latestGenerationPromptRef.current || "", modelName: panelValues.model?.selected });
                    }

                    latestGenerationPromptRef.current = "";
                  } catch (err) {
                    // finalizeOnce will rollback its optimistic mark on error
                    console.warn("Server finalize failed in poller, falling back to local add:", err);
                    if (mode === "edit" && selectedNode?.id && nodeCanvasRef.current?.addImageNode) {
                      const newId = nodeCanvasRef.current.addImageNode({
                        image: externalUrl,
                        prompt: latestGenerationPromptRef.current || "",
                        model: panelValues.model?.selected,
                        position: positionForNewNode,
                      });
                      if (newId && nodeCanvasRef.current?.addEdge && mode === "edit" && selectedNode?.id) {
                        nodeCanvasRef.current.addEdge({ sourceId: selectedNode.id, targetId: newId });
                      }
                    } else {
                      enqueueOrAddImageNode({ imageUrl: externalUrl, promptText: latestGenerationPromptRef.current || "", modelName: panelValues.model?.selected });
                    }
                    latestGenerationPromptRef.current = "";
                  }
                } else {
                  enqueueOrAddImageNode({ imageUrl: externalUrl, promptText: latestGenerationPromptRef.current || "", modelName: panelValues.model?.selected });
                  latestGenerationPromptRef.current = "";
                }
              }
            }

            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            currentTargetRef.current = null;
            setGenerating(false);
            setMode("edit");
          } catch (err) {
            // in case of unexpected errors, ensure state is consistent
            console.error("Error during poll finalize flow", err);
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            currentTargetRef.current = null;
            setGenerating(false);
            setMode("create");
          }
        } else if (pred.status === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          currentTargetRef.current = null;
          setGenerating(false);
          setMode("create");
          setError(pred.error || "Generation failed");
        }
      } catch (err) {
        console.error("Polling error", err);
        setError(err.message || String(err));
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        currentTargetRef.current = null;
        setGenerating(false);
        setMode("create");
      }
    }, 1200);
  }

  // ===== Generate flow (UI entry point) =====
  async function handleGenerate(e) {
    e?.preventDefault();
    setError(null);
    setImages([]);
    setPrediction(null);

    // capture the prompt text immediately so we can clear the textarea for UX
    const currentPrompt = prompt ?? "";
    latestGenerationPromptRef.current = currentPrompt; // used by poller and finalization
    setPrompt(""); // clear the prompt box for the user

    setGenerating(true);

    // Decide target node: prefer selected node if not in 'edit' mode
    let targetNodeId = null;
    if (mode !== "edit" && selectedNode?.id) {
      targetNodeId = selectedNode.id;
    } else if (mode !== "edit") {
      targetNodeId = findPlaceholderNodeId();
    }

    if (targetNodeId && nodeCanvasRef.current?.updateNode) {
      try {
        currentTargetRef.current = targetNodeId;
        safeUpdateNode(targetNodeId, { data: { status: "generating", prompt: currentPrompt, model: panelValues.model?.selected } });
        const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === targetNodeId) ?? null;
        if (updated) setSelectedNode(updated);
      } catch (e) {
        console.error("Could not mark target node as generating", e);
      }
    } else {
      currentTargetRef.current = null;
    }

    setMode("generating");

    try {
      const create = await createPrediction(currentPrompt, options);

      if (create.rawPrediction) {
        const raw = create.rawPrediction;
        setPrediction(raw);
        const out = raw.output || raw.result || raw.images;
        if (out) {
          const arr = typeof out === "string" ? [out] : Array.isArray(out) ? out.flat() : [];
          setImages(arr);
          const last = arr[arr.length - 1];
          if (last) {
            // Use the external URL as the key — stable for this generation
            const externalUrl = last;
            const procKey = `ext:${externalUrl}`;
            if (processedPredictionsRef.current.has(procKey)) {
              // already handled by another path — no-op
            } else if (currentProjectId) {
              try {
                const res = await finalizeOnce(procKey, {
                  externalUrl,
                  projectId: currentProjectId,
                  position: (mode === "edit" && selectedNode) ? { x: (selectedNode.x ?? 0) + (selectedNode.width ?? 260) + 80, y: (selectedNode.y ?? 0) } : null,
                  prompt: currentPrompt,
                  model: panelValues.model?.selected,
                  sourceNodeId: mode === "edit" ? selectedNode?.id : null,
                  nodeCanvasRef,
                });

                if (res?.node) {
                  const nodeRow = res.node;
                  const canonical = res.storagePath ?? nodeRow?.data?.image ?? null;
                  if (canonical) {
                    const normalized = normalizeStoragePath(canonical);
                    nodeStoragePathRef.current.set(nodeRow.id, normalized);
                  }
                  addNodeToCanvas({
                    id: nodeRow.id,
                    image: res.signedUrl ?? (canonical ? /* construct signed url later by hydration */ null : null),
                    prompt: nodeRow.data?.prompt ?? "",
                    model: nodeRow.data?.model ?? "",
                    position: { x: nodeRow.x ?? 120, y: nodeRow.y ?? 120 },
                    width: nodeRow.width ?? 260,
                    height: nodeRow.height ?? 180,
                  });
                  if (res?.edge) {
                    const edge = res.edge;
                    const src = edge.source_node ?? edge.sourceId ?? edge.source;
                    const tgt = edge.target_node ?? edge.targetId ?? edge.target;
                    nodeCanvasRef.current?.addEdge?.({ sourceId: src, targetId: tgt });
                  }
                } else if (res?.alreadyProcessed) {
                  // already processed — no-op
                } else {
                  enqueueOrAddImageNode({ imageUrl: externalUrl, promptText: currentPrompt, modelName: panelValues.model?.selected });
                }
              } catch (err) {
                // rollback optimistic mark handled inside finalizeOnce on error
                console.warn("Finalize failed (rawPrediction path)", err);
                enqueueOrAddImageNode({ imageUrl: externalUrl, promptText: currentPrompt, modelName: panelValues.model?.selected });
              }
            } else {
              enqueueOrAddImageNode({ imageUrl: last, promptText: currentPrompt, modelName: panelValues.model?.selected });
            }
          }
        }

        setGenerating(false);
        setMode("edit");
        currentTargetRef.current = null;
        latestGenerationPromptRef.current = "";
        return;
      }

      const id = create.id;
      if (!isValidId(id)) throw new Error("No valid prediction id returned from create endpoint.");
      setPredictionId(id);

      // immediate fetch once
      const first = await fetchPrediction(id);
      setPrediction(first);
      const out = first.output || first.result || first.images;
      if (out) {
        const arr = typeof out === "string" ? [out] : Array.isArray(out) ? out.flat() : [];
        setImages(arr);

        if (first.status === "succeeded") {
          const procKey = `pred:${id}`;
          if (!processedPredictionsRef.current.has(procKey)) {
            const last = arr[arr.length - 1];
            if (last) {
              if (currentProjectId) {
                try {
                  const res = await finalizeOnce(procKey, {
                    externalUrl: last,
                    projectId: currentProjectId,
                    position: (mode === "edit" && selectedNode) ? { x: (selectedNode.x ?? 0) + (selectedNode.width ?? 260) + 80, y: (selectedNode.y ?? 0) } : null,
                    prompt: currentPrompt,
                    model: panelValues.model?.selected,
                    sourceNodeId: mode === "edit" ? selectedNode?.id : null,
                    nodeCanvasRef,
                  });

                  if (res?.node) {
                    addNodeToCanvas({
                      id: res.node.id,
                      image: res.signedUrl ?? last,
                      prompt: res.node.data?.prompt ?? currentPrompt,
                      model: res.node.data?.model ?? panelValues.model?.selected,
                      position: { x: res.node.x ?? 120, y: res.node.y ?? 120 },
                      width: res.node.width ?? 260,
                      height: res.node.height ?? 180,
                    });
                    if (res?.edge) {
                      const edge = res.edge;
                      const src = edge.source_node ?? edge.sourceId ?? edge.source;
                      const tgt = edge.target_node ?? edge.targetId ?? edge.target;
                      nodeCanvasRef.current?.addEdge?.({ sourceId: src, targetId: tgt });
                    }
                  } else if (res?.alreadyProcessed) {
                    // already processed — no-op
                  } else {
                    enqueueOrAddImageNode({ imageUrl: last, promptText: currentPrompt, modelName: panelValues.model?.selected });
                  }
                } catch (err) {
                  console.warn("Finalize failed (immediate success)", err);
                  enqueueOrAddImageNode({ imageUrl: last, promptText: currentPrompt, modelName: panelValues.model?.selected });
                }
              } else {
                enqueueOrAddImageNode({ imageUrl: last, promptText: currentPrompt, modelName: panelValues.model?.selected });
              }
            }
          }
          // proceed to cleanup
          setGenerating(false);
          setMode("edit");
          currentTargetRef.current = null;
          latestGenerationPromptRef.current = "";
          return;
        }

        // partial preview
        if (arr.length && first.status !== "succeeded") {
          setMode("preview");
          const previewTarget = currentTargetRef.current ?? (mode !== "edit" ? selectedNode?.id : null);
          if (previewTarget && nodeCanvasRef.current?.updateNode) {
            try {
              nodeCanvasRef.current.updateNode(previewTarget, {
                data: { image: arr[arr.length - 1], status: "processing", prompt: latestGenerationPromptRef.current || "" },
              });
              const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === previewTarget) ?? null;
              if (updated) setSelectedNode(updated);
            } catch (e) {}
          }
        }
      } else {
        setMode("generating");
      }

      startPolling(id);
    } catch (err) {
      console.error("handleGenerate error:", err);
      setError(err.message || String(err));
      setGenerating(false);
      setMode("create");
      currentTargetRef.current = null;
      latestGenerationPromptRef.current = "";
    }
  }

  // Keep page mode in sync with the selected node (but don't override while generating)
  useEffect(() => {
    if (generating) return;
    if (!selectedNode) {
      setMode("create");
      return;
    }
    const hasImage = Boolean(selectedNode?.data?.image);
    setMode(hasImage ? "edit" : "create");
  }, [selectedNode, generating]);

  // Helper used by other flows (legacy, or manual)
  async function handleImageReady(url) {
    if (!url) return;
    setImages((prev) => [...prev, url]);

    const payload = { image: url, prompt, model: panelValues.model?.selected };

    if (mode !== "edit" && selectedNode?.id && nodeCanvasRef.current?.updateNode) {
      try {
        nodeCanvasRef.current.updateNode(selectedNode.id, { data: { image: url, status: "done", prompt, model: panelValues.model?.selected } });
        const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === selectedNode.id) ?? null;
        if (updated) setSelectedNode(updated);
        return;
      } catch (e) {
        console.error("handleImageReady: updateNode failed", e);
      }
    }

    const placeholderId = findPlaceholderNodeId();
    if (placeholderId && nodeCanvasRef.current?.updateNode && mode !== "edit") {
      try {
        nodeCanvasRef.current.updateNode(placeholderId, { data: { image: url, status: "done", prompt, model: panelValues.model?.selected } });
        const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === placeholderId) ?? null;
        if (updated) setSelectedNode(updated);
        return;
      } catch (e) {
        console.error("handleImageReady: placeholder update failed", e);
      }
    }

    enqueueOrAddImageNode(payload);
  }

  const currentMode = mode ?? "";
  const selectedRatio = panelValues.ratio?.selected ?? "9:16";
  const displaySrc = selectedNode?.data?.image ?? null;

  // IMPORTANT: NodeCanvas may call onNodeSelect synchronously during its imperative APIs.
  // To avoid "Cannot update a component while rendering a different component" we defer setSelectedNode.
  const handleNodeSelect = useCallback((node) => {
    // defer to next tick — safe and avoids setState during child render
    setTimeout(() => setSelectedNode(node), 0);
  }, []);

  const handleNodeChange = useCallback(async (node) => {
    // Ignore programmatic updates that we suppressed
    if (suppressNodeChangeRef.current) return;
  
    if (!currentProjectId || !node?.id) return;
    // only persist server ids (uuid). you already have an isUuid helper; keep that logic.
    if (!isUuid(node.id)) return;
  
    try {
      // copy data so we can sanitize
      const dataToPersist = { ...(node.data || {}) };
  
      // If we have canonical path recorded for this node, enforce it
      const canonical = nodeStoragePathRef.current.get(node.id);
      if (canonical) {
        dataToPersist.image = canonical;
      } else {
        // If image is an absolute URL or signed URL, *do not persist it*
        if (typeof dataToPersist.image === "string") {
          if (looksLikeAbsoluteUrl(dataToPersist.image) || looksLikeSignedUrl(dataToPersist.image)) {
            delete dataToPersist.image;
          } else if (canonicalStorageRegex.test(dataToPersist.image)) {
            // normalize to remove leading slash
            dataToPersist.image = normalizeStoragePath(dataToPersist.image);
          } else {
            // unknown format -> be conservative and do not persist
            delete dataToPersist.image;
          }
        }
      }
  
      await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/nodes/${encodeURIComponent(node.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x: Math.round(node.x),
          y: Math.round(node.y),
          width: node.width,
          height: node.height,
          data: dataToPersist,
        }),
      });
    } catch (err) {
      console.warn("Failed to persist node change", err);
    }
  }, [currentProjectId]);

  const handleEdgeCreate = useCallback(async (edge) => {
    // Basic guard
    if (!currentProjectId || !edge) return;

    const { sourceId, targetId } = edge;
    if (!sourceId || !targetId) return;

    // If either id is not a server uuid yet, skip creating on server.
    // NodeCanvas should emit again later once nodes have server ids.
    if (!isUuid(sourceId) || !isUuid(targetId)) {
      console.debug("Skipping server edge create until both node IDs are server UUIDs", edge);
      return;
    }

    const key = edgeKey(sourceId, targetId);

    // If we've already created this edge on this client, skip.
    if (createdEdgesRef.current.has(key)) {
      console.debug("Edge already created (client cache) — skipping:", key);
      return;
    }

    // If an in-flight request is already creating this edge, skip to avoid duplicate posts.
    if (creatingEdgesRef.current.has(key)) {
      console.debug("Edge creation already in-flight — skipping duplicate:", key);
      return;
    }

    // Quick check against NodeCanvas existing edges to avoid posting duplicates
    try {
      const existingEdges = new Set((nodeCanvasRef.current?.getEdges?.() || []).map(e => `${e.sourceId}__${e.targetId}`));
      if (existingEdges.has(key)) {
        // Mark as created so we don't attempt to post later
        createdEdgesRef.current.add(key);
        console.debug("Edge already present in canvas, marking created and skipping server create:", key);
        return;
      }
    } catch (err) {
      // ignore if getEdges isn't available
    }

    creatingEdgesRef.current.add(key);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceNode: sourceId, targetNode: targetId }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.warn("Failed to persist edge", res.status, txt);
        // don't add to createdEdgesRef so we can retry later (or let user try again)
        return;
      }

      const json = await res.json().catch(() => ({}));
      // server returned created edge — mark as created and ensure canvas has it
      createdEdgesRef.current.add(key);

      // Optionally, add the server edge data to canvas if needed (avoid duplicates)
      try {
        const canvasEdges = nodeCanvasRef.current?.getEdges?.() || [];
        const already = canvasEdges.some(e => (e.sourceId === sourceId && e.targetId === targetId));
        if (!already && nodeCanvasRef.current?.addEdge) {
          nodeCanvasRef.current.addEdge({ sourceId, targetId });
        }
      } catch (err) {
        console.warn("Failed to add edge to local canvas after server create", err);
      }
    } catch (err) {
      console.warn("Failed to persist edge", err);
    } finally {
      creatingEdgesRef.current.delete(key);
    }
  }, [currentProjectId]);

  // server-side delete + remove from canvas on success
  const handleNodeRemove = useCallback(async (nodeId) => {
    if (!currentProjectId || !nodeId) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE" });
      if (!res.ok) {
        console.warn("Failed to delete node on server", await res.text());
        return;
      }
      addedNodeIdsRef.current.delete(nodeId);
      // remove from canvas after server confirms
      try {
        nodeCanvasRef.current?.removeNode?.(nodeId);
      } catch (e) {
        // fallback: clear state in page if needed
        console.warn("removeNode on canvas failed", e);
      }
    } catch (err) {
      console.warn("Failed to delete node on server", err);
    }
  }, [currentProjectId]);

  // make the above handleNodeRemove available to the module scope (used by keydown handler)
  // (note: we also used a local reference earlier in a useEffect, so bind it)
  // (React hook rules: handleNodeRemove is a stable useCallback)

  // Apply aspect-ratio changes to the selected node when user changes the ratio panel.
  useEffect(() => {
    const ratio = panelValues.ratio?.selected;
    if (!ratio) return;
    if (!selectedNode?.id) return;
    // parse ratio 'W:H'
    const parts = ratio.split(":").map((p) => Number(p));
    if (parts.length !== 2 || parts.some(isNaN)) return;
    const [wR, hR] = parts;
    if (wR <= 0 || hR <= 0) return;

    // base width (prefer existing width)
    const baseWidth = Math.max(80, selectedNode.width || 260);
    const newWidth = Math.round(Math.max(80, baseWidth));
    const newHeight = Math.round(Math.max(80, (baseWidth * (hR / wR))));

    // update node visually and persist
    try {
      nodeCanvasRef.current?.updateNode?.(selectedNode.id, { width: newWidth, height: newHeight });
      // fetch updated node and persist
      const updated = nodeCanvasRef.current?.getNodes?.()?.find((n) => n.id === selectedNode.id) ?? null;
      if (updated) {
        // update backend
        handleNodeChange(updated);
        // update selected state
        setSelectedNode(updated);
      }
    } catch (err) {
      console.warn("Failed to update node size for ratio change", err);
    }
  }, [panelValues.ratio?.selected, selectedNode?.id, handleNodeChange]);

  // Render
  return (
    <ProtectedRoute>
      <div className="page-root bg-bg grid grid-rows-12 grid-cols-12 h-screen">
        <section className="row-span-12 col-span-5 row-start-1 col-start-1 grid grid-cols-5 grid-rows-12 gap-2 p-2">
          <div className="canvas col-span-5 row-span-8 bg-[#181818] rounded-md overflow-hidden">
            <div className="w-full h-full">
              <div className="w-full h-full p-2 flex items-center justify-center relative">
                <div className="flex items-center gap-2 z-50 absolute top-1 right-1">
                  <button
                    type="button"
                    onClick={() => addEmptyNode()}
                    className="button-icon px-2 text-medium"
                    aria-label="Add node to canvas"
                    title="Add empty node"
                  >
                    new node
                  </button>
                </div>

                <NodeCanvas
                  ref={nodeCanvasRef}
                  onNodeSelect={handleNodeSelect}
                  onNodeChange={handleNodeChange}
                  onEdgeCreate={handleEdgeCreate}
                  onNodeRemove={handleNodeRemove}
                />
              </div>
            </div>
          </div>

          <section className="col-span-5 row-span-4 bg-main rounded-md p-2 flex flex-col justify-end relative">
            <div>{mode === "create" && <Tools onFilesAdded={handleFilesAdded} />}</div>

            {mode === "create" && (
              <OptionsButton panelDefinitions={panelDefinitions} panelValues={panelValues} setPanelValue={setPanelValue} />
            )}

            <form onSubmit={handleGenerate}>
              <div className="flex flex-col gap-3">
                <div className="w-full grid grid-cols-4 gap-x-2" />

                <div className="rounded-md w-full bg-bg-light p-1.5 drop-shadow-md border-[0.5px] border-border-main h-40 flex flex-col">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={2}
                    className="w-full textarea-default border-none text-medium h-2/3"
                    style={{
                      minHeight: 105,
                      boxSizing: "border-box",
                      outline: "none",
                      whiteSpace: "pre-wrap",
                      wordWrap: "break-word",
                      color: "var(--text-light, #e5e7eb)",
                      borderRadius: 8,
                      background: "transparent",
                    }}
                    placeholder={`Type "/" to open references & models`}
                  />

                  <div
                    className="h-5 w-full"
                    style={{
                      WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 80%, transparent 100%)",
                      maskImage: "linear-gradient(to bottom, black 0%, black 80%, transparent 100%)",
                    }}
                  />

                  <div className="relative h-1/3 w-full flex justify-end">
                    <button
                      type="submit"
                      className="rounded-xs bg-button-create max-h-[34px] px-2.5 py-2 text-black text-medium leading-4 font-medium hover:cursor-pointer disabled:cursor-not-allowed"
                      disabled={generating}
                    >
                      {generating ? "Generating..." : mode === "edit" ? "Edit" : "Create"}
                    </button>
                  </div>
                </div>
              </div>

              {error && <div className="error">{error}</div>}
            </form>
          </section>
        </section>

        <section className="col-span-7 row-span-12 border-l border-border-main flex items-center justify-center relative">
          <div className="absolute bottom-1 left-2 text-small text-text-white-secondary">
            <span>
              {currentMode + ": "}
              {panelValues.model?.selected + "/ "}
              {panelValues.ratio?.selected + "/ "}
              {panelValues.quality?.level + "/"}
              {panelValues.output.selected}
            </span>
          </div>

          {mode === "edit" && (
            <div>
              <div className="flex flex-row gap-1 absolute left-2 top-2">
                <DownloadButton src={displaySrc} filename={`generated-${Date.now()}.png`} className="button-icon z-10" />
                <ExpandButton src={displaySrc} alt="image" className="button-icon" />
              </div>
              <div className="absolute right-0 z-50 top-0 h-full">
                <EditSideBar selectedNode={selectedNode} />
              </div>
            </div>
          )}

          <ImageContainer aspect={selectedRatio} src={displaySrc} alt="Generated image" />
        </section>
      </div>
    </ProtectedRoute>
  );
}
