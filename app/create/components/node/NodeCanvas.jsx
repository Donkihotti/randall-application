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

function uid(prefix = "n_") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const NodeCanvas = forwardRef(function NodeCanvas({ onNodeSelect }, ref) {
  const containerRef = useRef(null);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

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

  // large virtual world size that grows with nodes
  const [worldSize, setWorldSize] = useState({ w: 3000, h: 2000 });

  // coordinate helpers
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

  // recompute world size to keep canvas roomy
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

  // imperative API
  useImperativeHandle(ref, () => ({
    addImageNode({ image = null, prompt = "", model = "", position = null, width = 260, height = 180 }) {
      const id = uid();
      const defaultPos = { x: 80 + nodes.length * 40, y: 80 + nodes.length * 30 };
      const pos = position || defaultPos;
      const node = { id, x: pos.x, y: pos.y, width, height, data: { image, prompt, model, status: image ? "done" : "empty" } };
      setNodes((prev) => [...prev, node]);
      requestAnimationFrame(() => {
        setSelectedId(id);
        onNodeSelect?.(node);
      });
      return id;
    },

    addImageNodeAtClientPos({ image = null, prompt = "", model = "", clientX, clientY, width = 260, height = 180 }) {
      const world = clientToWorld({ clientX, clientY });
      return ref.current?.addImageNode?.({ image, prompt, model, position: world, width, height });
    },

    updateNode(id, patch = {}) {
      setNodes((prev) => prev.map((n) => {
        if (n.id !== id) return n;
        const merged = { ...n, ...patch };
        merged.data = { ...(n.data || {}), ...(patch.data || {}) };
        return merged;
      }));
      requestAnimationFrame(() => {
        setSelectedId(id);
        const updated = ref.current?.getNodes?.()?.find((nn) => nn.id === id) ?? null;
        if (updated) onNodeSelect?.(updated);
      });
      return id;
    },

    addEdge({ sourceId, targetId }) {
        if (!sourceId || !targetId) return null;
        // ensure source and target exist
        const srcExists = nodes.some(n => n.id === sourceId);
        const tgtExists = nodes.some(n => n.id === targetId);
        if (!srcExists || !tgtExists) {
          console.warn('addEdge: source or target does not exist', { sourceId, targetId });
          return null;
        }
        // avoid duplicates
        const exists = edges.some(e => e.sourceId === sourceId && e.targetId === targetId);
        if (exists) return null;
        const edgeId = uid('edge_');
        setEdges(prev => [...prev, { id: edgeId, sourceId, targetId }]);
        return edgeId;
      },
      
      removeNode(id) {
        if (!id) return;
        setNodes(prev => prev.filter(n => n.id !== id));
        // remove edges touching the node
        setEdges(prev => prev.filter(e => e.sourceId !== id && e.targetId !== id));
        // clear selection if it was selected
        setSelectedId(prev => {
          if (prev === id) {
            onNodeSelect?.(null);
            return null;
          }
          return prev;
        });
        return id;
      },

    getNodes() {
      return nodes;
    },

    getEdges() {
      return edges;
    },

    clear() {
      setNodes([]);
      setEdges([]);
      setSelectedId(null);
      onNodeSelect?.(null);
    },
  }), [nodes, edges, onNodeSelect, clientToWorld]);

  // port coordinates (center-left or center-right in world coords)
  function getPortWorld(node, port) {
    if (!node) return { x: 0, y: 0 };
    const width = node.width ?? 260;
    const height = node.height ?? 180;
    if (port === "output") {
      return { x: node.x + width, y: node.y + height / 2 };
    } else {
      // input
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

  // global pointer handlers
  useEffect(() => {
    const onPointerMove = (e) => {
      // connecting preview
      if (connectingRef.current) {
        const w = clientToWorld({ clientX: e.clientX, clientY: e.clientY });
        setConnectingTargetWorld(w);
        const hit = nodeAtWorld(w.x, w.y);
        setConnectHoverNode(hit?.id ?? null);
        return;
      }

      // dragging node
      if (draggingRef.current) {
        const d = draggingRef.current;
        const dxClient = e.clientX - d.startClientX;
        const dyClient = e.clientY - d.startClientY;
        let nx = d.originX + dxClient / scale;
        let ny = d.originY + dyClient / scale;

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

      // panning
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
          const exists = edges.some((ed) => ed.sourceId === sourceId && ed.targetId === hit.id);
          if (!exists) {
            setEdges((prev) => [...prev, { id: uid("edge_"), sourceId, targetId: hit.id }]);
          }
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
  }, [clientToWorld, nodes, edges, scale, translate]);

  // node pointer down (drag) — if currently connecting, ignore drag
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
    onNodeSelect?.(node);
  };

  // canvas pointer down -> panning with left button on background
  const onCanvasPointerDown = (e) => {
    const wantPan = e.button === 0 || e.button === 1 || spacePressedRef.current;
    if (!wantPan) {
      setSelectedId(null);
      onNodeSelect?.(null);
      return;
    }
    e.preventDefault();
    try { containerRef.current.setPointerCapture?.(e.pointerId); } catch (_) {}
    panningRef.current = { startClientX: e.clientX, startClientY: e.clientY, originTranslate: { ...translate } };
  };

  // wheel (non-passive) to prevent browser zoom; zoom canvas instead
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
      const factor = Math.exp(delta * 0.0086);
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

  // spacebar pan toggle
  useEffect(() => {
    const isTypingInEditable = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      // ignore when focus is inside any standard input or contenteditable element
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    };
  
    const onKeyDown = (e) => {
      // Ignore IME/composition
      if (e.isComposing) return;
      // Only handle space when user is NOT typing into a control
      if (e.code === "Space" && !isTypingInEditable()) {
        spacePressedRef.current = true;
        containerRef.current?.classList?.add("cursor-grab");
        // Prevent default only when we intentionally use Space for pan — do not prevent when typing
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

  // start a connection from node's port (only 'output' allowed)
  function startConnection(e, node, port) {
    e.preventDefault();
    e.stopPropagation();
    if (port !== "output") return;
    const srcPortWorld = getPortWorld(node, "output");
    connectingRef.current = { sourceId: node.id, sourcePortWorld: srcPortWorld };
    setConnectingTargetWorld(srcPortWorld);
    setConnectHoverNode(null);
  }

  // edge path (curve) between right-port (source) and left-port (target)
  function getEdgePath(sourceNode, targetNode) {
    if (!sourceNode || !targetNode) return "";
    const s = getPortWorld(sourceNode, "output"); // right port
    const t = getPortWorld(targetNode, "input");  // left port
  
    let x1 = +s.x, y1 = +s.y, x2 = +t.x, y2 = +t.y;
    const dx = x2 - x1;
    const dy = y2 - y1;
  
    // trivial case
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
  
    // Outset length: small but adaptive, capped
    const base = 0.5; // minimum outset
    const adaptive = Math.min(36, Math.max(base, Math.abs(dx) * 0.05 + base));
    const dir = Math.sign(dx || 1);
  
    // source and target "inset" points (a short straight run from each port)
    let sx = x1 + dir * adaptive;
    let sy = y1;
    let tx = x2 - dir * adaptive;
    let ty = y2;
  
    // If the outset would cross (very close nodes), reduce it so segments don't cross-over
    if ((dir > 0 && sx > tx) || (dir < 0 && sx < tx)) {
      const small = Math.min(adaptive, Math.max(6, Math.abs(dx) * 0.25));
      sx = x1 + dir * small;
      tx = x2 - dir * small;
    }
  
    // Build path:
    // 1) straight from port to outset (keeps immediate part straight)
    // 2) smooth cubic from outset to target outset
    // 3) straight into target port
    const midX = (sx + tx) / 2;
    const cp1x = sx + (midX - sx) * 0.5;
    const cp2x = tx - (tx - midX) * 0.5;
  
    // Format numbers to reduce messy floats in DOM (optional)
    const f = (n) => Number(n.toFixed(2));
  
    return `M ${f(x1)} ${f(y1)} L ${f(sx)} ${f(sy)} C ${f(cp1x)} ${f(sy)} ${f(cp2x)} ${f(ty)} ${f(tx)} ${f(ty)} L ${f(x2)} ${f(y2)}`;
  }
  

  function getTempPath() {
    if (!connectingRef.current || !connectingTargetWorld) return "";
    const src = connectingRef.current.sourcePortWorld;
    const t = connectingTargetWorld;
  
    let x1 = +src.x, y1 = +src.y, x2 = +t.x, y2 = +t.y;
    const dx = x2 - x1;
  
    if (Math.abs(dx) < 0.5 && Math.abs(y2 - y1) < 0.5) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
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
    const f = (n) => Number(n.toFixed(2));
  
    return `M ${f(x1)} ${f(y1)} L ${f(sx)} ${f(sy)} C ${f(cp1x)} ${f(sy)} ${f(cp2x)} ${f(ty)} ${f(tx)} ${f(ty)} L ${f(x2)} ${f(y2)}`;
  }
  

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

  // SVG dims in world coords
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
          {/* edges SVG */}
          <svg width={svgWidth} height={svgHeight} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
            {/* existing edges (plain lines, no arrows) */}
            {edges.map((edge) => {
              const s = nodes.find((n) => n.id === edge.sourceId);
              const t = nodes.find((n) => n.id === edge.targetId);
              if (!s || !t) return null;
              const d = getEdgePath(s, t);
              return <path key={edge.id} d={d} stroke="#D9D9D9" strokeWidth={2} fill="none" strokeLinecap="round" />;
            })}

            {/* temporary connection preview */}
            {connectingRef.current && (
              <path d={getTempPath()} stroke="#D9D9D9" opacity={90} strokeWidth={2} fill="none" strokeDasharray="6 6" strokeLinecap="round" />
            )}
          </svg>

          {/* nodes */}
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
                  borderRadius: 8,
                  boxShadow: isSelected ? "0 0 0 3px rgba(59,130,246,0.18)" : "none",
                }} />

                <div style={{ width: "100%", height: "100%" }}>
                  <ImageNode
                    node={node}
                    isSelected={isSelected}
                    onRemove={(id) => {
                      setNodes((prev) => prev.filter((n) => n.id !== id));
                      setEdges((prev) => prev.filter((ed) => ed.sourceId !== id && ed.targetId !== id));
                      if (selectedId === id) { setSelectedId(null); onNodeSelect?.(null); }
                    }}
                    onStartConnection={(ev, nd, port) => startConnection(ev, nd, port)}
                  />
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
