// components/node/NodeCanvas.jsx
"use client";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ImageNode from "./ImageNode";
import TextNode from "./TextNode";

function uid(prefix = "n_") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toFixedNum = (n) => Number(n.toFixed(2));

const NodeCanvas = forwardRef(function NodeCanvas(
  { onNodeSelect, onNodeChange, onEdgeCreate, onNodeRemove, onEdgeRemove },
  ref
) {
  const containerRef = useRef(null);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const connectingRef = useRef(null); // { sourceId, sourcePortWorld }
  const [connectingTargetWorld, setConnectingTargetWorld] = useState(null);
  const [connectHoverNode, setConnectHoverNode] = useState(null);

  const draggingRef = useRef(null);
  const panningRef = useRef(null);
  const rafPanRef = useRef(null);
  const spacePressedRef = useRef(false);

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 3.5;
  const GRID_SIZE = 32;
  const SNAP_ON_DROP = true;
  const AUTO_PAN_MARGIN = 80;
  const AUTO_PAN_SPEED = 12;

  const [worldSize, setWorldSize] = useState({ w: 3000, h: 2000 });

  // ---------- coordinate helpers ----------
  const clientToWorld = useCallback(({ clientX, clientY }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    return { x: (cx - translate.x) / scale, y: (cy - translate.y) / scale };
  }, [scale, translate]);

  const worldToClient = useCallback(({ x, y }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { clientX: 0, clientY: 0 };
    const cx = translate.x + x * scale + rect.left;
    const cy = translate.y + y * scale + rect.top;
    return { clientX: cx, clientY: cy };
  }, [scale, translate]);

  // ---------- recompute world size ----------
  useEffect(() => {
    const padding = 400;
    const rect = containerRef.current?.getBoundingClientRect();
    const minW = rect?.width ?? 1200;
    const minH = rect?.height ?? 800;
    if (!nodes || nodes.length === 0) {
      setWorldSize({ w: Math.max(1200, minW), h: Math.max(800, minH) });
      return;
    }
    let maxX = 0;
    let maxY = 0;
    for (const n of nodes) {
      maxX = Math.max(maxX, n.x + (n.width ?? 260));
      maxY = Math.max(maxY, n.y + (n.height ?? 180));
    }
    const w = Math.max(minW, Math.ceil(maxX + padding));
    const h = Math.max(minH, Math.ceil(maxY + padding));
    setWorldSize({ w, h });
  }, [nodes]);

  // ---------- keyboard: Delete for selected edge ----------
  useEffect(() => {
    const isTypingInEditable = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKeyDownEdge = (e) => {
      if (e.isComposing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && !isTypingInEditable()) {
        if (selectedEdgeId) {
          const edgeObj = edges.find((ed) => ed.id === selectedEdgeId);
          if (edgeObj) {
            // local removal
            setEdges((prev) => prev.filter((ed) => ed.id !== selectedEdgeId));
            setSelectedEdgeId(null);
            try { onEdgeRemove?.(edgeObj); } catch (err) { console.warn("onEdgeRemove failed", err); }
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDownEdge);
    return () => window.removeEventListener("keydown", onKeyDownEdge);
  }, [selectedEdgeId, edges, onEdgeRemove]);

  // ---------- small helper: add or update node in a single place ----------
  const addOrUpdateNode = useCallback(async ({
    id = null,
    image,
    prompt,
    model,
    position = null,
    width = 260,
    height = 180,
    data = {},
  } = {}) => {
    // perform functional update to avoid stale closures
    let idToUse = id;
    setNodes((prev) => {
      // compute default pos based on current length
      const defaultPos = { x: 80 + prev.length * 40, y: 80 + prev.length * 30 };
      const pos = position || defaultPos;
      if (idToUse) {
        // update if present else append
        const existing = prev.find((n) => n.id === idToUse);
        if (existing) {
          const mergedData = {
            ...(existing.data || {}),
            ...(data || {}),
            ...(typeof image !== "undefined" ? { image } : {}),
            ...(typeof prompt !== "undefined" ? { prompt } : {}),
            ...(typeof model !== "undefined" ? { model } : {}),
          };
          if (mergedData.image) mergedData.status = mergedData.status ?? "done";
          else mergedData.status = mergedData.status ?? (existing.data?.status ?? "empty");
          return prev.map((n) => n.id === idToUse ? { ...n, x: pos.x, y: pos.y, width, height, data: mergedData } : n);
        } else {
          // will append with provided id
          const initData = {
            ...(data || {}),
            ...(typeof image !== "undefined" && image !== null ? { image } : {}),
            ...(typeof prompt !== "undefined" ? { prompt } : {}),
            ...(typeof model !== "undefined" ? { model } : {}),
          };
          if (!initData.type && typeof initData.text === "string" && initData.text.length > 0) initData.type = "text";
          if (initData.image) initData.status = initData.status ?? "done"; else initData.status = initData.status ?? "empty";
          const node = { id: idToUse, x: pos.x, y: pos.y, width, height, data: initData };
          return [...prev, node];
        }
      } else {
        // create new id and append
        idToUse = uid();
        const initData = {
          ...(data || {}),
          ...(typeof image !== "undefined" && image !== null ? { image } : {}),
          ...(typeof prompt !== "undefined" ? { prompt } : {}),
          ...(typeof model !== "undefined" ? { model } : {}),
        };
        if (!initData.type && typeof initData.text === "string" && initData.text.length > 0) initData.type = "text";
        if (initData.image) initData.status = initData.status ?? "done"; else initData.status = initData.status ?? "empty";
        const node = { id: idToUse, x: pos.x, y: pos.y, width, height, data: initData };
        return [...prev, node];
      }
    });

    // after mutation, enforce single-selection (clear any selected edge), select node and notify parent
    requestAnimationFrame(() => {
    // ensure only a node is selected
    setSelectedEdgeId(null);
    setSelectedId(idToUse);
  
    const updated = (ref && ref.current && typeof ref.current.getNodes === "function")
      ? ref.current.getNodes?.().find((nn) => nn.id === idToUse) ?? null
      : (nodes.find((n) => n.id === idToUse) ?? null);
  
    const fallbackUpdated = nodes.find((n) => n.id === idToUse) ?? null;
    onNodeSelect?.(updated ?? fallbackUpdated ?? null);
  });

    return idToUse;
  }, [nodes, onNodeSelect, ref]);

  // ---------- imperative API ----------
  useImperativeHandle(
    ref,
    () => {
      // helper: compute world coords at the center of the visible container
      const getViewCenterWorld = () => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return { x: 120, y: 120 };
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        return clientToWorld({ clientX, clientY });
      };

      return {
        // generic add/update node (low-level)
        addNode(args = {}) {
          return addOrUpdateNode(args);
        },

        // add a text node — forward `data` and ensure `type: "text"`
        addTextNode({ id = null, text = "", position = null, width = 260, height = 120, data = {} } = {}) {
          const mergedData = { ...(data || {}), type: data?.type ?? "text", text: typeof text !== "undefined" ? text : (data?.text ?? ""), status: data?.status ?? (text ? "done" : "empty") };
          return addOrUpdateNode({ id, position, width, height, data: mergedData });
        },

        // add an image node — forward `data` but do not overwrite an existing data.type
        addImageNode({
          id = null,
          image = null,
          prompt = "",
          model = "",
          position = null,
          width = 260,
          height = 180,
          data = {},
        } = {}) {
          const incomingType = data?.type;
          const mergedData = {
            ...(data || {}),
            type: typeof incomingType !== "undefined" && incomingType !== null ? incomingType : "image",
            image: typeof image !== "undefined" ? image : data?.image,
            prompt: typeof prompt !== "undefined" ? prompt : data?.prompt,
            model: typeof model !== "undefined" ? model : data?.model,
            status: typeof data?.status !== "undefined" ? data.status : (image ? "done" : (data?.status ?? "empty")),
          };
          return addOrUpdateNode({ id, image, prompt, model, position, width, height, data: mergedData });
        },

        // add image at client position (centers node on pointer)
        addImageNodeAtClientPos({ image = null, prompt = "", model = "", clientX, clientY, width = 260, height = 180, data = {} } = {}) {
          const world = clientToWorld({ clientX, clientY });
          const pos = { x: Math.round(world.x - width / 2), y: Math.round(world.y - height / 2) };
          const incomingType = data?.type;
          const mergedData = {
            ...(data || {}),
            type: typeof incomingType !== "undefined" && incomingType !== null ? incomingType : "image",
            image: typeof image !== "undefined" ? image : data?.image,
            prompt: typeof prompt !== "undefined" ? prompt : data?.prompt,
            model: typeof model !== "undefined" ? model : data?.model,
            status: typeof data?.status !== "undefined" ? data.status : (image ? "done" : (data?.status ?? "empty")),
          };
          return addOrUpdateNode({ image, prompt, model, position: pos, width, height, data: mergedData });
        },

        updateNode(id, patch = {}) {
          setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== id) return n;
              const merged = { ...n, ...patch };
              merged.data = { ...(n.data || {}), ...(patch.data || {}) };
              return merged;
            })
          );

          // notify after update — ensure single-selection: clear any selected edge when selecting a node
            requestAnimationFrame(() => {
                setSelectedEdgeId(null);
                setSelectedId(id);
            
                const updated = (ref && ref.current && typeof ref.current.getNodes === "function")
                ? ref.current.getNodes?.()?.find((nn) => nn.id === id) ?? null
                : nodes.find((nn) => nn.id === id) ?? null;
            
                if (updated) {
                onNodeSelect?.(updated);
                onNodeChange?.(updated);
                }
            });

          return id;
        },

        addEdge({ id: providedEdgeId = null, sourceId, targetId } = {}) {
          if (!sourceId || !targetId) return null;
          // ensure nodes exist
          const srcExists = nodes.some((n) => n.id === sourceId);
          const tgtExists = nodes.some((n) => n.id === targetId);
          if (!srcExists || !tgtExists) {
            console.warn("addEdge: source or target does not exist", { sourceId, targetId });
            return null;
          }
          // avoid duplicates
          const exists = edges.some((e) => e.sourceId === sourceId && e.targetId === targetId);
          if (exists) return null;

          const edgeId = providedEdgeId || uid("edge_");
          setEdges((prev) => {
            const created = { id: edgeId, sourceId, targetId };
            // notify parent (server create will be handled by outer code)
            onEdgeCreate?.(created);
            return [...prev, created];
          });
          return edgeId;
        },

        removeEdge(edgeId) {
          if (!edgeId) return null;
          setEdges((prev) => prev.filter((e) => e.id !== edgeId));
          setSelectedEdgeId((prev) => (prev === edgeId ? null : prev));
          return edgeId;
        },

        // remove edge by endpoints (source+target)
        removeEdgeByEndpoints({ sourceId, targetId } = {}) {
          if (!sourceId || !targetId) return null;
          let removed = null;
          setEdges((prev) => {
            const remain = prev.filter((e) => {
              if (e.sourceId === sourceId && e.targetId === targetId) {
                removed = e.id;
                return false;
              }
              return true;
            });
            return remain;
          });
          if (removed && selectedEdgeId === removed) setSelectedEdgeId(null);
          return removed;
        },

        removeNode(id) {
          if (!id) return;
          const wasSelected = selectedId === id;

          setNodes((prev) => prev.filter((n) => n.id !== id));
          setEdges((prev) => prev.filter((e) => e.sourceId !== id && e.targetId !== id));
          setSelectedId((prev) => (prev === id ? null : prev));
          setSelectedEdgeId((prev) => {
            if (!prev) return null;
            const stillExists = edges.some((ed) => ed.id === prev && ed.sourceId !== id && ed.targetId !== id);
            return stillExists ? prev : null;
          });

          if (wasSelected) {
            setTimeout(() => onNodeSelect?.(null), 0);
          }
          return id;
        },

        getNodes() {
          return nodes;
        },

        getEdges() {
          return edges;
        },

        getViewCenterWorld,
        centerOnNode(nodeId, { animate = false } = {}) {
          try {
            const node = nodes.find((n) => n.id === nodeId);
            if (!node || !containerRef.current) return false;
            const rect = containerRef.current.getBoundingClientRect();

            // compute desired translate so node center maps to rect center
            const nodeCenterWorld = { x: node.x + (node.width ?? 260) / 2, y: node.y + (node.height ?? 180) / 2 };
            const centerClientX = rect.width / 2;
            const centerClientY = rect.height / 2;

            const desiredTranslateX = centerClientX - nodeCenterWorld.x * scale;
            const desiredTranslateY = centerClientY - nodeCenterWorld.y * scale;

            if (animate) {
              const start = { ...translate };
              const end = { x: desiredTranslateX, y: desiredTranslateY };
              const dur = 220;
              const t0 = performance.now();
              const step = (now) => {
                const p = Math.min(1, (now - t0) / dur);
                const eased = p * (2 - p);
                setTranslate({ x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased });
                if (p < 1) requestAnimationFrame(step);
              };
              requestAnimationFrame(step);
            } else {
              setTranslate({ x: desiredTranslateX, y: desiredTranslateY });
            }
            return true;
          } catch (e) {
            return false;
          }
        },

        clear() {
          setNodes([]);
          setEdges([]);
          setSelectedId(null);
          setSelectedEdgeId(null);
          requestAnimationFrame(() => onNodeSelect?.(null));
        },
      };
    },
    // dependencies: keep minimal but include values used inside API
    [addOrUpdateNode, clientToWorld, nodes, edges, onNodeSelect, onNodeChange, onEdgeCreate, onNodeRemove, onEdgeRemove, scale, translate]
  );

  // ---------- port coords ----------
  function getPortWorld(node, port) {
    if (!node) return { x: 0, y: 0 };
    const width = node.width ?? 260;
    const height = node.height ?? 180;
    if (port === "output") {
      return { x: node.x + width, y: node.y + height / 2 };
    } else {
      return { x: node.x, y: node.y + height / 2 };
    }
  }

  function nodeAtWorld(x, y) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height) return n;
    }
    return null;
  }

  // ---------- global pointer handlers ----------
  useEffect(() => {
    const onPointerMove = (e) => {
      if (connectingRef.current) {
        const w = clientToWorld({ clientX: e.clientX, clientY: e.clientY });
        setConnectingTargetWorld(w);
        const hit = nodeAtWorld(w.x, w.y);
        setConnectHoverNode(hit?.id ?? null);
        return;
      }

      if (draggingRef.current) {
        const d = draggingRef.current;
        const dxClient = e.clientX - d.startClientX;
        const dyClient = e.clientY - d.startClientY;
        let nx = d.originX + dxClient / scale;
        let ny = d.originY + dyClient / scale;

        // update node position functionally to avoid stale closures
        setNodes((prev) => prev.map((n) => (n.id === d.id ? { ...n, x: nx, y: ny } : n)));

        // auto-pan while dragging
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const nodeClientX = translate.x + nx * scale + rect.left;
          const nodeClientY = translate.y + ny * scale + rect.top;
          let panX = 0;
          let panY = 0;

          if (nodeClientX < rect.left + AUTO_PAN_MARGIN) {
            const dist = (rect.left + AUTO_PAN_MARGIN) - nodeClientX;
            panX = Math.min(AUTO_PAN_SPEED * Math.ceil(dist / 20), 160);
          } else if (nodeClientX > rect.right - AUTO_PAN_MARGIN) {
            const dist = nodeClientX - (rect.right - AUTO_PAN_MARGIN);
            panX = -Math.min(AUTO_PAN_SPEED * Math.ceil(dist / 20), 160);
          }

          if (nodeClientY < rect.top + AUTO_PAN_MARGIN) {
            const dist = (rect.top + AUTO_PAN_MARGIN) - nodeClientY;
            panY = Math.min(AUTO_PAN_SPEED * Math.ceil(dist / 20), 160);
          } else if (nodeClientY > rect.bottom - AUTO_PAN_MARGIN) {
            const dist = nodeClientY - (rect.bottom - AUTO_PAN_MARGIN);
            panY = -Math.min(AUTO_PAN_SPEED * Math.ceil(dist / 20), 160);
          }

          if (panX !== 0 || panY !== 0) {
            if (rafPanRef.current) cancelAnimationFrame(rafPanRef.current);
            rafPanRef.current = requestAnimationFrame(() => {
              setTranslate((t) => ({ x: t.x + panX, y: t.y + panY }));
            });
          }
        }
        return;
      }

      if (panningRef.current) {
        const p = panningRef.current;
        const dx = e.clientX - p.startClientX;
        const dy = e.clientY - p.startClientY;
        setTranslate({ x: p.originTranslate.x + dx, y: p.originTranslate.y + dy });
      }
    };

    const onPointerUp = (e) => {
      // finish connect
      if (connectingRef.current) {
        const w = clientToWorld({ clientX: e.clientX, clientY: e.clientY });
        const hit = nodeAtWorld(w.x, w.y);
        const sourceId = connectingRef.current.sourceId;
        if (hit && hit.id !== sourceId) {
          const newEdge = { id: uid("edge_"), sourceId, targetId: hit.id };
          setEdges((prev) => {
            const exists = prev.some(ed => ed.sourceId === sourceId && ed.targetId === hit.id);
            if (exists) return prev;
            // notify parent
            onEdgeCreate?.(newEdge);
            return [...prev, newEdge];
          });
        }
        connectingRef.current = null;
        setConnectingTargetWorld(null);
        setConnectHoverNode(null);
        return;
      }

      // finish drag -> snap
      if (draggingRef.current) {
        const d = draggingRef.current;
        const node = nodes.find((n) => n.id === d.id);
        if (node) {
          let nx = node.x;
          let ny = node.y;
          if (SNAP_ON_DROP) {
            nx = Math.round(nx / GRID_SIZE) * GRID_SIZE;
            ny = Math.round(ny / GRID_SIZE) * GRID_SIZE;
            setNodes((prev) => prev.map((n) => n.id === d.id ? { ...n, x: nx, y: ny } : n));
          }
          // notify parent about node change
          const updated = { ...node, x: nx, y: ny };
          onNodeChange?.(updated);
        }
        draggingRef.current = null;
      }

      if (panningRef.current) panningRef.current = null;
      if (rafPanRef.current) {
        cancelAnimationFrame(rafPanRef.current);
        rafPanRef.current = null;
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (rafPanRef.current) { cancelAnimationFrame(rafPanRef.current); rafPanRef.current = null; }
    };
  }, [clientToWorld, nodes, edges, scale, translate, onNodeChange, onEdgeCreate]);

  // ---------- node pointer down (drag) ----------
  const onNodePointerDown = (e, node) => {
    if (e.button !== 0) return;
    if (connectingRef.current) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    containerRef.current?.focus?.();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
    draggingRef.current = { id: node.id, startClientX: e.clientX, startClientY: e.clientY, originX: node.x, originY: node.y };
    setSelectedId(node.id);
    setSelectedEdgeId(null); // clear edge selection when selecting a node
    onNodeSelect?.(node);
  };

  // ---------- canvas pointer down for panning ----------
  const onCanvasPointerDown = (e) => {
    // Always clear selections when the canvas background is clicked.
    // Node and edge elements call e.stopPropagation(), so clicks on them won't reach this handler.
    setSelectedId(null);
    setSelectedEdgeId(null);
    onNodeSelect?.(null);
  
    // Decide whether we should start panning.
    // Keep existing semantics: allow panning for left/middle click or when Space is held.
    const wantPan = e.button === 0 || e.button === 1 || spacePressedRef.current;
  
    // If the user clicked with a non-panning button (e.g. right-click) do nothing else.
    if (!wantPan) {
      return;
    }
  
    // Start panning. Prevent default to avoid accidental text selection and ensure consistent behavior.
    e.preventDefault();
    try { containerRef.current.setPointerCapture?.(e.pointerId); } catch (_) {}
    panningRef.current = { startClientX: e.clientX, startClientY: e.clientY, originTranslate: { ...translate } };
  };

  // ---------- wheel -> zoom handler (prevents browser zoom when ctrl/meta pressed) ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const clientX = e.clientX;
      const clientY = e.clientY;
      const worldBefore = clientToWorld({ clientX, clientY });
      const delta = -e.deltaY;
      const factor = Math.exp(delta * 0.017);
      const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
      setScale(newScale);
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const newTranslateX = cx - worldBefore.x * newScale;
      const newTranslateY = cy - worldBefore.y * newScale;
      setTranslate({ x: newTranslateX, y: newTranslateY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel, { passive: false });
  }, [clientToWorld, scale]);

  // ---------- keyboard space pan toggle ----------
  useEffect(() => {
    const isTypingInEditable = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e) => {
      if (e.isComposing) return;
      if (e.code === "Space" && !isTypingInEditable()) {
        spacePressedRef.current = true;
        containerRef.current?.classList?.add("cursor-grab");
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      if (e.isComposing) return;
      if (e.code === "Space" && !isTypingInEditable()) {
        spacePressedRef.current = false;
        containerRef.current?.classList?.remove("cursor-grab");
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ---------- start connection ----------
  function startConnection(e, node, port) {
    e.preventDefault();
    e.stopPropagation();
    if (port !== "output") return;
    const srcPortWorld = getPortWorld(node, "output");
    connectingRef.current = { sourceId: node.id, sourcePortWorld: srcPortWorld };
    setConnectingTargetWorld(srcPortWorld);
    setConnectHoverNode(null);
  }

  // ---------- edge path ----------
  function getEdgePath(sourceNode, targetNode) {
    if (!sourceNode || !targetNode) return "";
    const s = getPortWorld(sourceNode, "output"); // right
    const t = getPortWorld(targetNode, "input");  // left

    let x1 = +s.x, y1 = +s.y, x2 = +t.x, y2 = +t.y;
    const dx = x2 - x1;
    const dy = y2 - y1;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      return `M ${toFixedNum(x1)} ${toFixedNum(y1)} L ${toFixedNum(x2)} ${toFixedNum(y2)}`;
    }

    const base = 0.5;
    const adaptive = Math.min(36, Math.max(base, Math.abs(dx) * 0.05 + base));
    const dir = Math.sign(dx || 1);

    let sx = x1 + dir * adaptive;
    let sy = y1;
    let tx = x2 - dir * adaptive;
    let ty = y2;

    if ((dir > 0 && sx > tx) || (dir < 0 && sx < tx)) {
      const small = Math.min(adaptive, Math.max(6, Math.abs(dx) * 0.25));
      sx = x1 + dir * small;
      tx = x2 - dir * small;
    }

    const midX = (sx + tx) / 2;
    const cp1x = sx + (midX - sx) * 0.5;
    const cp2x = tx - (tx - midX) * 0.5;

    return `M ${toFixedNum(x1)} ${toFixedNum(y1)} L ${toFixedNum(sx)} ${toFixedNum(sy)} C ${toFixedNum(cp1x)} ${toFixedNum(sy)} ${toFixedNum(cp2x)} ${toFixedNum(ty)} ${toFixedNum(tx)} ${toFixedNum(ty)} L ${toFixedNum(x2)} ${toFixedNum(y2)}`;
  }

  function getTempPath() {
    if (!connectingRef.current || !connectingTargetWorld) return "";
    const src = connectingRef.current.sourcePortWorld;
    const t = connectingTargetWorld;

    let x1 = +src.x, y1 = +src.y, x2 = +t.x, y2 = +t.y;
    const dx = x2 - x1;

    if (Math.abs(dx) < 0.5 && Math.abs(y2 - y1) < 0.5) {
      return `M ${toFixedNum(x1)} ${toFixedNum(y1)} L ${toFixedNum(x2)} ${toFixedNum(y2)}`;
    }

    const base = 12;
    const adaptive = Math.min(36, Math.max(base, Math.abs(dx) * 0.08 + base));
    const dir = Math.sign(dx || 1);

    let sx = x1 + dir * adaptive;
    let sy = y1;
    let tx = x2 - dir * adaptive;
    let ty = y2;

    if ((dir > 0 && sx > tx) || (dir < 0 && sx < tx)) {
      const small = Math.min(adaptive, Math.max(6, Math.abs(dx) * 0.25));
      sx = x1 + dir * small;
      tx = x2 - dir * small;
    }

    const midX = (sx + tx) / 2;
    const cp1x = sx + (midX - sx) * 0.5;
    const cp2x = tx - (tx - midX) * 0.5;

    return `M ${toFixedNum(x1)} ${toFixedNum(y1)} L ${toFixedNum(sx)} ${toFixedNum(sy)} C ${toFixedNum(cp1x)} ${toFixedNum(sy)} ${toFixedNum(cp2x)} ${toFixedNum(ty)} ${toFixedNum(tx)} ${toFixedNum(ty)} L ${toFixedNum(x2)} ${toFixedNum(y2)}`;
  }

  // ---------- world style ----------
  const worldStyle = {
    transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
    transformOrigin: "0 0",
    width: worldSize.w,
    height: worldSize.h,
    position: "absolute",
    left: 0,
    top: 0,
    backgroundImage:
      `linear-gradient(0deg, rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)`,
    backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px, ${GRID_SIZE}px ${GRID_SIZE}px`,
  };

  const svgWidth = worldSize.w;
  const svgHeight = worldSize.h;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", touchAction: "none" }}>
      <div style={{ position: "absolute", right: 2, bottom: 2, zIndex: 60, display: "flex", gap: 6 }}>
        <button onClick={() => { const n = clamp(scale * 1.25, MIN_SCALE, MAX_SCALE); setScale(n); }} style={{ padding: "6px 8px" }}>+</button>
        <button onClick={() => { const n = clamp(scale / 1.25, MIN_SCALE, MAX_SCALE); setScale(n); }} style={{ padding: "6px 8px" }}>−</button>
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        onPointerDown={onCanvasPointerDown}
        style={{ width: "100%", height: "100%", position: "relative", outline: "none" }}
        className="node-canvas"
      >
        <div style={worldStyle}>
          <svg width={svgWidth} height={svgHeight} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
            {edges.map((edge) => {
              const s = nodes.find((n) => n.id === edge.sourceId);
              const t = nodes.find((n) => n.id === edge.targetId);
              if (!s || !t) return null;
              const d = getEdgePath(s, t);
              const isSelectedEdge = selectedEdgeId === edge.id;

              // visible stroke
              const visible = (
                <path
                  key={`vis-${edge.id}`}
                  d={d}
                  stroke={isSelectedEdge ? "#ACACAC" : "#2E2E2E"}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  style={{ pointerEvents: "none" }}
                />
              );

              // invisible but wide stroke for hit-testing + events
              const picker = (
                <path
                  key={`pick-${edge.id}`}
                  d={d}
                  stroke="transparent"
                  strokeWidth={16}
                  fill="none"
                  strokeLinecap="round"
                  style={{ cursor: "pointer", pointerEvents: "stroke" }}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    // ensure only the edge is selected — clear any node selection and notify parent
                    setSelectedId(null);
                    onNodeSelect?.(null);
                    setSelectedEdgeId(edge.id);
                    // do not remove automatically; parent may show controls
                  }}
                  onDoubleClick={(ev) => {
                    ev.stopPropagation();
                    // quick delete on double-click
                    setEdges(prev => prev.filter(e => e.id !== edge.id));
                    setSelectedEdgeId(null);
                    try { onEdgeRemove?.(edge); } catch (err) { console.warn("onEdgeRemove failed", err); }
                  }}
                />
              );

              return (
                <g key={`edge-group-${edge.id}`}>
                  {visible}
                  {picker}
                </g>
              );
            })}
            {connectingRef.current && (
              <path d={getTempPath()} stroke="#D9D9D9" opacity={0.9} strokeWidth={2} fill="none" strokeDasharray="6 6" strokeLinecap="round" />
            )}
          </svg>

          {nodes.map((node) => {
            const isSelected = node.id === selectedId;
            const dragging = draggingRef.current && draggingRef.current.id === node.id;
            const wrapperStyle = {
              position: "absolute",
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
              boxSizing: "border-box",
              transition: dragging ? "none" : "left 150ms ease, top 150ms ease",
              zIndex: isSelected ? 1000 : 500,
              cursor: dragging ? "grabbing" : "grab",
            };

            // Compute single incoming source preview
            let sourcePreview = null;
            try {
              const incomingEdge = edges.find((e) =>
                (e.targetId === node.id) || (e.target_node === node.id) || (e.target === node.id)
              );
              if (incomingEdge) {
                const srcId = incomingEdge.sourceId ?? incomingEdge.source_node ?? incomingEdge.source;
                if (srcId) {
                  const srcNode = nodes.find((n) => n.id === srcId);
                  if (srcNode) {
                    if (srcNode.data?.image) {
                      sourcePreview = { type: "image", src: srcNode.data.image };
                    } else if (srcNode.data?.text) {
                      sourcePreview = { type: "text" };
                    }
                  }
                }
              }
            } catch (e) {
              sourcePreview = null;
            }

            // Decide component by explicit type first
            const explicitType = node?.data?.type;
            const looksLikeText = explicitType === "text" || (!explicitType && node?.data?.text && !node?.data?.image);

            return (
              <div
                key={node.id}
                style={wrapperStyle}
                onPointerDown={(e) => onNodePointerDown(e, node)}
                onPointerUp={(e) => { try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch (_) {} }}
              >
                <div style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  borderRadius: 6,
                  boxShadow: isSelected ? "0 0 0 1px #ACACAC" : "none",
                }} />

                <div style={{ width: "100%", height: "100%" }}>
                  {looksLikeText ? (
                    <TextNode
                      node={node}
                      isSelected={isSelected}
                      sourcePreview={sourcePreview}
                      onCommit={(newText) => {
                        try {
                          // prefer imperative API update
                          ref.current?.updateNode?.(node.id, { data: { ...(node.data || {}), text: newText } });
                        } catch (err) {
                          setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, data: { ...(n.data || {}), text: newText } } : n));
                          onNodeChange?.({ ...node, data: { ...(node.data || {}), text: newText } });
                        }
                      }}
                      onStartConnection={(ev, nd, port) => startConnection(ev, nd, port)}
                      onRemove={(id) => {
                        if (onNodeRemove) onNodeRemove(id);
                        else {
                          setNodes(prev => prev.filter(n => n.id !== id));
                          setEdges(prev => prev.filter((ed) => ed.sourceId !== id && ed.targetId !== id));
                          if (selectedId === id) { setSelectedId(null); onNodeSelect?.(null); }
                        }
                      }}
                    />
                  ) : (
                    <ImageNode
                      node={node}
                      isSelected={isSelected}
                      sourcePreview={sourcePreview}
                      onRemove={(id) => {
                        if (onNodeRemove) {
                          onNodeRemove(id);
                        } else {
                          setNodes(prev => prev.filter(n => n.id !== id));
                          setEdges(prev => prev.filter((ed) => ed.sourceId !== id && ed.targetId !== id));
                          if (selectedId === id) {
                            setSelectedId(null);
                            onNodeSelect?.(null);
                          }
                        }
                      }}
                      onStartConnection={(ev, nd, port) => startConnection(ev, nd, port)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default NodeCanvas;
