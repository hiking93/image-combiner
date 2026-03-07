import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableImage, type ImageItem } from "./components/SortableImage";
import { SettingsDialog } from "./components/SettingsDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { ZoomableImage } from "./components/ZoomableImage";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Separator } from "./components/ui/separator";
import { Badge } from "./components/ui/badge";
import { Slider } from "./components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  Download,
  Trash2,
  Images,
  Settings2,
  Layers,
  Loader2,
  XCircle,
  Plus,
} from "lucide-react";
import { Toaster, toast } from "sonner";

function App() {
  const { t } = useTranslation();
  const [images, setImages] = useState<ImageItem[]>([]);
  const [outputHeight, setOutputHeight] = useState(0);
  const [quality, setQuality] = useState(85);
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [pngLossy, setPngLossy] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState("");
  const [loadingCount, setLoadingCount] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [selectedPreviewSrc, setSelectedPreviewSrc] = useState<string | null>(
    null,
  );
  const [selectedPreviewLoading, setSelectedPreviewLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadCancelRef = useRef(0);
  const combineCancelRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const addImages = useCallback(
    async (paths: string[]) => {
      const batchId = ++loadCancelRef.current;
      setLoadingCount((c) => c + paths.length);
      await Promise.allSettled(
        paths.map(async (path) => {
          try {
            const info = await invoke<{
              width: number;
              height: number;
              file_size: number;
              file_name: string;
              thumbnail: string;
            }>("get_image_info", { path });
            if (loadCancelRef.current !== batchId) return;
            setImages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                path,
                thumbnail: info.thumbnail,
                fileName: info.file_name,
                width: info.width,
                height: info.height,
                fileSize: info.file_size,
              },
            ]);
          } catch (e) {
            if (loadCancelRef.current !== batchId) return;
            const fileName = path.split("/").pop() || path;
            toast.error(t("loadFailed", { fileName }), {
              description: String(e),
            });
          } finally {
            if (loadCancelRef.current === batchId) {
              setLoadingCount((c) => c - 1);
            }
          }
        }),
      );
    },
    [t],
  );

  const cancelLoading = useCallback(() => {
    loadCancelRef.current++;
    setLoadingCount(0);
  }, []);

  const pickFiles = useCallback(async () => {
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
      if (paths.length > 0) addImages(paths);
    }
  }, [addImages]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setImages((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleDragEnd = () => {
    setActiveId(null);
  };

  const handleSelectImage = useCallback(async (image: ImageItem) => {
    setSelectedImage(image);
    setSelectedPreviewSrc(image.thumbnail);
    setSelectedPreviewLoading(true);
    try {
      const src = await invoke<string>("get_image_preview", {
        path: image.path,
      });
      setSelectedPreviewSrc(src);
    } catch {
      // keep thumbnail as fallback
    } finally {
      setSelectedPreviewLoading(false);
    }
  }, []);

  const handleCombine = async () => {
    if (images.length === 0) return;
    combineCancelRef.current = false;
    setIsProcessing(true);
    setProcessProgress(t("preparing"));

    const unlisten = await listen<{
      step: string;
      current: number;
      total: number;
    }>("combine-progress", (event) => {
      const { step, current, total } = event.payload;
      const label = t(`step.${step}`, { defaultValue: step });
      setProcessProgress(`${label} (${current}/${total})`);
    });

    try {
      const data = await invoke<number[]>("combine_images", {
        imagePaths: images.map((img) => img.path),
        outputHeight: effectiveHeight,
        quality,
        format,
        pngLossy,
      });
      if (combineCancelRef.current) return;
      setProcessProgress(t("saving"));
      await invoke("save_combined_image", { data, format });
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("cancelled") && !combineCancelRef.current) {
        console.error(e);
      }
    } finally {
      unlisten();
      setIsProcessing(false);
      setProcessProgress("");
    }
  };

  const cancelCombine = useCallback(() => {
    combineCancelRef.current = true;
    setIsProcessing(false);
    setProcessProgress("");
  }, []);

  // Tauri file drag-and-drop
  const addImagesRef = useRef(addImages);
  addImagesRef.current = addImages;
  useEffect(() => {
    const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
    const unlisten = getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths.filter((p) =>
          IMAGE_EXTENSIONS.test(p),
        );
        if (paths.length > 0) {
          addImagesRef.current(paths);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleCombine();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, outputHeight, quality, format]);

  const hasImages = images.length > 0;
  const maxImageHeight = Math.max(0, ...images.map((img) => img.height));
  const effectiveHeight = outputHeight === 0 ? maxImageHeight : outputHeight;
  const estimatedWidth = images.reduce((sum, img) => {
    const scale = effectiveHeight / img.height;
    return sum + Math.round(img.width * scale);
  }, 0);
  const activeIndex = activeId
    ? images.findIndex((img) => img.id === activeId)
    : -1;
  const activeImage = activeIndex >= 0 ? images[activeIndex] : null;

  return (
    <main className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-sm font-semibold">Image Combiner</h1>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          title={t("settings")}
        >
          <Settings2 className="h-4 w-4" />
        </button>
        {hasImages && (
          <Badge variant="secondary" className="gap-1">
            <Images className="h-3 w-3" />
            {t("imageCount", { count: images.length })}
          </Badge>
        )}
        <div
          className={`flex items-center gap-1.5 text-xs text-muted-foreground transition-all duration-200 ${
            loadingCount > 0
              ? "max-w-80 opacity-100"
              : "max-w-0 overflow-hidden opacity-0"
          }`}
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span className="whitespace-nowrap">
            {t("loadingImages", { count: loadingCount })}
          </span>
          <button
            onClick={cancelLoading}
            className="shrink-0 rounded-full text-muted-foreground transition-colors hover:text-destructive"
            title={t("cancelLoad")}
          >
            <XCircle className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hasImages && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImages([])}
                className="gap-1.5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("clear")}
              </Button>
              <Separator orientation="vertical" className="h-5" />
              <Button
                size="sm"
                onClick={isProcessing ? undefined : handleCombine}
                disabled={isProcessing}
                className="gap-1.5"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {processProgress || t("processing")}
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" />
                    {images.length > 1 ? t("combineAndSave") : t("save")}
                    <kbd className="rounded bg-primary-foreground/20 px-1 font-mono text-[10px]">
                      ⌘S
                    </kbd>
                  </>
                )}
              </Button>
              <div
                className={`overflow-hidden transition-all duration-200 ${
                  isProcessing ? "max-w-24 opacity-100" : "max-w-0 opacity-0"
                }`}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelCombine}
                  className="gap-1 text-muted-foreground hover:text-destructive"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  {t("cancel")}
                </Button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex min-h-0 flex-1">
        {/* Image area */}
        <div className="flex flex-1 flex-col overflow-hidden p-4">
          <div className="flex-1 overflow-x-auto overflow-y-hidden rounded-lg border bg-muted/30">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={images}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex h-full w-max min-w-full items-center justify-center gap-3 p-3">
                  {images.map((img, index) => (
                    <SortableImage
                      key={img.id}
                      image={img}
                      index={index + 1}
                      onRemove={removeImage}
                      onSelect={handleSelectImage}
                    />
                  ))}
                  {/* Add button */}
                  <button
                    onClick={pickFiles}
                    className="flex h-48 w-32 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground text-muted-foreground opacity-40 transition-all hover:opacity-60 hover:bg-muted/50"
                  >
                    <Plus className="h-8 w-8" />
                  </button>
                </div>
              </SortableContext>
              <DragOverlay>
                {activeImage && (
                  <div className="relative rounded-lg border bg-card shadow-2xl">
                    <div className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/50 px-1 text-[10px] font-medium text-white">
                      {activeIndex + 1}
                    </div>
                    <img
                      src={activeImage.thumbnail}
                      alt={activeImage.fileName}
                      className="h-48 w-auto rounded-lg object-contain"
                    />
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          </div>
        </div>

        {/* Settings sidebar */}
        {hasImages && (
          <>
            <Separator orientation="vertical" />
            <aside className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Settings2 className="h-4 w-4" />
                {t("outputSettings")}
              </div>

              <div className="space-y-2">
                <Label htmlFor="height" className="text-xs">
                  {t("outputHeight")}
                </Label>
                <Input
                  id="height"
                  type="number"
                  value={outputHeight === 0 ? "" : outputHeight}
                  onChange={(e) => setOutputHeight(Number(e.target.value))}
                  placeholder={outputHeight === 0 ? String(maxImageHeight) : ""}
                  min={100}
                  max={10000}
                />
                <p className="py-1 text-[11px] text-muted-foreground">
                  {t("outputSize", {
                    width: estimatedWidth,
                    height: effectiveHeight,
                  })}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setOutputHeight(0)}
                    className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                      outputHeight === 0
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {t("originalMax")}
                  </button>
                  {[400, 600, 800, 1080, 1440, 2160].map((h) => (
                    <button
                      key={h}
                      onClick={() => setOutputHeight(h)}
                      className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                        outputHeight === h
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="format" className="text-xs">
                  {t("outputFormat")}
                </Label>
                <Select
                  value={format}
                  onValueChange={(v) => setFormat(v as "jpeg" | "png")}
                >
                  <SelectTrigger id="format">
                    <SelectValue>{format.toUpperCase()}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jpeg">JPEG</SelectItem>
                    <SelectItem value="png">PNG</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {format === "png" && (
                <div className="space-y-2">
                  <Label className="text-xs">{t("pngCompression")}</Label>
                  <div className="flex gap-1.5">
                    {([false, true] as const).map((lossy) => (
                      <button
                        key={String(lossy)}
                        onClick={() => setPngLossy(lossy)}
                        className={`flex-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                          pngLossy === lossy
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {lossy ? t("lossy") : t("lossless")}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(format === "jpeg" || (format === "png" && pngLossy)) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t("quality")}</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {quality}%
                    </span>
                  </div>
                  <Slider
                    value={[quality]}
                    onValueChange={(v) =>
                      setQuality(Array.isArray(v) ? v[0] : v)
                    }
                    min={1}
                    max={100}
                    step={1}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{t("smallFile")}</span>
                    <span>{t("highQuality")}</span>
                  </div>
                </div>
              )}
            </aside>
          </>
        )}
      </div>

      {/* Image preview dialog */}
      <Dialog
        open={!!selectedImage}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedImage(null);
            setSelectedPreviewSrc(null);
            setSelectedPreviewLoading(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-[70vw]">
          <DialogHeader>
            <DialogTitle>{selectedImage?.fileName}</DialogTitle>
          </DialogHeader>
          <div className="relative flex h-[70vh] items-center justify-center rounded-lg bg-muted/50">
            {selectedPreviewSrc ? (
              <ZoomableImage
                src={selectedPreviewSrc}
                alt={selectedImage?.fileName}
                className="h-full w-full rounded-lg"
              />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
            {selectedPreviewLoading && selectedPreviewSrc && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          {selectedImage && (
            <p className="text-center text-xs text-muted-foreground">
              {selectedImage.width} × {selectedImage.height} ·{" "}
              {selectedImage.fileSize < 1024 * 1024
                ? `${(selectedImage.fileSize / 1024).toFixed(1)} KB`
                : `${(selectedImage.fileSize / (1024 * 1024)).toFixed(1)} MB`}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Toaster richColors position="bottom-right" />
    </main>
  );
}

export default App;
