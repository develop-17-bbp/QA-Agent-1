/**
 * AnimatedNumber — smooth count-up when a numeric value changes. Uses
 * requestAnimationFrame + ease-out curve (~500ms). Respects
 * prefers-reduced-motion. Keeps layout stable via tabular-nums.
 *
 *   <AnimatedNumber value={2400} format={(n) => n.toLocaleString()} />
 *   <AnimatedNumber value={12.4} format={(n) => `${n.toFixed(1)}%`} />
 */

import { useEffect, useRef, useState } from "react";

export interface AnimatedNumberProps {
  value: number | null | undefined;
  /** Override the default toLocaleString formatting. */
  format?: (n: number) => string;
  /** Animation duration in ms. Default 500. */
  durationMs?: number;
  /** Placeholder when value is null/undefined. Default "—". */
  placeholder?: string;
}

const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function AnimatedNumber({ value, format, durationMs = 500, placeholder = "—" }: AnimatedNumberProps) {
  const [display, setDisplay] = useState<number | null>(typeof value === "number" && Number.isFinite(value) ? value : null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      setDisplay(null);
      return;
    }
    if (prefersReducedMotion() || durationMs <= 0) {
      setDisplay(value);
      return;
    }
    const from = typeof display === "number" && Number.isFinite(display) ? display : value;
    if (from === value) {
      setDisplay(value);
      return;
    }
    fromRef.current = from;
    startRef.current = null;

    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = EASE_OUT_CUBIC(progress);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplay(next);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  if (display === null) {
    return <span style={{ fontVariantNumeric: "tabular-nums" }}>{placeholder}</span>;
  }
  const text = format ? format(display) : display.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(display) ? 0 : 1 });
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{text}</span>;
}
