// Helpers that turn a SpotlightTarget descriptor into a live DOM element
// and keep an absolute-position overlay locked to that element's bounding
// box as the page scrolls / resizes / mutates.
//
// Two ways a feature step targets an element:
//   1. data-testid (default) — looked up via document.querySelector.
//      Stable enough that the same selectors back our test suite.
//   2. ref — the component registers a React ref under a stable name
//      via `registerSpotlightRef("the-name", el)`; the orchestrator
//      reads it from the global registry below. Use this for elements
//      where data-testid isn't enough (deeply virtualized lists, etc.).

import { useEffect, useRef, useState } from "react";
import type { SpotlightTarget } from "@shared/feature-spotlights";

// ── Ref registry ──────────────────────────────────────────────────────

const refRegistry = new Map<string, HTMLElement>();

export function registerSpotlightRef(name: string, el: HTMLElement | null) {
  if (el) refRegistry.set(name, el);
  else refRegistry.delete(name);
}

export function getRegisteredSpotlightRef(name: string): HTMLElement | null {
  return refRegistry.get(name) ?? null;
}

// ── Lookup ────────────────────────────────────────────────────────────

export function resolveSpotlightTarget(target: SpotlightTarget): HTMLElement | null {
  if (target.kind === "ref") return getRegisteredSpotlightRef(target.refName);
  // testid
  const escaped = CSS.escape(target.testId);
  return document.querySelector<HTMLElement>(`[data-testid="${escaped}"]`);
}

// ── Hooks ─────────────────────────────────────────────────────────────

/** Resolve a SpotlightTarget to a live DOM element. Polls briefly when
 *  the element isn't present yet (e.g. a modal is mid-mount), and via a
 *  MutationObserver when long-running. Returns null when the target has
 *  not been found (yet). */
export function useSpotlightTargetEl(
  target: SpotlightTarget | null,
  options?: { pollIntervalMs?: number; maxAttempts?: number },
): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(() => target ? resolveSpotlightTarget(target) : null);
  const pollIntervalMs = options?.pollIntervalMs ?? 200;
  const maxAttempts = options?.maxAttempts ?? 50; // ~10s

  useEffect(() => {
    if (!target) {
      setEl(null);
      return;
    }
    let attempts = 0;
    let cancelled = false;

    const tryResolve = () => {
      const found = resolveSpotlightTarget(target);
      if (found) {
        setEl(found);
        return true;
      }
      return false;
    };

    if (tryResolve()) return;

    // Mutation observer covers async DOM additions (modals mounting,
    // tabs switching). Polling is the belt-and-braces fallback for
    // testid changes inside virtualized scrollers we may not observe.
    const obs = new MutationObserver(() => {
      if (cancelled) return;
      if (tryResolve()) {
        obs.disconnect();
        clearInterval(timer);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    const timer = setInterval(() => {
      if (cancelled) return;
      attempts++;
      if (tryResolve() || attempts >= maxAttempts) {
        clearInterval(timer);
        obs.disconnect();
      }
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      obs.disconnect();
      clearInterval(timer);
    };
  }, [target ? targetKey(target) : null, pollIntervalMs, maxAttempts]);

  // Re-resolve if the existing element gets removed from the DOM (e.g.
  // tab switched away). Keeps the overlay accurate.
  useEffect(() => {
    if (!el) return;
    const obs = new MutationObserver(() => {
      if (!document.body.contains(el)) {
        setEl(target ? resolveSpotlightTarget(target) : null);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [el, target ? targetKey(target) : null]);

  return el;
}

/** Track an element's bounding rect across scroll, resize, and
 *  size/layout changes. Returns the current rect or null. */
export function useElementRect(el: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(() => (el ? el.getBoundingClientRect() : null));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!el) {
      setRect(null);
      return;
    }
    const update = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setRect(el.getBoundingClientRect());
      });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    // Catch ancestor scroll containers — listen on the window with
    // capture so any ancestor scroll triggers a recompute.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    // The element might move without resizing (sibling layout shift).
    // Cheap interval is enough for a single coachmark; a fancier
    // observer isn't worth the complexity.
    const interval = setInterval(update, 250);

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      clearInterval(interval);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [el]);

  return rect;
}

/** Scroll an element into view, if it isn't already, before showing a
 *  spotlight bubble against it. */
export function ensureInView(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const inView = rect.top >= 0 && rect.left >= 0 && rect.bottom <= vh && rect.right <= vw;
  if (!inView) {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }
}

function targetKey(t: SpotlightTarget): string {
  return t.kind === "ref" ? `ref:${t.refName}` : `testid:${t.testId}`;
}
