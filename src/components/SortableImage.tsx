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
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SortableImage({ image, index, onRemove }: SortableImageProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative shrink-0 cursor-grab overflow-hidden rounded-lg border bg-card shadow-sm",
        isDragging
          ? "z-10 opacity-0"
          : "transition-shadow duration-200 hover:shadow-md",
      )}
      {...attributes}
      {...listeners}
    >
      {/* Index badge */}
      <div className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/50 px-1 text-[10px] font-medium text-white">
        {index}
      </div>

      <img
        src={image.thumbnail}
        alt={image.fileName}
        className="h-36 w-auto object-contain"
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
          onRemove(image.id);
        }}
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-all hover:bg-destructive group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
