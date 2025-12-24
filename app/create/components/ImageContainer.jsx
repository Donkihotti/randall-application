// ImageContainer.jsx
import React from 'react';

export default function ImageContainer({
  aspect = '1:1',
  src = null,
  alt = 'preview',
  className = '',
  maxWidth = '100%',
  maxHeight = '55vh',
}) {
  const { w, h } = parseRatio(aspect);
  const aspectStyle = { aspectRatio: `${w} / ${h}` };

  const widthExpr = `min(100%, calc(${maxHeight} * ${w} / ${h}))`;

  const wrapperStyle = {
    // set width to the min(...) expression, center it with margin auto
    width: widthExpr,
    // ensure aspect-ratio is honored
    aspectRatio: `${w} / ${h}`,
    marginLeft: "auto",
    marginRight: "auto",
    // allow the parent to control layout but keep the size constraints above
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  const isEmpty = !src;

  function parseRatio(ratio = '1:1') {
    if (typeof ratio !== 'string') return { w: 1, h: 1 };
    const parts = ratio.split(':').map(s => parseInt(s, 10));
    if (parts.length !== 2 || parts.some(n => !Number.isFinite(n) || n <= 0)) {
      return { w: 1, h: 1 };
    }
    return { w: parts[0], h: parts[1] };
  }

  return (
    <div
      className={`w-full ${className}`}
      style={{ ...aspectStyle, maxWidth, maxHeight }}
    >
      <div style={wrapperStyle} className={`w-full h-full relative overflow-hidden rounded-xs ${isEmpty ? 'border border-dashed border-border-main' : ''}`}>
        {isEmpty ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-main-white">
            <div className="mb-1">{aspect}</div>
            <div className="text-xs">Your image will appear here</div>
          </div>
        ) : (
          <img
            src={src}
            alt={alt}
            className="w-full h-full object-contain block"
            loading="lazy"
          />
        )}
      </div>
    </div>
  );
}