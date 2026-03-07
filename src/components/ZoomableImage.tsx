import { useRef, useEffect, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

interface ZoomableImageProps {
  src: string;
  alt?: string;
  className?: string;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

const INITIAL: Transform = { x: 0, y: 0, scale: 1 };

function clampTranslate(
  x: number,
  y: number,
  scale: number,
  container: HTMLElement | null,
  img: HTMLImageElement | null,
): { x: number; y: number } {
  if (!container || !img) return { x, y };
  const cr = container.getBoundingClientRect();
  const iw = img.naturalWidth || img.offsetWidth;
  const ih = img.naturalHeight || img.offsetHeight;
  // Compute displayed image size (object-contain)
  const fitScale = Math.min(cr.width / iw, cr.height / ih, 1);
  const dw = iw * fitScale * scale;
  const dh = ih * fitScale * scale;
  // Allow panning so at least half the image stays visible
  const maxX = Math.max(0, (dw + cr.width) / 2 - 40);
  const maxY = Math.max(0, (dh + cr.height) / 2 - 40);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
}

export function ZoomableImage({ src, alt, className }: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [transform, setTransform] = useState<Transform>(INITIAL);
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey) {
      // Pinch zoom centered on cursor
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;

      setTransform((t) => {
        const newScale = Math.min(10, Math.max(1, t.scale - e.deltaY * 0.01));
        const r = newScale / t.scale;
        const nx = cx - (cx - t.x) * r;
        const ny = cy - (cy - t.y) * r;
        const clamped = clampTranslate(
          nx,
          ny,
          newScale,
          containerRef.current,
          imgRef.current,
        );
        return { ...clamped, scale: newScale };
      });
    } else {
      // Two-finger pan
      setTransform((t) => {
        const clamped = clampTranslate(
          t.x - e.deltaX,
          t.y - e.deltaY,
          t.scale,
          containerRef.current,
          imgRef.current,
        );
        return { ...t, ...clamped };
      });
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isPanning.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform((t) => {
      const clamped = clampTranslate(
        t.x + dx,
        t.y + dy,
        t.scale,
        containerRef.current,
        imgRef.current,
      );
      return { ...t, ...clamped };
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleDoubleClick = useCallback(() => {
    setTransform(INITIAL);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center justify-center overflow-hidden",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      style={{
        touchAction: "none",
        cursor: transform.scale > 1 ? "grab" : "default",
      }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="h-full w-full object-contain"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
        draggable={false}
      />
    </div>
  );
}
