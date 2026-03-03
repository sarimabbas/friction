import { useRef, useState, useEffect, useCallback } from "react";

interface UseCarouselOptions {
  pageCount: number;
  onPageChange?: (index: number) => void;
}

interface UseCarouselReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeIndex: number;
  goToPage: (index: number) => void;
}

export function useCarousel({
  pageCount,
  onPageChange,
}: UseCarouselOptions): UseCarouselReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rafId = useRef(0);

  // Scroll-based active page detection (rAF-throttled)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const w = el.offsetWidth;
        if (w === 0) return;
        const idx = Math.round(el.scrollLeft / w);
        setActiveIndex((prev) => {
          if (prev !== idx) {
            onPageChange?.(idx);
            return idx;
          }
          return prev;
        });
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId.current);
    };
  }, [onPageChange]);

  // Arrow key navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if focus is inside a component button
      const target = e.target as HTMLElement;
      if (target.tagName === "BUTTON" || target.tagName === "INPUT") return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        goToPage(Math.min(activeIndex + 1, pageCount - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPage(Math.max(activeIndex - 1, 0));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, pageCount]);

  const goToPage = useCallback((index: number) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.offsetWidth, behavior: "smooth" });
  }, []);

  return { containerRef, activeIndex, goToPage };
}
