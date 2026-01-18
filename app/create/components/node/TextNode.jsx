// components/node/TextNode.jsx
"use client";
import React, { useEffect, useRef, useState } from "react";

/**
 * TextNode - lightweight presentational text node with editable content and connection ports.
 *
 * Props:
 *  - node: { id, data: { text, type, ... }, width, height, ... }
 *  - isSelected: boolean
 *  - onCommit(newText) -> called when user finishes editing (blur or Enter)
 *  - onStartConnection(ev, node, port) -> (port: 'output'|'input')
 *  - onRemove(id)
 *  - sourcePreview: { type: 'image'|'text', src?: string } | null
 */
export default function TextNode({
  node,
  isSelected = false,
  onCommit,
  onStartConnection,
  onRemove,
  sourcePreview = null,
}) {
  const textRef = useRef(null);
  const [value, setValue] = useState(() => (node?.data?.text ?? ""));
  const lastNodeTextRef = useRef(node?.data?.text ?? "");

  useEffect(() => {
    const nText = node?.data?.text ?? "";
    if (nText !== lastNodeTextRef.current) {
      lastNodeTextRef.current = nText;
      setValue(nText);
      if (textRef.current && textRef.current.textContent !== nText) {
        textRef.current.textContent = nText;
      }
    }
  }, [node?.data?.text, node?.id]);

  useEffect(() => {
    if (isSelected && textRef.current) {
      textRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(textRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [isSelected]);

  function commit() {
    const txt = (textRef.current?.textContent ?? "").trim();
    lastNodeTextRef.current = txt;
    setValue(txt);
    if (typeof onCommit === "function") onCommit(txt);
  }

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      textRef.current?.blur?.();
    } else if (e.key === "Escape") {
      if (textRef.current) textRef.current.textContent = lastNodeTextRef.current || "";
      textRef.current?.blur?.();
    }
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
      style={{
        width: "100%",
        height: "100%",
        padding: 6,
        boxSizing: "border-box",
        borderRadius: 6,
        background: "#0b0b0b",
        color: "#e6e6e6",
        display: "flex",
        alignItems: "stretch",
        position: "relative",
        overflow: "hidden",
      }}
      data-node-id={node.id}
    >
      {/* input port — centered vertically */}
      <div
        data-port="input"
        onPointerDown={(e) => { e.stopPropagation(); /* we don't start connections from input by default */ }}
        style={{
          ...portStyleBase,
          left: -8,
          top: "50%",
          transform: "translateY(-50%)",
          background: "#fff",
          border: "2px solid rgba(15,23,42,0.06)",
        }}
        title="Input port"
      >
        <div style={{ width: 6, height: 6, borderRadius: 3, background: "#9ca3af" }} />
      </div>

      {/* editable text area */}
      <div
        ref={textRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => setValue(e.currentTarget.textContent ?? "")}
        onBlur={commit}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          height: "100%",
          outline: isSelected ? "1px solid #ACACAC" : "none",
          paddingLeft: 6,
          paddingRight: 6,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          fontSize: 13,
          lineHeight: "1.2",
        }}
        role="textbox"
        aria-multiline="true"
      >
        {value}
      </div>

      {/* output port — centered vertically */}
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

      {/* small source preview badge (if connected) */}
      {sourcePreview && (
        <div style={{ position: "absolute", left: 6, bottom: 6, width: 36, height: 36, borderRadius: 4, overflow: "hidden", zIndex: 60 }}>
          {sourcePreview.type === "image" ? (
            <img src={sourcePreview.src} alt="source" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#111", color: "#fff", fontWeight: 700 }}>
              T
            </div>
          )}
        </div>
      )}

      {/* optional small remove button top-right (parent can also render a remove control) */}
      <button
        type="button"
        onClick={() => onRemove?.(node.id)}
        title="Remove node"
        style={{
          position: "absolute",
          right: 6,
          top: 6,
          width: 20,
          height: 20,
          borderRadius: 4,
          background: "transparent",
          color: "#aaa",
          border: "none",
          cursor: "pointer",
          zIndex: 70,
        }}
      >
        ×
      </button>
    </div>
  );
}
