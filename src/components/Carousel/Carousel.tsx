import { Children, type ReactNode } from "react";
import { useCarousel } from "./useCarousel";
import "./Carousel.css";

interface CarouselProps {
  children: ReactNode;
  onPageChange?: (index: number) => void;
}

export function Carousel({ children, onPageChange }: CarouselProps) {
  const pages = Children.toArray(children);
  const { containerRef, activeIndex, goToPage } = useCarousel({
    pageCount: pages.length,
    onPageChange,
  });

  return (
    <>
      <div ref={containerRef} className="carousel">
        {pages.map((child, i) => (
          <div key={i} className="carousel__page">
            {child}
          </div>
        ))}
      </div>

      <div className="carousel__dots">
        {pages.map((_, i) => (
          <button
            key={i}
            className={`carousel__dot ${i === activeIndex ? "carousel__dot--active" : ""}`}
            onClick={() => goToPage(i)}
            aria-label={`Go to page ${i + 1}`}
          />
        ))}
      </div>
    </>
  );
}
