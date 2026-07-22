"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

/**
 * Shared motion utilities. Every hook cleans up after itself (tweens
 * killed, listeners removed) so navigating between pages never leaks
 * memory or leaves orphaned rAF loops. All of them respect
 * prefers-reduced-motion.
 */

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animates a number up/down to `value` without re-rendering React on every
 * frame: the tween writes straight to the DOM node. The node keeps
 * `tabular-nums` sizing stable, so the card never changes width mid-count.
 */
export function useCountUp(value: number, format: (n: number) => string = (n) => Math.round(n).toLocaleString()) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = useRef({ current: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      state.current.current = value;
      el.textContent = format(value);
      return;
    }
    const tween = gsap.to(state.current, {
      current: value,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = format(state.current.current);
      },
    });
    return () => {
      tween.kill();
    };
    // format is intentionally not a dependency; treat it as stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return ref;
}

/**
 * Pointer-tracked 3D tilt for cards. Fine pointers only (no tilt on touch),
 * GPU-composited transforms only, and everything is torn down on unmount.
 */
export function useTilt<T extends HTMLElement>(maxDeg = 7) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    gsap.set(el, { transformPerspective: 900, transformStyle: "preserve-3d", willChange: "transform" });
    const toRx = gsap.quickTo(el, "rotationX", { duration: 0.35, ease: "power2.out" });
    const toRy = gsap.quickTo(el, "rotationY", { duration: 0.35, ease: "power2.out" });
    const toS = gsap.quickTo(el, "scale", { duration: 0.3, ease: "power2.out" });

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      toRx(-py * maxDeg);
      toRy(px * maxDeg);
      toS(1.015);
    };
    const leave = () => {
      toRx(0);
      toRy(0);
      toS(1);
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(el);
      gsap.set(el, { clearProps: "transform,willChange" });
    };
  }, [maxDeg]);

  return ref;
}

/**
 * Polling that respects the tab's visibility: paused while hidden, fires
 * immediately on return. Interval and listener are both cleaned up.
 */
export function useVisiblePolling(fn: () => void, ms: number) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) saved.current();
    };
    const id = setInterval(tick, ms);
    const onVisible = () => {
      if (!document.hidden) saved.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms]);
}

/**
 * Ambient background: slow-drifting gradient blobs, transform/opacity only
 * so it stays on the compositor. Static under reduced motion. Tweens are
 * reverted on unmount.
 */
export function AnimatedBackground() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.to("[data-blob='1']", { x: 90, y: 60, scale: 1.15, duration: 22, yoyo: true, repeat: -1, ease: "sine.inOut" });
      gsap.to("[data-blob='2']", { x: -70, y: 90, scale: 0.9, duration: 26, yoyo: true, repeat: -1, ease: "sine.inOut" });
      gsap.to("[data-blob='3']", { x: 60, y: -80, scale: 1.1, duration: 30, yoyo: true, repeat: -1, ease: "sine.inOut" });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div data-blob="1" className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-brand-500/10 blur-3xl" />
      <div data-blob="2" className="absolute top-1/3 -right-40 h-96 w-96 rounded-full bg-cta-500/10 blur-3xl" />
      <div data-blob="3" className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-purple-500/10 blur-3xl" />
    </div>
  );
}
