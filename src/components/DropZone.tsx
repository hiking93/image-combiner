import { useState, useCallback, type DragEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { ImagePlus } from "lucide-react";

interface DropZoneProps {
  onDrop: (paths: string[]) => void;
  className?: string;
  compact?: boolean;
}

export function DropZone({ onDrop, className, compact }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      const imagePaths = files
        .filter((f) => f.type.startsWith("image/"))
        .map((f) => (f as File & { path: string }).path);

      if (imagePaths.length > 0) {
        onDrop(imagePaths);
      }
    },
    [onDrop],
  );

  const handleClick = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff"],
        },
      ],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length > 0) {
        onDrop(paths);
      }
    }
  }, [onDrop]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={cn(
        "group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all duration-200",
        isDragOver
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/50",
        compact ? "gap-1 py-4" : "gap-3 py-20",
        className,
      )}
    >
      {!compact && (
        <div
          className={cn(
            "rounded-full p-3 transition-colors",
            isDragOver ? "bg-primary/10" : "bg-muted",
          )}
        >
          <ImagePlus
            className={cn(
              "h-8 w-8 transition-colors",
              isDragOver ? "text-primary" : "text-muted-foreground",
            )}
          />
        </div>
      )}
      <div className="text-center">
        <p
          className={cn(
            "font-medium transition-colors",
            compact ? "text-xs" : "text-sm",
            isDragOver ? "text-primary" : "text-muted-foreground",
          )}
        >
          {compact
            ? "拖放或點擊新增更多圖片"
            : "拖放圖片到這裡，或點擊選擇檔案"}
        </p>
        {!compact && (
          <p className="mt-1 text-xs text-muted-foreground/60">
            支援 JPG、PNG、WebP 等常見圖片格式
          </p>
        )}
      </div>
    </div>
  );
}
