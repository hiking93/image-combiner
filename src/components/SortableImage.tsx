import { useRef, useState, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export interface ImageItem {
  id: string;
  path: string;
  thumbnail: string;
  fileName: string;
  width: number;
  height: number;
  fileSize: number;
}

interface SortableImageProps {
  image: ImageItem;
  index: number;
  onRemove: (id: string) => void;
  onSelect: (image: ImageItem) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SortableImage({
  image,
  index,
  onRemove,
  onSelect,
}: SortableImageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const didDrag = useRef(false);
  const [isNew, setIsNew] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setIsNew(false), 300);
    return () => clearTimeout(id);
  }, []);

  const handleRemove = () => {
    const el = ref.current;
    if (!el) return onRemove(image.id);
    const inner = el.firstElementChild as HTMLElement;
    const width = el.offsetWidth;
    el.style.width = `${width}px`;
    el.style.transition = "width 200ms ease-in, margin 200ms ease-in";
    inner.style.transition = "transform 200ms ease-in, opacity 200ms ease-in";
    requestAnimationFrame(() => {
      el.style.width = "0px";
      el.style.marginLeft = "-6px";
      inner.style.transform = "scale(0)";
      inner.style.opacity = "0";
    });
    el.addEventListener("transitionend", () => onRemove(image.id), {
      once: true,
    });
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const displayWidth = Math.round((image.width / image.height) * 192);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    "--item-width": `${displayWidth}px`,
  } as React.CSSProperties;

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      style={style}
      className={cn(
        "shrink-0",
        isNew && "animate-[item-enter-layout_250ms_ease-out_forwards]",
        isDragging && "z-10 opacity-0",
      )}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        didDrag.current = false;
        listeners?.onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        didDrag.current = true;
        listeners?.onPointerMove?.(e);
      }}
      onClick={() => {
        if (!didDrag.current) onSelect(image);
      }}
    >
      <div
        className={cn(
          "group relative w-max origin-left cursor-grab overflow-hidden rounded-lg border bg-card shadow-sm",
          isNew && "animate-[item-enter-visual_250ms_ease-out]",
          !isDragging && "hover:shadow-md",
        )}
      >
        {/* Index badge */}
        <div className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/50 px-1 text-[10px] font-medium text-white">
          {index}
        </div>

        <img
          src={image.thumbnail}
          alt={image.fileName}
          className="h-48 w-auto object-contain"
          draggable={false}
        />

        {/* Info overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="truncate text-[10px] font-medium text-white/90">
            {image.fileName}
          </p>
          <p className="text-[9px] text-white/60">
            {image.width}×{image.height} · {formatFileSize(image.fileSize)}
          </p>
        </div>

        {/* Remove button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-all hover:bg-destructive group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
