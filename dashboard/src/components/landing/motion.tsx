"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page's movement, in about a hundred lines and no dependencies.
 *
 * The workspace has its own motion system, but it reads the operator's theme
 * to decide how much to move and whether to move at all. This page is public
 * and cannot borrow a setting somebody else owns, so it brings its own.
 *
 * Everything below degrades to plain static markup: the page is rendered on the
 * server, and these only ever add a data attribute that CSS reacts to. A
 * visitor with JavaScript off, or a crawler, gets the whole page and none of
 * the movement, which is the right way round.
 */

const REDUCED = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Shows its children once they have been scrolled to.
 *
 * `once: true` on the observer, because a section that re-animates every time
 * it passes the viewport is a section nobody can read on the way back up.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "figure";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (REDUCED()) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      // A little before it arrives, so the movement finishes as it lands rather
      // than starting once it is already in the middle of the screen.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={`l-reveal ${className}`}
      data-shown={shown ? "true" : "false"}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * Counts up to a number when it is first seen.
 *
 * The figure is in the markup from the start, so what a crawler reads and what
 * somebody with motion turned off sees is the final number, not a zero.
 */
export function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const node = ref.current;
    if (!node || REDUCED()) return;

    setValue(0);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const DURATION = 1100;
        const start = performance.now();
        let frame = 0;
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION);
          // Ease out, so it decelerates into the real figure instead of
          // stopping dead on it.
          setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [to]);

  return (
    <span ref={ref}>
      {value.toLocaleString("en-NG")}
      {suffix}
    </span>
  );
}

/** Gives the header a background once the page has been scrolled at all. */
export function StickyHeader({ children }: { children: React.ReactNode }) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="l-head" data-stuck={stuck ? "true" : "false"}>
      <div className="l-wrap l-head-in">{children}</div>
    </header>
  );
}

/**
 * The hero screenshot, which straightens up as you scroll past it.
 *
 * It starts tilted back and settles flat, which is enough to make the page feel
 * like it is made of layers without anything sliding about. The work is done in
 * a transform on a single element, so it composites and never reflows.
 */
export function HeroShot({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || REDUCED()) return;

    let ticking = false;
    const apply = () => {
      ticking = false;
      const top = node.getBoundingClientRect().top;
      // 1 at the moment it enters, 0 once it has risen to the top third.
      const progress = Math.min(1, Math.max(0, top / (window.innerHeight * 0.9)));
      node.style.transform = `perspective(1800px) rotateX(${(progress * 7).toFixed(2)}deg) scale(${(
        0.99 + (1 - progress) * 0.01
      ).toFixed(4)})`;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div ref={ref} className="l-hero-shot">
      {children}
    </div>
  );
}
