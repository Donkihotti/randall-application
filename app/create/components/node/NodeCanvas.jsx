// components/node/NodeCanvas.jsx
"use client";
import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import ImageNode from "./ImageNode";

function uid(prefix = "n_") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * NodeCanvas: custom node canvas (no React Flow)
 * - Exposes addImageNode(...) and addImageNodeAtClientPos(...)
 * - Parent can call nodeCanvasRef.current.addImageNode(...)
 */
const NodeCanvas = forwardRef(function NodeCanvas(props, ref) {
  const containerRef = useRef(null);
  const [nodes, setNodes] = useState([]); // simple array of nodes

  // Basic helper to add node (canvas coords)
  const addNode = ({ image, prompt = "", model = "", position = null, width = 260, height = 180 }) => {
    const id = uid();
    const defaultPos = { x: 40 + nodes.length * 24, y: 40 + nodes.length * 20 };
    const pos = position || defaultPos;
    const node = {
      id,
      x: pos.x,
      y: pos.y,
      width,
      height,
      data: { image, prompt, model, status: image ? "done" : "generating" },
    };
    setNodes((n) => n.concat(node));
    return id;
  };

  // Convert client coords (page) to canvas-local coords
  const clientToCanvas = ({ clientX, clientY }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 100, y: 100 };
    // account for scroll on the page
    const x = clientX - rect.left + (containerRef.current.scrollLeft || 0);
    const y = clientY - rect.top + (containerRef.current.scrollTop || 0);
    return { x: Math.max(0, x), y: Math.max(0, y) };
  };

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    addImageNode({ image, prompt, model, position }) {
      return addNode({ image, prompt, model, position });
    },
    addImageNodeAtClientPos({ image, prompt, model, clientX, clientY, width, height }) {
      const pos = clientToCanvas({ clientX, clientY });
      return addNode({ image, prompt, model, position: pos, width, height });
    },
    // optionally expose current nodes / clear API
    getNodes() {
      return nodes;
    },
    clear() {
      setNodes([]);
    },
  }), [nodes]);

  const removeNode = (id) => setNodes((s) => s.filter((n) => n.id !== id));

  // OPTIONAL: simple click handler that returns client coords (parent could use)
  const handleContainerClick = (e) => {
    if (props.onCanvasClick) {
      props.onCanvasClick({ clientX: e.clientX, clientY: e.clientY });
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className="relative w-full h-full overflow-auto"
      style={{ minHeight: 300 }}
    >
      {/* render nodes */}
      {nodes.map((node) => (
        <ImageNode key={node.id} node={node} onRemove={removeNode} />
      ))}

      {/* SVG edges layer, selection boxes etc. could go here */}
    </div>
  );
});

export default NodeCanvas;
