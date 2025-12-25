// app/page.js (or pages/index.jsx) — client component
"use client";

import { useEffect, useRef, useState } from "react";
import Tools from "./components/Tools";
import DownloadButton from "./components/DownloadButton";
import ExpandButton from "./components/ExpandButton";
import OptionsButton from "./components/OptionsButton";
import NodeCanvas from "./components/node/NodeCanvas";
import ImageContainer from "./components/ImageContainer";
import EditSideBar from "./components/edit/EditSideBar";
import EditScreen from "./components/edit/EditScreen";

export default function Page() {
  // ---- Core UI state ----
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [predictionId, setPredictionId] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [images, setImages] = useState([]);
  const [error, setError] = useState(null);
  const [referenceUrls, setReferenceUrls] = useState([]);
  const pollRef = useRef(null);

  const [mode, setMode] = useState("create"); // 'create'|'generating'|'preview'|'edit'

  // ---- Node canvas refs & selection ----
  const nodeCanvasRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);

  // When a generation starts that targets a selected node or placeholder, we lock the target here
  // so selection changes by the user won't steal the final image.
  const currentTargetRef = useRef(null);

  // Pending node payloads when NodeCanvas isn't mounted yet
  const [pendingNodeQueue, setPendingNodeQueue] = useState([]);

  const latest = images.length ? images[images.length - 1] : null;

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

  // ===== Node queue flush (when NodeCanvas becomes ready) =====
  useEffect(() => {
    if (!nodeCanvasRef.current) return;
    if (!pendingNodeQueue || pendingNodeQueue.length === 0) return;

    pendingNodeQueue.forEach((item) => {
      try {
        nodeCanvasRef.current.addImageNode?.(item);
      } catch (e) {
        console.error("Failed to flush pending node to NodeCanvas", e, item);
      }
    });
    setPendingNodeQueue([]);
  }, [pendingNodeQueue]);

  // ---- Helpers for node add/update ----
  function findPlaceholderNodeId() {
    // returns the id of the first node that looks like the placeholder (no data.image)
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

    const payload = { image: imageUrl, prompt: promptText, model: modelName };

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
    if (nodeCanvasRef.current?.addImageNode) {
      try {
        nodeCanvasRef.current.addImageNode(payload);
      } catch (err) {
        console.error("addImageNode threw", err);
        setPendingNodeQueue((q) => [...q, payload]);
      }
    } else {
      setPendingNodeQueue((q) => [...q, payload]);
    }
  }

  function addEmptyNode({ position = null, width = 260, height = 180 } = {}) {
    const payload = { image: null, prompt: "", model: "", position, width, height };

    if (nodeCanvasRef.current?.addImageNode) {
      try {
        nodeCanvasRef.current.addImageNode(payload);
      } catch (err) {
        console.error("addImageNode threw while adding empty node", err);
        setPendingNodeQueue((q) => [...q, payload]);
      }
    } else {
      setPendingNodeQueue((q) => [...q, payload]);
    }
  }

  useEffect(() => {
    const isTypingInEditable = (ev) => {
      // prefer to check the activeElement; fallback to event target if needed
      const el = document.activeElement ?? ev.target;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    };
  
    function onKeyDown(e) {
      // ignore IME composition
      if (e.isComposing) return;
  
      // only handle Delete/Backspace when NOT typing in an input/textarea/contenteditable
      if ((e.key === "Delete" || e.key === "Backspace")) {
        if (isTypingInEditable(e)) {
          // let the browser perform the normal editing behavior
          return;
        }
  
        // nothing to do if we don't have a selected node
        if (!selectedNode?.id) return;
  
        try {
          if (nodeCanvasRef.current?.removeNode) {
            nodeCanvasRef.current.removeNode(selectedNode.id);
          } else {
            console.warn('NodeCanvas.removeNode not available');
          }
        } catch (err) {
          console.error('Failed to remove node', err);
        }
        setSelectedNode(null);
      }
    }
  
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedNode]);

  // ===== File handlers =====
  const handleFilesAdded = (pickedFiles) => {
    const items = pickedFiles.map((file, i) => {
      const id = crypto.randomUUID();
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
                nodeCanvasRef.current.updateNode(targetIdForPreview, {
                  data: { image: arr[arr.length - 1], status: pred.status === "succeeded" ? "done" : "processing" },
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
          // finalization logic
          const outFinal = pred.output || pred.result || pred.images;
          if (outFinal) {
            const arr = typeof outFinal === "string" ? [outFinal] : Array.isArray(outFinal) ? outFinal.flat() : [];
            setImages(arr);

            const last = arr[arr.length - 1];
            if (last) {
              // prefer locked target if available (lock set at generation start) OR placeholder
              let targetId = currentTargetRef.current ?? null;

              // If no locked target, try to find placeholder (replace it)
              if (!targetId && mode !== "edit") {
                const placeholderId = findPlaceholderNodeId();
                if (placeholderId) targetId = placeholderId;
              }

              if (targetId && nodeCanvasRef.current?.updateNode && mode !== "edit") {
                try {
                  nodeCanvasRef.current.updateNode(targetId, {
                    data: { image: last, status: "done", prompt, model: panelValues.model?.selected },
                  });
                  const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === targetId) ?? null;
                  if (updated) setSelectedNode(updated);
                } catch (err) {
                  console.error("updateNode failed, falling back to addImageNode", err);
                  enqueueOrAddImageNode({ imageUrl: last, promptText: prompt, modelName: panelValues.model?.selected });
                }
              } if (mode === 'edit' && selectedNode?.id && nodeCanvasRef.current?.addImageNode) {
                try {
                  // create new node for the generated image
                  const newNodeId = nodeCanvasRef.current.addImageNode({
                    image: last,
                    prompt,
                    model: panelValues.model?.selected,
                    // optional: position: set position relative to selectedNode, e.g. to the right
                    position: {
                      x: (selectedNode.x ?? 0) + (selectedNode.width ?? 260) + 80, // place to the right of selected
                      y: (selectedNode.y ?? 0)
                    },
                    width: 260,
                    height: 180,
                  });
              
                  // connect selectedNode -> newNode
                  if (newNodeId && nodeCanvasRef.current?.addEdge) {
                    nodeCanvasRef.current.addEdge({ sourceId: selectedNode.id, targetId: newNodeId });
                  }
                } catch (err) {
                  console.error('Failed to add/connect new node, falling back to enqueue', err);
                  enqueueOrAddImageNode({ imageUrl: last, promptText: prompt, modelName: panelValues.model?.selected });
                }
              } else {
                // previous fallback behavior (existing)
                enqueueOrAddImageNode({ imageUrl: last, promptText: prompt, modelName: panelValues.model?.selected });
              }
            }
          }

          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          // clear lock
          currentTargetRef.current = null;
          setGenerating(false);
          setMode("edit");
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

    setGenerating(true);

    // Decide target node: prefer selected node if not in 'edit' mode
    // If there's no selection, prefer a placeholder node to replace (first node without an image)
    let targetNodeId = null;
    if (mode !== "edit" && selectedNode?.id) {
      targetNodeId = selectedNode.id;
    } else if (mode !== "edit") {
      // look for placeholder
      targetNodeId = findPlaceholderNodeId();
    }

    if (targetNodeId && nodeCanvasRef.current?.updateNode) {
      try {
        // lock target for this generation (so later we update it)
        currentTargetRef.current = targetNodeId;
        // mark node as generating (so UI can show spinner/blur)
        nodeCanvasRef.current.updateNode(targetNodeId, {
          data: { status: "generating", prompt, model: panelValues.model?.selected },
        });
        // refresh selectedNode object if it matches
        const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === targetNodeId) ?? null;
        if (updated) setSelectedNode(updated);
      } catch (e) {
        console.error("Could not mark target node as generating", e);
      }
    } else {
      currentTargetRef.current = null;
    }

    setMode("generating"); // explicit transition

    try {
      const create = await createPrediction(prompt, options);

      // If the create endpoint returned a full prediction object (no id)
      if (create.rawPrediction) {
        const raw = create.rawPrediction;
        setPrediction(raw);
        const out = raw.output || raw.result || raw.images;
        if (out) {
          const arr = typeof out === "string" ? [out] : Array.isArray(out) ? out.flat() : [];
          setImages(arr);
          const last = arr[arr.length - 1];
          if (last) {
            // Determine target: locked target first, then placeholder, otherwise add new
            let tId = currentTargetRef.current ?? null;
            if (!tId && mode !== "edit") {
              const placeholderId = findPlaceholderNodeId();
              if (placeholderId) tId = placeholderId;
            }

            if (tId && nodeCanvasRef.current?.updateNode && mode !== "edit") {
              nodeCanvasRef.current.updateNode(tId, {
                data: { image: last, status: "done", prompt, model: panelValues.model?.selected },
              });
              const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === tId) ?? null;
              if (updated) setSelectedNode(updated);
            } else {
              enqueueOrAddImageNode({ imageUrl: last, promptText: prompt, modelName: panelValues.model?.selected });
            }
          }
        }

        setGenerating(false);
        setMode("edit");
        currentTargetRef.current = null;
        return;
      }

      const id = create.id;
      if (!isValidId(id)) {
        throw new Error("No valid prediction id returned from create endpoint.");
      }

      setPredictionId(id);

      // immediate fetch once
      const first = await fetchPrediction(id);
      setPrediction(first);
      const out = first.output || first.result || first.images;
      if (out) {
        const arr = typeof out === "string" ? [out] : Array.isArray(out) ? out.flat() : [];
        setImages(arr);

        // If immediate success already:
        if (first.status === "succeeded") {
          const last = arr[arr.length - 1];
          if (last) {
            // Determine target: locked target first, then placeholder, otherwise add new
            let tId = currentTargetRef.current ?? null;
            if (!tId && mode !== "edit") {
              const placeholderId = findPlaceholderNodeId();
              if (placeholderId) tId = placeholderId;
            }

            if (tId && nodeCanvasRef.current?.updateNode && mode !== "edit") {
              nodeCanvasRef.current.updateNode(tId, {
                data: { image: last, status: "done", prompt, model: panelValues.model?.selected },
              });
              const updated = nodeCanvasRef.current.getNodes?.()?.find((n) => n.id === tId) ?? null;
              if (updated) setSelectedNode(updated);
            } else {
              enqueueOrAddImageNode({ imageUrl: last, promptText: prompt, modelName: panelValues.model?.selected });
            }
          }

          setGenerating(false);
          setMode("edit");
          currentTargetRef.current = null;
          return;
        }

        // partial preview -> show preview mode
        if (arr.length && first.status !== "succeeded") {
          setMode("preview");
          const previewTarget = currentTargetRef.current ?? (mode !== "edit" ? selectedNode?.id : null);
          if (previewTarget && nodeCanvasRef.current?.updateNode) {
            try {
              nodeCanvasRef.current.updateNode(previewTarget, { data: { image: arr[arr.length - 1], status: "processing" } });
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

    // attempt to update selected node if appropriate, otherwise add/replace placeholder
    const payload = { image: url, prompt, model: panelValues.model?.selected };

    // prefer selected
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

    // else replace placeholder if present
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

    // fallback: add
    enqueueOrAddImageNode(payload);
  }

  const currentMode = mode ?? "";
  const selectedRatio = panelValues.ratio?.selected ?? "9:16";
  const displaySrc = selectedNode?.data?.image ?? null;

  // ---- Render ----
  return (
    <div className="page-root bg-bg grid grid-rows-12 grid-cols-12 h-screen">
      <section className="row-span-12 col-span-5 row-start-1 col-start-1 grid grid-cols-5 grid-rows-12 gap-2 p-2">
        <div className="canvas col-span-5 row-span-8 bg-canvas rounded-md overflow-hidden">
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

              <NodeCanvas ref={nodeCanvasRef} onNodeSelect={setSelectedNode} />
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
                    {generating ? "Generating..." : "Create"}
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
  );
}
