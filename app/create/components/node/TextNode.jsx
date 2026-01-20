// components/node/TextNode.jsx
"use client";
import React, { useState, useEffect } from "react";
import ConnectPort from "./ConnectPort";

/**
 * TextNode — simple textarea-based text node.
 * Props:
 *  - node: { id, x, y, width, height, data: { text, type, ... } }
 *  - isSelected: boolean
 *  - onCommit(newText)
 *  - onStartConnection(ev, node, port)
 *  - onRemove(id)
 *  - sourcePreview: { type: "image"|"text", src? }
 */
export default function TextNode({ node, isSelected = false, onCommit, onStartConnection, onRemove, sourcePreview = null }) {
  const { data = {} } = node;
  const initial = typeof data.text === "string" ? data.text : "";
  const [text, setText] = useState(initial);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    // when external updates happen, reflect them
    if (data && typeof data.text === "string" && data.text !== text) {
      setText(data.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.text]);

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

  const handleCommit = () => {
    const trimmed = typeof text === "string" ? text : "";
    if (typeof onCommit === "function") onCommit(trimmed);
  };

  return (
    <>
    <div
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 8,
        overflow: "hidden",
        userSelect: "text",
        position: "relative",
      }}
      className="bg-main"
      data-node-id={node.id}
    >
      {/* INPUT PORT */}
      <div
        data-port="input"
        onPointerDown={(e) => {
          e.stopPropagation();
          // keep pointer events
        }}
        style={{
          ...portStyleBase,
          left: -7,
          top: "50%",
          transform: "translateY(-50%)",
          background: "#fff",
          border: "2px solid rgba(15,23,42,0.06)",
        }}
        title="Input port"
      >
      </div>

      {/* Text area */}
      <div style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch", justifyContent: "flex-start" }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              // commit on Ctrl+Enter
              handleCommit();
            }
          }}
          placeholder="Type prompt text"
          style={{
            width: "100%",
            height: "100%",
            resize: "none",
            border: "none",
            outline: "none",
            background: "transparent",
            color: "#fff",
            direction: "ltr", 
            fontSize: 13,
            lineHeight: 1.3,
            fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
          }}
        />
      </div>

      {/* OUTPUT PORT */}
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

      {/* Hover prompt preview */}
      {isHovering && data?.text && (
        <div style={{ position: "absolute", left: 6, bottom: 6, zIndex: 60, background: "#fff", padding: 6, borderRadius: 6, boxShadow: "0 1px 6px rgba(0,0,0,0.12)" }}>
          <div style={{ maxWidth: 140, fontSize: 12, color: "#111" }}>{data.text}</div>
        </div>
      )}

      {/* source preview (image or T badge) */}
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
    </div>
    </>
  );
}
