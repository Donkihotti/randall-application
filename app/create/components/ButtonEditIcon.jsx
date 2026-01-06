import { useState } from "react";
import Image from "next/image";

/**
 * Props:
 * - src, alt, width, height : next/image props
 * - label : optional overlay label shown on the icon when hovered
 * - tooltip : text shown above the icon on hover/focus
 * - prompt : a string payload the component will pass to onClick (e.g. "Prompt")
 * - onClick : function(prompt) => void
 * - onMouseEnter, onMouseLeave : optional callbacks
 */
export default function ButtonEditIcon({
  src,
  alt = "icon",
  width = 24,
  height = 24,
  label = null,
  tooltip = "tool",
  prompt = "",
  onClick,
  onMouseEnter,
  onMouseLeave,
  disabled = false,
  className = "",
  labelClassName = "",
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isKeyboardFocus, setIsKeyboardFocus] = useState(false);

  const handleEnter = (e) => {
    setIsHovered(true);
    if (typeof onMouseEnter === "function") onMouseEnter(e);
  };

  const handleLeave = (e) => {
    setIsHovered(false);
    if (typeof onMouseLeave === "function") onMouseLeave(e);
  };

  const activate = (e) => {
    if (disabled) return;
    if (typeof onClick === "function") onClick(prompt);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(e);
    }
  };

  return (
    <div className={`relative inline-block group ${className}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        className={`w-7 h-7 flex items-center justify-center rounded-xs border border-border-main relative ${
          disabled ? "opacity-50 pointer-events-none" : "cursor-pointer"
        }`}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={() => setIsKeyboardFocus(true)}
        onBlur={() => setIsKeyboardFocus(false)}
        onKeyDown={handleKeyDown}
        onClick={activate}
        title={tooltip}
      >
        <Image src={src} alt={alt} width={width} height={height} />
      </div>
    </div>
  );
}
