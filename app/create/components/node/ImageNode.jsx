// components/node/ImageNode.jsx
import React, { useState } from "react";
import ButtonGenerateRound from "../ButtonGenerateRound";
/**
 * Presentational ImageNode — does NOT position itself.
 * Props:
 *  - node: { id, x, y, width, height, data: { image, prompt, model, status } }
 *  - isSelected: boolean
 *  - onRemove(id)
 *  - onStartConnection(ev, node, port) // port: 'output'|'input'
 */
export default function ImageNode({ node, isSelected = false, onRemove, onStartConnection, sourcePreview = null }) {
    const { data = {} } = node;
    const { image, prompt, model, status } = data;
    const [ isHovering, setIsHovering ] = useState(false);

  const handleMouseEnter = () => { 
    setIsHovering(true); 
  }
  const handleMouseLeave = () => { 
    setIsHovering(false); 
  }

  const portStyleBase = {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 30,
    boxSizing: "border-box",
    userSelect: "none",
  };

  return (
    <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        borderRadius: 8,
        overflow: "hidden",
        userSelect: "none",
        position: "relative", 
      }}
      data-node-id={node.id}
    >
     {/* INPUT port (left) */}
<div
  role="button"
  aria-label="Input port"
  onPointerDown={(ev) => {
    ev.stopPropagation();
    // If you want clicking the port to start connecting *to* this node,
    // call parent onStartConnection? Typically startConnection is for outputs,
    // so input might be used for dropping; adapt if your logic differs.
  }}
  style={{
    position: "absolute",
    left: -10,            // 5px outside node body + hit area
    top: "50%",
    transform: "translateY(-50%)",
    width: 14,
    height: 14,
    borderRadius: 999,
    background: "#fff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 1500,
  }}
>
  <div style={{ width: 6, height: 6, borderRadius: 999, background: "#2E2E2E" }} />
</div>

      {/* image area */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", }} className="bg-main">
        {image ? (
          <img
            src={image}
            alt={prompt ?? "generated"}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover",  display: "block" }}
            draggable={false}
          />
        ) : (
          <div style={{ textAlign: "center", fontSize: 12, padding: 8, color: '#6F6F6F' }} className="bg-main">
            {status === "generating" ? "Generating…" : ""}
          </div>
        )}
      </div>

      {/* RIGHT (output) port — CENTERED vertically */}
      <div
        data-port="output"
        onPointerDown={(e) => {
          e.stopPropagation();
          onStartConnection?.(e, node, "output");
        }}
        style={{
          ...portStyleBase,
          right: -8,
          top: "50%",
          transform: "translateY(-50%)",
          background: "#e6eefc",
          border: "1px solid rgba(59,130,246,0.6)",
          cursor: "crosshair",
        }}
        title="Start connection"
      >
        <div style={{ width: 7, height: 7, borderRadius: 3.5, background: "#3b82f6" }} />
      </div>
      { isHovering && ( 
        <div className="w-24 flex flex-row">
             {sourcePreview && (
        <div style={{ position: "absolute", left: 6, bottom: 6, width: 45, height: 45, borderRadius: 2, overflow: "hidden", zIndex: 60, boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }}>
          {sourcePreview.type === "image" ? (
            <img src={sourcePreview.src} alt="source" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#111", color: "#fff", fontWeight: 700 }}>
              T
            </div>
          )}
        </div>
      )}
        <ButtonGenerateRound className="absolute bottom-1.5 right-1.5"/>
        </div>
      )}
    </div>
  );
}
