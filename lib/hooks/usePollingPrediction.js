// lib/hooks/usePollingPrediction.js
import { useRef, useEffect, useCallback } from "react";

/**
 * Lightweight polling loop wrapper. Does not mutate UI; calls provided callbacks.
 *
 * Args:
 * - fetchPrediction(id, { signal }) => Promise<prediction>
 * - onUpdate(pred): called after each fetch (use to setPrediction + setImages + preview)
 * - onFinished(pred): called when status === 'succeeded' or 'failed' (final handling)
 * - pollInterval: ms (default 1200)
 *
 * Returns { start(id), stop() }.
 */
export function usePollingPrediction({ fetchPrediction, onUpdate = null, onFinished = null, pollInterval = 1200 }) {
  const controllerRef = useRef(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort?.();
      controllerRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    if (controllerRef.current?.abort) controllerRef.current.abort();
    controllerRef.current = null;
  }, []);

  const start = useCallback((id) => {
    if (!id) return;
    // avoid overlapping
    stop();
    const controller = new AbortController();
    controllerRef.current = controller;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      try {
        while (!controller.signal.aborted) {
          const pred = await fetchPrediction(id, { signal: controller.signal });
          if (onUpdate) {
            try { onUpdate(pred); } catch (e) { console.error("onUpdate callback error", e); }
          }

          if (pred.status === "succeeded" || pred.status === "failed") {
            if (onFinished) {
              try { onFinished(pred); } catch (e) { console.error("onFinished callback error", e); }
            }
            stop();
            return;
          }

          await sleep(pollInterval);
        }
      } catch (err) {
        if (err && err.name === "AbortError") {
          // aborted normally
          return;
        }
        if (onFinished) {
          // pass error object to onFinished so caller can decide
          try { onFinished({ status: "failed", error: err }); } catch (e) { console.error("onFinished error", e); }
        }
        stop();
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    })();
  }, [fetchPrediction, onUpdate, onFinished, pollInterval, stop]);

  return { start, stop };
}
