// app/page.js (app router) — production-ready rewrite using hooks
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import Image from "next/image";

import Tools from "./components/Tools";
import DownloadButton from "./components/DownloadButton";
import ExpandButton from "./components/ExpandButton";
import OptionsButton from "./components/OptionsButton";
import NodeCanvas from "./components/node/NodeCanvas";
import ImageContainer from "./components/ImageContainer";
import EditSideBar from "./components/edit/EditSideBar";
import ProtectedRoute from "../components/ProtectedRoute";

import { finalizeGeneratedImage } from "@/lib/finalize";

// hooks + api wrappers (assumed added under lib/)
import { useProjectHydration } from "@/lib/hooks/useProjectHydration";
import { usePollingPrediction } from "@/lib/hooks/usePollingPrediction";
import { useNodeCanvasQueue } from "@/lib/hooks/useNodeCanvasQueue";
import useClickOutside from "@/lib/hooks/useClickOutside";

import { fetchPredictionApi, createPredictionApi } from "@/lib/api/predictions";
import { createProjectNode as createProjectNodeApi } from "@/lib/api/projects";
import { getSignedUrls as getSignedUrlsApi } from "@/lib/api/signedUrls";

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
  const [showNewNodePanel, setShowNewNodePanel] = useState(false);

  // Node + canvas refs + selections
  const pollRef = useRef(null); // retained for small cases but polling is via hook
  const nodeChangeTimersRef = useRef(new Map());
  const creatingEdgesRef = useRef(new Set());
  const createdEdgesRef = useRef(new Set());
  const suppressNodeChangeRef = useRef(false);
  const nodeStoragePathRef = useRef(new Map()); // nodeId -> canonical storage path
  const nodeCanvasRef = useRef(null);
  const addedNodeIdsRef = useRef(new Set());
  const currentTargetRef = useRef(null);

  const looksLikeAbsoluteUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
  const looksLikeSignedUrl = (s) => typeof s === "string" && s.includes("/storage/v1/object/sign/");
  const canonicalStorageRegex = /^(?:\/)?projects\/[0-9a-fA-F-]{36}\/images\/.+$/i;
  const normalizeStoragePath = (p) => (typeof p === "string" ? (p.startsWith("/") ? p.slice(1) : p) : p);

  const newNodePanelRef = useRef(null);
  useClickOutside(newNodePanelRef, () => {
    if (showNewNodePanel) setShowNewNodePanel(false);
  }, { enabled: showNewNodePanel });

  const [files, setFiles] = useState([]);
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => {
        try { URL.revokeObjectURL(f.previewUrl); } catch (e) {}
      });
    };
  }, []);

  const searchParams = useSearchParams();
  const [currentProjectId, setCurrentProjectId] = useState(null);

  const [mode, setMode] = useState("create"); // 'create'|'generating'|'preview'|'edit'
  const [pendingLocalQueue, setPendingLocalQueue] = useState([]); // kept for compatibility if needed

  const [selectedNode, setSelectedNode] = useState(null);
  const latestImage = images.length ? images[images.length - 1] : null;
  const isUuid = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  // Clear per-project caches when project changes
  useEffect(() => {
    creatingEdgesRef.current.clear();
    createdEdgesRef.current.clear();
  }, [currentProjectId]);

  // panel definitions (unchanged)
  const panelDefinitions = {
    ratio: { label: "Aspect Ratio", defaults: { selected: "9:16" }, options: ["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"], valueKey: "selected" },
    quality: { label: "Quality", defaults: { level: "high" }, options: ["low","medium","high"] },
    model: { label: "Model", defaults: { selected: "nano-banana-pro" }, options: ["nano-banana-pro","nano-banana","seedream 4.0"] },
    output: { label: "Output", defaults: { selected: "png" }, options: ["png","jpg","jpeg"] },
  };

  const [panelValues, setPanelValues] = useState(() => {
    const init = {};
    for (const id in panelDefinitions) init[id] = { ...(panelDefinitions[id].defaults || {}) };
    return init;
  });
  const setPanelValue = (panelId, key, value) => setPanelValues((prev) => ({ ...prev, [panelId]: { ...(prev[panelId] || {}), [key]: value } }));
  const options = { aspect_ratio: panelValues.ratio?.selected ?? "9:16", quality: panelValues.quality?.level ?? "medium", output_format: panelValues.output?.selected ?? "png" };

  const edgeKey = (src, tgt) => `${src}__${tgt}`;

  // safe node update (suppress nodeChange persistence while programmatic)
  function safeUpdateNode(nodeId, patch) {
    try {
      suppressNodeChangeRef.current = true;
      nodeCanvasRef.current?.updateNode?.(nodeId, patch);
    } catch (e) {
      console.warn("safeUpdateNode failed", e);
    } finally {
      setTimeout(() => { suppressNodeChangeRef.current = false; }, 0);
    }
  }

  // finalizeOnce (dedupe finalization across code paths)
  const finalizeLocksRef = useRef(new Map());
  async function finalizeOnce(key, finalizeArgs) {
    if (!key) throw new Error("finalizeOnce requires a key");
    if (processedPredictionsRef.current.has(key)) return { alreadyProcessed: true };
    if (finalizeLocksRef.current.has(key)) {
      try { return await finalizeLocksRef.current.get(key); } catch (err) { finalizeLocksRef.current.delete(key); throw err; }
    }

    const p = (async () => {
      processedPredictionsRef.current.add(key);
      try {
        const res = await finalizeGeneratedImage(finalizeArgs);
        return res;
      } catch (err) {
        processedPredictionsRef.current.delete(key);
        throw err;
      } finally {
        finalizeLocksRef.current.delete(key);
      }
    })();

    finalizeLocksRef.current.set(key, p);
    return await p;
  }

  // read projectId query param (once)
  useEffect(() => {
    const pid = searchParams?.get("projectId");
    if (pid) setCurrentProjectId(pid);
  }, [searchParams]);

  // --------------------
  // Hooks wiring
  // --------------------

  // 1) Node queue hook (server-first add logic + pending queue)
  const { pendingQueue, enqueue, addNodeToCanvas: addNodeViaQueue, flushPending } = useNodeCanvasQueue({
    nodeCanvasRef,
    currentProjectId,
    createProjectNode: createProjectNodeApi,
    addedNodeIdsRef,
    normalizeStoragePath,
  });

  // 2) Hydration hook: loads nodes/edges into canvas for currentProjectId
  const { loading: hydrating, error: hydrateError, refresh: refreshHydration } = useProjectHydration({
    projectId: currentProjectId,
    nodeCanvasRef,
    addedNodeIdsRef,
    supabase,
    getSignedUrls: getSignedUrlsApi,
    normalizeStoragePath,
  });

  // 3) Polling hook: polling lifecycle (uses fetchPredictionApi under the hood)
  const pollingOnUpdate = useCallback((pred) => {
    // mirror existing on-update: setPrediction, setImages, and preview update
    setPrediction(pred);
    const out = pred.output || pred.result || pred.images;
    if (out) {
      const arr = typeof out === "string" ? [out] : Array.isArray(out) ? out.flat() : [];
      if (arr.length) {
        setImages(arr);

        const previewTarget = currentTargetRef.current ?? (mode !== "edit" ? selectedNode?.id : null);
        if (previewTarget && nodeCanvasRef.current?.updateNode) {
          try {
            safeUpdateNode(previewTarget, {
              data: { image: arr[arr.length - 1], status: pred.status === "succeeded" ? "done" : "processing", prompt: latestGenerationPromptRef.current || "" },
            });
            const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === previewTarget) ?? null;
            if (updated && selectedNode?.id === updated.id) setSelectedNode(updated);
          } catch (e) {
            // ignore preview update errors
          }
        }
      }
    }

    if (out && mode !== "preview" && mode !== "edit" && !generating) {
      setMode("preview");
    }
  }, [generating, mode, selectedNode]);

  const pollingOnFinished = useCallback(async (pred) => {
    // pred can be either a prediction object (status succeeded|failed) or an error object if polling failed
    if (!pred) return;

    if (pred.status === "failed" || pred.error) {
      setError(pred.error || "Generation failed");
      setGenerating(false);
      setMode("create");
      currentTargetRef.current = null;
      return;
    }

    // status === succeeded
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
      
          // gather sources for whatever target is currently locked (or null)
          let gatheredForFinalize = { sourceNodeIds: [], imageRefs: [], textPrompt: null };
          try {
            const targetForFinalize = currentTargetRef.current ?? (mode !== "edit" ? selectedNode?.id : null);
            gatheredForFinalize = await gatherSourcesForTarget(targetForFinalize);
          } catch (err) {
            console.warn("gatherSourcesForTarget (poller finalize) failed:", err);
          }
      
          if (projectId) {
            const procKeyForFinalize = `pred:${predictionId ?? externalUrl}`;
            try {
              const res = await finalizeOnce(procKeyForFinalize, {
                externalUrl,
                projectId,
                position: positionForNewNode,
                prompt: latestGenerationPromptRef.current || "",
                model: panelValues.model?.selected,
                sourceNodeIds: (gatheredForFinalize.sourceNodeIds && gatheredForFinalize.sourceNodeIds.length) ? gatheredForFinalize.sourceNodeIds : (mode === "edit" && selectedNode?.id ? [selectedNode.id] : []),
                nodeCanvasRef,
              });
      
              const signedUrl = res?.signedUrl ?? externalUrl;
              if (res?.node) {
                const nodeRow = res.node;
                const canonical = res.storagePath ?? nodeRow?.data?.image ?? null;
                if (canonical) {
                  nodeStoragePathRef.current.set(nodeRow.id, normalizeStoragePath(canonical));
                }
      
                await addNodeViaQueue({
                  id: nodeRow.id,
                  image: res.signedUrl ?? null,
                  prompt: nodeRow.data?.prompt ?? "",
                  model: nodeRow.data?.model ?? "",
                  position: { x: nodeRow.x ?? 120, y: nodeRow.y ?? 120 },
                  width: nodeRow.width ?? 260,
                  height: nodeRow.height ?? 180,
                  data: nodeRow.data ?? {},
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
                await addNodeViaQueue({ image: signedUrl, prompt: latestGenerationPromptRef.current || "", model: panelValues.model?.selected });
              }
            } catch (err) {
              console.warn("Server finalize failed in poller, falling back to local add:", err);
              await addNodeViaQueue({ image: externalUrl, prompt: latestGenerationPromptRef.current || "", model: panelValues.model?.selected });
            }
          } else {
            await addNodeViaQueue({
              image: externalUrl,
              prompt: latestGenerationPromptRef.current || "",
              model: panelValues.model?.selected,
              data: { type: "image", image: externalUrl, prompt: latestGenerationPromptRef.current || "", model: panelValues.model?.selected, status: "done" },
            });
          }
        }
      }

      // cleanup and set UI state
      currentTargetRef.current = null;
      setGenerating(false);
      setMode("edit");
      latestGenerationPromptRef.current = "";
    } catch (err) {
      console.error("Error during finalize flow in pollingOnFinished", err);
      setError(String(err));
      currentTargetRef.current = null;
      setGenerating(false);
      setMode("create");
    }
  }, [currentProjectId, panelValues.model, predictionId, selectedNode, addNodeViaQueue, finalizeOnce, normalizeStoragePath, mode]);

  const { start: pollingStart, stop: pollingStop } = usePollingPrediction({
    fetchPrediction: fetchPredictionApi, // library wrapper (abortable)
    onUpdate: pollingOnUpdate,
    onFinished: pollingOnFinished,
    pollInterval: 1200,
  });

  // Mirror legacy stopPolling cleanup on unmount
  useEffect(() => {
    return () => {
      pollingStop();
    };
  }, [pollingStop]);

  // When NodeCanvas becomes ready flush hook's pending queue
  useEffect(() => {
    if (!nodeCanvasRef.current) return;
    // flush pending queue from hook
    (async () => {
      try { await flushPending(); } catch (e) { console.warn("flushPending failed", e); }
    })();
  }, [nodeCanvasRef?.current, flushPending]);

  // ----- File handlers -----
  const handleFilesAdded = (pickedFiles) => {
    const items = pickedFiles.map((file) => {
      const id = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      return { id, file, previewUrl, name: file.name, size: file.size, status: "ready" };
    });
    setFiles((prev) => [...prev, ...items]);
  };
  const removeFile = (id) => {
    setFiles((prev) => {
      const toRemove = prev.find((p) => p.id === id);
      if (toRemove) {
        try { URL.revokeObjectURL(toRemove.previewUrl); } catch (e) {}
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  // ===== Prediction (create) helpers (uses lib/api wrapper) =====
  function isValidId(id) {
    return typeof id === "string" && id.trim().length > 0 && id !== "undefined" && id !== "null";
  }

  async function createPrediction(promptText, optionsArg = {}) {
    // If caller passed explicit references via optionsArg.references use them, otherwise use global referenceUrls state.
    const explicitRefs = Array.isArray(optionsArg?.references) ? optionsArg.references : null;
  
    const absoluteRefs = explicitRefs
      ? explicitRefs.map((u) => (u && typeof window !== "undefined" && u.startsWith("/") ? `${window.location.origin}${u}` : u))
      : referenceUrls.map((u) => (u && typeof window !== "undefined" && u.startsWith("/") ? `${window.location.origin}${u}` : u));
  
    // call centralized API wrapper
    const data = await createPredictionApi({ prompt: promptText, references: absoluteRefs ?? [], options: optionsArg ?? {} });
  
    // normalize response shapes (backwards compatibility)
    const id = data?.id || data?.prediction?.id || data?.predictionId || (data?.prediction && data.prediction.id) || null;
    if (isValidId(id)) return { id, raw: data };
  
    if (data && (data.status === "succeeded" || data.status === "processing" || data.status === "starting" || data.status === "failed")) {
      return { id: null, rawPrediction: data };
    }
  
    throw new Error(`Create endpoint did not return an id. Response: ${JSON.stringify(data).slice(0, 400)}`);
  }

  // fetchPrediction wrapper delegates to lib/api wrapper (supports AbortSignal)
  async function fetchPrediction(id, { signal } = {}) {
    return await fetchPredictionApi(id, { signal });
  }

  // ===== Node helpers & UI-level helpers (kept in-page because they manipulate UI state) =====

  // Gather connected source nodes for a given target node id.
  // Returns { sourceNodeIds: string[], imageRefs: string[], textPrompt: string|null }
async function gatherSourcesForTarget(targetNodeId) {
  if (!targetNodeId) return { sourceNodeIds: [], imageRefs: [], textPrompt: null };

  const edges = nodeCanvasRef.current?.getEdges?.() ?? [];
  const nodes = nodeCanvasRef.current?.getNodes?.() ?? [];

  const incoming = edges.filter(
    (e) => (e.targetId === targetNodeId) || (e.target_node === targetNodeId) || (e.target === targetNodeId)
  );

  const sourceNodeIds = [];
  const storagePathsToSign = new Set();
  const imageRefs = [];
  let textPrompt = null;

  for (const e of incoming) {
    const srcId = e.sourceId ?? e.source_node ?? e.source;
    if (!srcId) continue;
    const srcNode = nodes.find((n) => n.id === srcId);
    if (!srcNode) continue;
    sourceNodeIds.push(srcId);

    const img = srcNode?.data?.image;
    if (img && typeof img === "string") {
      if (looksLikeAbsoluteUrl(img) || looksLikeSignedUrl(img)) {
        imageRefs.push(img);
      } else if (canonicalStorageRegex.test(img) || nodeStoragePathRef.current.has(srcId) || img.startsWith("projects/")) {
        // Prefer canonical mapping from nodeStoragePathRef if present; otherwise treat as storage path to exchange for signed URL.
        const canonical = nodeStoragePathRef.current.get(srcId) ?? img;
        // normalize and collect to sign
        const normalized = normalizeStoragePath(canonical);
        storagePathsToSign.add(normalized);
      } else {
        // unknown format — do not include raw path; skip
        console.warn("Skipping unknown image format when gathering refs for generation", img);
      }
    }

    const txt = srcNode?.data?.text;
    if (txt && !textPrompt) {
      textPrompt = txt;
    }
  }

  // If we have storage paths that need signed URLs, call backend API to get signed URLs.
  if (storagePathsToSign.size > 0) {
    try {
      // getSignedUrlsApi should accept an array and return { signedUrls: { "<path>": "<signedUrl>" } }
      const paths = Array.from(storagePathsToSign);
      const signedMap = await getSignedUrlsApi(paths);
      // signedMap can be { signedUrls: { path: url, ... } } or directly { path: url }
      const signedUrls = signedMap?.signedUrls ?? signedMap ?? {};

      for (const p of paths) {
        const s = signedUrls[p];
        if (s && typeof s === "string") {
          imageRefs.push(s);
        } else {
          console.warn("No signed URL returned for path when gathering refs:", p);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch signed URLs for references — proceeding with any absolute/signed refs only", err);
    }
  }

  // Deduplicate and preserve order (incoming order prioritized)
  const deduped = [];
  const seen = new Set();
  for (const r of imageRefs) {
    if (!r) continue;
    if (!seen.has(r)) {
      deduped.push(r);
      seen.add(r);
    }
  }

  return { sourceNodeIds, imageRefs: deduped, textPrompt };
}

function addTextNodeAtCenter({ text = "" } = {}) {
  const w = 260;
  const h = 120;
  const pos = getCanvasCenterTopLeft(w, h);

  addNodeViaQueue({
    image: null,
    prompt: "",
    model: "",
    position: pos,
    width: w,
    height: h,
    data: { type: "text", text },
  });

  setShowNewNodePanel(false);
}

// compute a sensible top-left position so a node of given size appears centered
// in the user's current NodeCanvas viewport.
function getCanvasCenterTopLeft(width = 260, height = 180) {
  try {
    // If NodeCanvas exposes a view-center helper, use it (preferred).
    // We placed getViewCenterWorld on the NodeCanvas imperative API.
    if (nodeCanvasRef.current?.getViewCenterWorld) {
      const center = nodeCanvasRef.current.getViewCenterWorld();
      if (center && typeof center.x === "number" && typeof center.y === "number") {
        return { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) };
      }
    }

    // Fallback: compute using container bounding rect and current translate/scale (if accessible)
    const rect = nodeCanvasRef.current && nodeCanvasRef.current.containerRef
      ? nodeCanvasRef.current.containerRef.getBoundingClientRect?.()
      : null;

    // We can't reliably read containerRef from parent; fallback to simple center coordinates.
    return { x: 120, y: 120 };
  } catch (e) {
    return { x: 120, y: 120 };
  }
}


  function findPlaceholderNodeId() {
    const nodes = nodeCanvasRef.current?.getNodes?.() ?? null;
    if (!nodes || !Array.isArray(nodes)) return null;
    // only treat nodes as placeholders if:
    //  - they do NOT have an image
    //  - AND they are NOT a text node (data.type !== 'text')
    const placeholder = nodes.find((n) => {
      const hasImage = Boolean(n?.data?.image);
      const type = n?.data?.type;
      if (type === "text") return false;
      return !hasImage;
    });
    return placeholder ? placeholder.id : null;
  }

  function enqueueOrAddImageNode({ imageUrl, promptText = "", modelName = "" }) {
    if (!imageUrl || typeof imageUrl !== "string") {
      console.warn("enqueueOrAddImageNode called with invalid imageUrl:", imageUrl);
      return;
    }
  
    // If selected node exists and is NOT a text node, update it
    if (mode !== "edit" && selectedNode?.id && nodeCanvasRef.current?.updateNode) {
      const selType = selectedNode?.data?.type;
      if (selType !== "text") {
        try {
          nodeCanvasRef.current.updateNode(selectedNode.id, {
            data: {
              ...(selectedNode.data || {}),
              image: imageUrl,
              status: "done",
              prompt: promptText,
              model: modelName,
              type: "image",
            },
          });
          const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === selectedNode.id) ?? null;
          if (updated) setSelectedNode(updated);
          return;
        } catch (err) {
          console.error("updateNode failed, falling back to addImageNode", err);
        }
      }
    }
  
    // Prefer placeholder that is NOT a text node
    const placeholderId = findPlaceholderNodeId();
    if (placeholderId && nodeCanvasRef.current?.updateNode && mode !== "edit") {
      try {
        const existing = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === placeholderId) ?? {};
        nodeCanvasRef.current.updateNode(placeholderId, {
          data: {
            ...(existing.data || {}),
            image: imageUrl,
            status: "done",
            prompt: promptText,
            model: modelName,
            type: "image",
          },
        });
        const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === placeholderId) ?? null;
        if (updated) setSelectedNode(updated);
        return;
      } catch (err) {
        console.error("updateNode(placeholder) failed, falling back to addImageNode", err);
      }
    }
    // fallback: add a new image node in view center; include explicit data so node.type is preserved
    const fallbackPos = getCanvasCenterTopLeft();
    addNodeViaQueue({
      image: imageUrl,
      prompt: promptText,
      model: modelName,
      position: fallbackPos,
      data: { type: "image", image: imageUrl, prompt: promptText, model: modelName, status: "done" },
    });
  }  

  function addEmptyNode({ position = null, width = null, height = null } = {}) {
    // derive width/height from ratio if not provided
    let w = width;
    let h = height;
  
    const ratio = panelValues.ratio?.selected ?? "9:16";
    const parts = ratio.split(":").map((p) => Number(p));
    if ((!w || !h) && parts.length === 2 && !parts.some(isNaN)) {
      const [wR, hR] = parts;
      const baseWidth = Math.max(120, w || 260);
      w = Math.round(baseWidth);
      h = Math.round(Math.max(80, baseWidth * (hR / wR)));
    }
    if (!w) w = 260;
    if (!h) h = 180;
  
    // compute center position if not provided
    let pos = position;
    if (!pos) pos = getCanvasCenterTopLeft(w, h);
  
    // Create a new empty image node (explicit data.type ensures consistent behavior)
    addNodeViaQueue({
      image: null,
      prompt: "",
      model: "",
      position: pos,
      width: w,
      height: h,
      data: { type: "image", status: "empty" },
    });
  }  

  // Flush the hook's pending queue once the canvas is ready or hydration changes.
  // Avoid depending on nodeCanvasRef.current directly (it's a mutable ref).
  useEffect(() => {
    if (!nodeCanvasRef.current) return;
    (async () => {
      try {
        await flushPending();
      } catch (e) {
        console.warn("flushPending failed", e);
      }
    })();
  }, [hydrating, flushPending]); // run when hydration changes or flushPending identity changes

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
            nodeCanvasRef.current.removeNode(selectedNode.id);
            handleNodeRemove?.(selectedNode.id);
          } else {
            console.warn("NodeCanvas.removeNode not available");
          }
        } catch (err) {
          console.error("Failed to remove node", err);
        }
        if (selectedNode?.id) addedNodeIdsRef.current.delete(selectedNode.id);
        setSelectedNode(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNode]);

  // ===== Debounced node persistence (handleNodeChange) kept in-page =====
  const handleNodeChange = useCallback((node) => {
    if (suppressNodeChangeRef.current) return;
    if (!currentProjectId || !node?.id) return;
    if (!isUuid(node.id)) return;

    const existing = nodeChangeTimersRef.current.get(node.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      const dataToPersist = { ...(node.data || {}) };
      const canonical = nodeStoragePathRef.current.get(node.id);
      if (canonical) {
        dataToPersist.image = canonical;
      } else {
        if (typeof dataToPersist.image === "string") {
          if (looksLikeAbsoluteUrl(dataToPersist.image) || looksLikeSignedUrl(dataToPersist.image)) {
            delete dataToPersist.image;
          } else if (canonicalStorageRegex.test(dataToPersist.image)) {
            dataToPersist.image = normalizeStoragePath(dataToPersist.image);
          } else {
            delete dataToPersist.image;
          }
        }
      }

      try {
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
      } finally {
        nodeChangeTimersRef.current.delete(node.id);
      }
    }, 350);

    nodeChangeTimersRef.current.set(node.id, timer);
  }, [currentProjectId]);

  // ---- Edge create ----
  const handleEdgeCreate = useCallback(async (edge) => {
    if (!currentProjectId || !edge) return;
    const { sourceId, targetId } = edge;
    if (!sourceId || !targetId) return;
    if (!isUuid(sourceId) || !isUuid(targetId)) {
      console.debug("Skipping server edge create until both node IDs are server UUIDs", edge);
      return;
    }

    const key = edgeKey(sourceId, targetId);
    if (createdEdgesRef.current.has(key)) return;
    if (creatingEdgesRef.current.has(key)) return;

    try {
      const existingEdges = new Set((nodeCanvasRef.current?.getEdges?.() || []).map(e => `${e.sourceId}__${e.targetId}`));
      if (existingEdges.has(key)) {
        createdEdgesRef.current.add(key);
        return;
      }
    } catch (err) {}

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
        return;
      }
      await res.json().catch(() => ({}));
      createdEdgesRef.current.add(key);

      try {
        const canvasEdges = nodeCanvasRef.current?.getEdges?.() || [];
        const already = canvasEdges.some(e => (e.sourceId === sourceId && e.targetId === targetId));
        if (!already && nodeCanvasRef.current?.addEdge) nodeCanvasRef.current.addEdge({ sourceId, targetId });
      } catch (err) {
        console.warn("Failed to add edge to local canvas after server create", err);
      }
    } catch (err) {
      console.warn("Failed to persist edge", err);
    } finally {
      creatingEdgesRef.current.delete(key);
    }
  }, [currentProjectId]);

  // server-side delete
  const handleNodeRemove = useCallback(async (nodeId) => {
    if (!currentProjectId || !nodeId) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE" });
      if (!res.ok) {
        console.warn("Failed to delete node on server", await res.text());
        return;
      }
      addedNodeIdsRef.current.delete(nodeId);
      try { nodeCanvasRef.current?.removeNode?.(nodeId); } catch (e) { console.warn("removeNode on canvas failed", e); }
    } catch (err) {
      console.warn("Failed to delete node on server", err);
    }
  }, [currentProjectId]);

  // --- ADD / REPLACE: apply aspect-ratio changes when the ratio panel or selection changes ---
// LOCK: do NOT change nodes that already have an image (except to attach missing aspect metadata)
useEffect(() => {
  const ratio = panelValues.ratio?.selected;
  if (!ratio) return;
  if (!selectedNode?.id) return;

  // If node already has an image, do NOT resize it — but ensure data.aspect exists so we know what it was at creation
  const hasImage = Boolean(selectedNode?.data?.image);
  if (hasImage) {
    try {
      const existing = selectedNode?.data ?? {};
      if (!existing.aspect) {
        const parts0 = ratio.split(":").map(Number);
        if (parts0.length === 2 && !parts0.some(isNaN)) {
          // attach aspect into node data and persist (handleNodeChange will persist only for server uuid nodes)
          const updated = { ...selectedNode, data: { ...existing, aspect: ratio } };
          setSelectedNode(updated);
          // call handleNodeChange to persist (it has guards for non-UUID IDs and is debounced)
          try { handleNodeChange?.(updated); } catch (e) { /* ignore synchronous errors */ }
        }
      }
    } catch (e) {
      // noop
    }
    return;
  }

  // Node has no image -> we are allowed to change size to reflect new aspect
  const parts = ratio.split(":").map((p) => Number(p));
  if (parts.length !== 2 || parts.some(isNaN)) return;
  const [wR, hR] = parts;
  if (wR <= 0 || hR <= 0) return;

  // base width (prefer existing width)
  const baseWidth = Math.max(80, selectedNode.width || 260);
  const newWidth = Math.round(Math.max(80, baseWidth));
  const newHeight = Math.round(Math.max(80, (baseWidth * (hR / wR))));

  try {
    // update node size AND attach aspect to node.data so handleNodeChange can persist it
    const newData = { ...(selectedNode.data || {}), aspect: ratio };
    // update canvas visually
    nodeCanvasRef.current?.updateNode?.(selectedNode.id, { width: newWidth, height: newHeight, data: newData });

    // read back the updated node from canvas (if available) and persist via handleNodeChange
    const updated = nodeCanvasRef.current?.getNodes?.()?.find((n) => n.id === selectedNode.id) ?? null;
    if (updated) {
      // ensure data contains aspect
      updated.data = { ...(updated.data || {}), aspect: ratio };
      // persist (debounced) and update local selection
      handleNodeChange?.(updated);
      setSelectedNode(updated);
    }
  } catch (err) {
    console.warn("Failed to update node size for ratio change", err);
  }
}, [panelValues.ratio?.selected, selectedNode?.id, handleNodeChange]);

  // Keep page mode in sync with the selected node (but don't override while generating)
  useEffect(() => {
    if (generating) return;
    if (!selectedNode) { setMode("create"); return; }
    const hasImage = Boolean(selectedNode?.data?.image);
    setMode(hasImage ? "edit" : "create");
  }, [selectedNode, generating]);

  // helper used by other flows (legacy, manual)
  async function handleImageReady(url) {
    if (!url) return;
    setImages((prev) => [...prev, url]);

    if (mode !== "edit" && selectedNode?.id && nodeCanvasRef.current?.updateNode) {
      try {
        const existing = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === selectedNode.id)?.data ?? {};
        nodeCanvasRef.current.updateNode(selectedNode.id, {
          data: { ...(existing || {}), image: url, status: "done", prompt, model: panelValues.model?.selected, type: existing.type ?? "image" },
        });
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

    enqueueOrAddImageNode({ imageUrl: url, promptText: prompt, modelName: panelValues.model?.selected });
  }

  // NodeCanvas selection handler; defer state set to avoid setState during render
  const handleNodeSelect = useCallback((node) => {
    setTimeout(() => setSelectedNode(node), 0);
  }, []);

  

  // ===== Generate flow (UI entry point) =====

async function handleGenerate(e) {
  e?.preventDefault();
  setError(null);
  setImages([]);
  setPrediction(null);

  const currentPrompt = prompt ?? "";
  latestGenerationPromptRef.current = currentPrompt;
  setPrompt("");

  setGenerating(true);

  // Decide target node: prefer selected node if not in 'edit' mode
  let targetNodeId = null;
  if (mode !== "edit" && selectedNode?.id) {
    targetNodeId = selectedNode.id;
  } else if (mode !== "edit") {
    targetNodeId = findPlaceholderNodeId();
  }

  // mark generating on target (optimistic)
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

  // gather connected references/prompts for this target (secure: exchange storage paths for signed urls)
  let gathered = { sourceNodeIds: [], imageRefs: [], textPrompt: null };
  try {
    gathered = await gatherSourcesForTarget(targetNodeId);
  } catch (err) {
    console.warn("gatherSourcesForTarget failed:", err);
    gathered = { sourceNodeIds: [], imageRefs: [], textPrompt: null };
  }

  // choose effective prompt (text node overrides empty user prompt; otherwise user prompt wins)
  const effectivePrompt = (currentPrompt && currentPrompt.trim().length > 0) ? currentPrompt : (gathered.textPrompt ?? "");

  // build create options — include image references if present
  const createOptions = { ...options };
  if (gathered.imageRefs && gathered.imageRefs.length) createOptions.references = gathered.imageRefs;

  try {
    // call createPrediction (uses our lib/api wrapper underneath)
    const create = await createPrediction(effectivePrompt, createOptions);

    // raw prediction case (server responded with completed prediction immediately)
    if (create.rawPrediction) {
      const raw = create.rawPrediction;
      setPrediction(raw);
      const out = raw.output || raw.result || raw.images;
      if (out) {
        const arr = typeof out === "string" ? [out] : Array.isArray(out) ? out.flat() : [];
        setImages(arr);
        const last = arr[arr.length - 1];
        if (last) {
          const externalUrl = last;
          const procKey = `ext:${externalUrl}`;
          if (!processedPredictionsRef.current.has(procKey)) {
            if (currentProjectId) {
              try {
                const res = await finalizeOnce(procKey, {
                  externalUrl,
                  projectId: currentProjectId,
                  position: (mode === "edit" && selectedNode) ? { x: (selectedNode.x ?? 0) + (selectedNode.width ?? 260) + 80, y: (selectedNode.y ?? 0) } : null,
                  prompt: latestGenerationPromptRef.current || "",
                  model: panelValues.model?.selected,
                  sourceNodeIds: (gathered.sourceNodeIds && gathered.sourceNodeIds.length) ? gathered.sourceNodeIds : (mode === "edit" && selectedNode?.id ? [selectedNode.id] : []),
                  nodeCanvasRef,
                });

                if (res?.node) {
                  const nodeRow = res.node;
                  const canonical = res.storagePath ?? nodeRow?.data?.image ?? null;
                  if (canonical) nodeStoragePathRef.current.set(nodeRow.id, normalizeStoragePath(canonical));
                  await addNodeViaQueue({
                    id: nodeRow.id,
                    image: res.signedUrl ?? null,
                    prompt: nodeRow.data?.prompt ?? "",
                    model: nodeRow.data?.model ?? "",
                    position: { x: nodeRow.x ?? 120, y: nodeRow.y ?? 120 },
                    width: nodeRow.width ?? 260,
                    height: nodeRow.height ?? 180,
                    data: nodeRow.data ?? {},
                  });
                  if (res?.edge) {
                    const edge = res.edge;
                    const src = edge.source_node ?? edge.sourceId ?? edge.source;
                    const tgt = edge.target_node ?? edge.targetId ?? edge.target;
                    nodeCanvasRef.current?.addEdge?.({ sourceId: src, targetId: tgt });
                  }
                } else if (res?.alreadyProcessed) {
                  // already processed elsewhere — no-op
                } else {
                  enqueueOrAddImageNode({ imageUrl: externalUrl, promptText: latestGenerationPromptRef.current || "", modelName: panelValues.model?.selected });
                }
              } catch (err) {
                console.warn("Finalize failed (rawPrediction path)", err);
                enqueueOrAddImageNode({ imageUrl: externalUrl, promptText: currentPrompt, modelName: panelValues.model?.selected });
              }
            } else {
              enqueueOrAddImageNode({ imageUrl: last, promptText: currentPrompt, modelName: panelValues.model?.selected });
            }
          }
        }
      }

      setGenerating(false);
      setMode("edit");
      currentTargetRef.current = null;
      latestGenerationPromptRef.current = "";
      return;
    }

    // standard path with prediction id
    const id = create.id;
    if (!isValidId(id)) throw new Error("No valid prediction id returned from create endpoint.");
    setPredictionId(id);

    // immediate fetch once (preview or instant success)
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
                  sourceNodeIds: (gathered.sourceNodeIds && gathered.sourceNodeIds.length) ? gathered.sourceNodeIds : (mode === "edit" && selectedNode?.id ? [selectedNode.id] : []),
                  nodeCanvasRef,
                });

                if (res?.node) {
                  await addNodeViaQueue({
                    id: nodeRow.id,
                    image: res.signedUrl ?? null,
                    prompt: nodeRow.data?.prompt ?? "",
                    model: nodeRow.data?.model ?? "",
                    position: { x: nodeRow.x ?? 120, y: nodeRow.y ?? 120 },
                    width: nodeRow.width ?? 260,
                    height: nodeRow.height ?? 180,
                    data: nodeRow.data ?? {},
                  });
                  if (res?.edge) {
                    const edge = res.edge;
                    const src = edge.source_node ?? edge.sourceId ?? edge.source;
                    const tgt = edge.target_node ?? edge.targetId ?? edge.target;
                    nodeCanvasRef.current?.addEdge?.({ sourceId: src, targetId: tgt });
                  }
                } else if (res?.alreadyProcessed) {
                  // noop
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
            nodeCanvasRef.current.updateNode(previewTarget, { data: { image: arr[arr.length - 1], status: "processing", prompt: latestGenerationPromptRef.current || "" } });
            const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === previewTarget) ?? null;
            if (updated) setSelectedNode(updated);
          } catch (e) { /* ignore */ }
        }
      }
    } else {
      setMode("generating");
    }

    // start long-polling via hook (the hook will call onUpdate/onFinished)
    pollingStart(id);
  } catch (err) {
    console.error("handleGenerate error:", err);
    setError(err.message || String(err));
    setGenerating(false);
    setMode("create");
    currentTargetRef.current = null;
    latestGenerationPromptRef.current = "";
  }
}

  // UI helpers (display etc.)
  const currentMode = mode ?? "";
  const selectedRatio = panelValues.ratio?.selected ?? "9:16";
  const displaySrc = selectedNode?.data?.image ?? null;

  // Render
  return (
    <ProtectedRoute>
      <div className="page-root bg-bg grid grid-rows-12 grid-cols-12 h-screen">
        <section className="row-span-12 col-span-5 row-start-1 col-start-1 grid grid-cols-5 grid-rows-12 gap-2 p-2">
          <div className="canvas col-span-5 row-span-8 bg-[#181818] rounded-md overflow-hidden">
            <div className="w-full h-full">
              <div className="w-full h-full p-2 flex items-center justify-center relative">
                <div className="flex items-center gap-2 z-50 absolute top-1 right-1">
                <div className="relative">
                    <button
                      // ref={newNodePanelRef} fix this later!   
                      type="button"
                      onClick={() => setShowNewNodePanel((s) => !s)}
                      className="button-icon px-2 text-medium flex flex-row items-center justify-center"
                      aria-label="Add node to canvas"
                      title="Add node"
                    >
                       <Image 
                          src={'/plus-icon.svg'}
                          height={11}
                          width={11}
                          alt="Image Icon"
                          className="mr-2"
                          />
                       node
                    </button>

                    {showNewNodePanel && (
                      <div
                        className="bg-main absolute right-0 mt-1 w-44 text-medium p-1 rounded-xs border-border-main border mb-1.5 transform flex flex-col drop-shadow-md"
                        style={{ zIndex: 1000 }}
                        role="dialog"
                        aria-label="Create node"
                      >
                        <button
                          type="button"
                          onClick={() => { addEmptyNode(); setShowNewNodePanel(false); }}
                          className="w-full text-left pl-1 pr-2 py-1 rounded-xs hover:bg-border-main hover:cursor-pointer flex flex-row  items-start"
                        >
                          <Image 
                          src={'/Image_02.svg'}
                          height={19}
                          width={19}
                          alt="Image Icon"
                          className="mr-2"
                          />
                          Create image node
                        </button>

                        <button
                          type="button"
                          onClick={() => { addTextNodeAtCenter({ text: "" }); }}
                          className="w-full text-left pl-1 pr-2 py-1 mt-1 rounded-xs hover:bg-border-main hover:cursor-pointer flex flex-row  items-start"
                        >
                          <Image 
                          src={'/Text.svg'}
                          height={19}
                          width={19}
                          alt="Text Icon"
                          className="mr-2"
                          />
                          Create text node
                        </button>
                      </div>
                    )}
                  </div>
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
