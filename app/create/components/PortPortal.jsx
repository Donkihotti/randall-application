"use client";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function PortPortal({ anchorRef, offset = { x: -8, y: 0 }, children }) {
  const [container, setContainer] = useState(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const el = document.getElementById("node-ports");
    setContainer(el || null);
  }, []);

  useEffect(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    // convert to canvas coordinates if necessary (add scroll)
    setPos({
      left: rect.left + window.scrollX + offset.x,
      top: rect.top + window.scrollY + rect.height / 2 + offset.y,
    });
  }, [anchorRef, offset]);

  if (!container) return null;

  return createPortal(
    <div
      style={{
        position: "absolute",
        left: pos.left,
        top: pos.top,
        transform: "translate(-50%, -50%)",
        pointerEvents: "auto",
        zIndex: 1000,
      }}
    >
      {children}
    </div>,
    container
  );
}
