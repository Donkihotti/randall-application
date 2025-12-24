// components/node/ImageNode.jsx
import React from "react";

export default function ImageNode({ node, onRemove }) {
  // node = { id, x, y, width, height, data: { image, prompt, model, status } }
  const { data = {} } = node;
  return (
    <div
      className="absolute bg-white border rounded-md shadow overflow-hidden"
      style={{
        left: node.x,
        top: node.y,
        width: node.width ?? 220,
        height: node.height ?? 160,
        boxSizing: "border-box",
      }}
      data-node-id={node.id}
    >
      <div className="flex items-center justify-between px-2 py-1 bg-slate-50 border-b text-xs">
        <div className="truncate">{data.model ?? "model"}</div>
        <button onClick={() => onRemove?.(node.id)} className="text-xs px-2">✕</button>
      </div>

      <div className="w-full h-full bg-slate-100 flex items-center justify-center">
        {data.image ? (
          <img src={data.image} alt={data.prompt ?? "generated"} className="w-full h-full object-cover" />
        ) : (
          <div className="text-xs text-slate-500 p-2">
            {data.status === "generating" ? "Generating…" : "No image"}
          </div>
        )}
      </div>

      <div className="px-2 py-1 text-xs text-slate-600 border-t">{data.prompt ?? ""}</div>
    </div>
  );
}
