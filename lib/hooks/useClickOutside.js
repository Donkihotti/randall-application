// lib/hooks/useClickOutside.js
import { useEffect, useCallback } from "react";

/**
 * useClickOutside(ref, onOutside, { enabled = true, ignoreRefs = [] })
 *
 * Uses bubble-phase pointerdown (or mousedown/touch fallback) so normal click ordering isn't broken.
 */
export default function useClickOutside(ref, onOutside, { enabled = true, ignoreRefs = [] } = {}) {
  const handler = useCallback(
    (ev) => {
      if (!enabled) return;
      try {
        const root = ref?.current;
        if (!root) return;

        const target = ev.target;

        // If event is composed (shadow DOM), use composedPath for robust containment checks
        const path = ev.composedPath ? ev.composedPath() : (ev.path || []);
        const insideRoot = path.length ? path.includes(root) : root.contains(target);

        if (insideRoot) return;

        // If event target is inside any of the ignoreRefs, ignore as well
        for (const r of (ignoreRefs || [])) {
          if (!r || !r.current) continue;
          const insideIgnore = path.length ? path.includes(r.current) : r.current.contains(target);
          if (insideIgnore) return;
        }

        onOutside?.(ev);
      } catch (err) {
        // swallow errors to avoid breaking UX
      }
    },
    [ref, onOutside, enabled, ignoreRefs]
  );

  useEffect(() => {
    if (!enabled) return;

    // prefer pointerdown (covers mouse/touch/stylus). fallback to mousedown/touchstart for older browsers.
    const usePointer = typeof window !== "undefined" && "PointerEvent" in window;
    if (usePointer) {
      document.addEventListener("pointerdown", handler, false);
    } else {
      document.addEventListener("mousedown", handler, false);
      document.addEventListener("touchstart", handler, false);
    }

    const onKey = (e) => {
      if (e.key === "Escape") onOutside?.(e);
    };
    document.addEventListener("keydown", onKey, false);

    return () => {
      if (usePointer) {
        document.removeEventListener("pointerdown", handler, false);
      } else {
        document.removeEventListener("mousedown", handler, false);
        document.removeEventListener("touchstart", handler, false);
      }
      document.removeEventListener("keydown", onKey, false);
    };
  }, [handler, enabled, onOutside]);
}
