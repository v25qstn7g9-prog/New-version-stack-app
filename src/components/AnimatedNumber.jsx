import { useState, useEffect, useRef } from "react";
import { nf } from "../lib/helpers.js";

function AnimatedNumber({ value, prefix = "" }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(null);
  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const duration = 500;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);
  return <span>{prefix}{nf(display)}</span>;
}

// ---------- date helpers ----------

export default AnimatedNumber;
export { AnimatedNumber };
