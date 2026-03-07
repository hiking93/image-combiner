import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import autoAnimate from "@formkit/auto-animate";
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
  verticalListSortingStrategy,
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./components/ui/dropdown-menu";
import {
  Download,
  Trash2,
  Images,
  Settings2,
  Loader2,
  XCircle,
  Plus,
  Menu,
} from "lucide-react";
import { Toaster, toast } from "sonner";

function App() {
  const { t } = useTranslation();
  const [images, setImages] = useState<ImageItem[]>([]);
  const [outputHeight, setOutputHeight] = useState(() => {
    return Number(localStorage.getItem("outputHeight")) || 0;
  });
  const [quality, setQuality] = useState(() => {
    return Number(localStorage.getItem("quality")) || 85;
  });
  const [direction, setDirection] = useState<"horizontal" | "vertical">(() => {
    const saved = localStorage.getItem("direction");
    return saved === "vertical" ? "vertical" : "horizontal";
  });
  const [format, setFormat] = useState<"jpeg" | "png">(() => {
    const saved = localStorage.getItem("format");
    return saved === "png" ? "png" : "jpeg";
  });
  const [pngLossy, setPngLossy] = useState(() => {
    return localStorage.getItem("pngLossy") !== "false";
  });
  const [dithering, setDithering] = useState(() => {
    return Number(localStorage.getItem("dithering")) || 100;
  });
  const [maxColors, setMaxColors] = useState(() => {
    return Number(localStorage.getItem("maxColors")) || 256;
  });
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

  useEffect(() => {
    const unlisten = listen("open-settings", () => setSettingsOpen(true));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const loadCancelRef = useRef(0);
  const combineCancelRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const directionRef = useRef(direction);
  directionRef.current = direction;

  const addImages = useCallback(
    async (paths: string[]) => {
      const batchId = ++loadCancelRef.current;
      setLoadingCount((c) => c + paths.length);

      // Step 1: Get metadata and add to layout immediately
      const added: { id: string; path: string }[] = [];
      await Promise.allSettled(
        paths.map(async (path) => {
          try {
            const info = await invoke<{
              width: number;
              height: number;
              file_size: number;
              file_name: string;
            }>("get_image_info", { path });
            if (loadCancelRef.current !== batchId) return;
            const id = crypto.randomUUID();
            added.push({ id, path });
            setImages((prev) => [
              ...prev,
              {
                id,
                path,
                thumbnail: null,
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

      // Step 2: Fetch thumbnails in background
      if (loadCancelRef.current !== batchId) return;
      for (const { id, path } of added) {
        if (loadCancelRef.current !== batchId) return;
        try {
          const thumbnail = await invoke<string>("get_thumbnail", {
            path,
            direction: directionRef.current,
          });
          if (loadCancelRef.current !== batchId) return;
          setImages((prev) =>
            prev.map((i) => (i.id === id ? { ...i, thumbnail } : i)),
          );
        } catch {
          // keep null thumbnail
        }
      }
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

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const buffer = await blob.arrayBuffer();
        const data = Array.from(new Uint8Array(buffer));
        try {
          const path = await invoke<string>("save_pasted_image", {
            data,
            mimeType: item.type,
          });
          addImages([path]);
        } catch (err) {
          toast.error(t("pasteFailed"), {
            description: String(err),
          });
        }
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [addImages, t]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const clearImages = useCallback(() => {
    const container = imageListRef.current;
    if (!container) return setImages([]);
    const items = container.querySelectorAll<HTMLElement>(
      "[data-flip-key]:not([data-flip-key='add-button'])",
    );
    if (items.length === 0) return setImages([]);

    // Capture add button position before clear
    const addBtn = container.querySelector<HTMLElement>(
      "[data-flip-key='add-button']",
    );
    const addBtnRect = addBtn?.getBoundingClientRect();

    let finished = 0;
    items.forEach((el) => {
      el.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.8)" },
        ],
        { duration: 150, easing: "ease-in", fill: "forwards" },
      ).onfinish = () => {
        if (++finished === items.length) {
          flushSync(() => setImages([]));
          // FLIP animate add button after synchronous DOM update
          if (addBtn && addBtnRect) {
            const newRect = addBtn.getBoundingClientRect();
            const dx = addBtnRect.left - newRect.left;
            const dy = addBtnRect.top - newRect.top;
            if (dx !== 0 || dy !== 0) {
              addBtn.animate(
                [
                  { transform: `translate(${dx}px, ${dy}px)` },
                  { transform: "translate(0, 0)" },
                ],
                { duration: 250, easing: "ease-out" },
              );
            }
          }
        }
      };
    });
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
        outputHeight: effectiveSize,
        quality,
        format,
        pngLossy,
        dithering: dithering / 100,
        maxColors,
        direction,
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

  // Re-fetch thumbnails when direction changes
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => {
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;
    const controller = new AbortController();
    (async () => {
      for (const img of currentImages) {
        if (controller.signal.aborted) return;
        try {
          const thumbnail = await invoke<string>("get_thumbnail", {
            path: img.path,
            direction,
          });
          if (controller.signal.aborted) return;
          setImages((prev) =>
            prev.map((i) => (i.id === img.id ? { ...i, thumbnail } : i)),
          );
        } catch {
          // keep existing thumbnail
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction]);

  // Persist output settings
  useEffect(() => {
    localStorage.setItem("direction", direction);
  }, [direction]);
  useEffect(() => {
    localStorage.setItem("outputHeight", String(outputHeight));
  }, [outputHeight]);
  useEffect(() => {
    localStorage.setItem("quality", String(quality));
  }, [quality]);
  useEffect(() => {
    localStorage.setItem("format", format);
  }, [format]);
  useEffect(() => {
    localStorage.setItem("pngLossy", String(pngLossy));
  }, [pngLossy]);
  useEffect(() => {
    localStorage.setItem("dithering", String(dithering));
  }, [dithering]);
  useEffect(() => {
    localStorage.setItem("maxColors", String(maxColors));
  }, [maxColors]);

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

  const imageListRef = useRef<HTMLDivElement>(null);
  const flipRectsRef = useRef<Map<string, DOMRect>>(new Map());

  const captureFlipRects = useCallback(() => {
    const container = imageListRef.current;
    if (!container) return;
    const rects = new Map<string, DOMRect>();
    for (const child of container.children) {
      const key = (child as HTMLElement).dataset.flipKey;
      if (key) rects.set(key, child.getBoundingClientRect());
    }
    flipRectsRef.current = rects;
  }, []);

  // Animate after layout change (FLIP: Last, Invert, Play)
  useLayoutEffect(() => {
    const container = imageListRef.current;
    if (!container || flipRectsRef.current.size === 0) return;
    for (const child of container.children) {
      const key = (child as HTMLElement).dataset.flipKey;
      if (!key) continue;
      const oldRect = flipRectsRef.current.get(key);
      if (!oldRect) continue;
      const newRect = child.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (dx === 0 && dy === 0) continue;
      (child as HTMLElement).animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 250, easing: "ease-out" },
      );
    }
    flipRectsRef.current = new Map();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction]);

  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!sidebarRef.current) return;
    const duration = 200;
    const easing = "ease-out";
    const controller = autoAnimate(
      sidebarRef.current,
      (el, action, oldCoords, newCoords) => {
        if (action === "add") {
          return new KeyframeEffect(el, [{ opacity: 0 }, { opacity: 1 }], {
            duration,
            easing,
          });
        }
        if (action === "remove") {
          return new KeyframeEffect(el, [{ opacity: 1 }, { opacity: 0 }], {
            duration,
            easing,
          });
        }
        const dy = oldCoords && newCoords ? oldCoords.top - newCoords.top : 0;
        return new KeyframeEffect(
          el,
          dy
            ? [
                { transform: `translateY(${dy}px)` },
                { transform: "translateY(0)" },
              ]
            : [],
          { duration, easing },
        );
      },
    );
    return () => {
      (controller as { destroy: () => void }).destroy();
    };
  }, []);
  const hasImages = images.length > 0;
  const isVertical = direction === "vertical";
  const maxImageHeight = Math.max(0, ...images.map((img) => img.height));
  const maxImageWidth = Math.max(0, ...images.map((img) => img.width));
  const effectiveSize =
    outputHeight === 0
      ? isVertical
        ? maxImageWidth
        : maxImageHeight
      : outputHeight;
  const estimatedWidth = isVertical
    ? effectiveSize
    : images.reduce((sum, img) => {
        const scale = effectiveSize / img.height;
        return sum + Math.round(img.width * scale);
      }, 0);
  const estimatedHeight = isVertical
    ? images.reduce((sum, img) => {
        const scale = effectiveSize / img.width;
        return sum + Math.round(img.height * scale);
      }, 0)
    : effectiveSize;
  const activeIndex = activeId
    ? images.findIndex((img) => img.id === activeId)
    : -1;
  const activeImage = activeIndex >= 0 ? images[activeIndex] : null;

  return (
    <main className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header
        className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
        data-tauri-drag-region
      >
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-muted/50">
            <Menu className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8}>
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings2 className="h-4 w-4" />
              {t("settings")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 20 20"
            className="h-5 w-5 text-primary"
            fill="currentColor"
          >
            <rect x="1" y="4" width="5" height="12" rx="1.2" opacity="0.7" />
            <rect x="7.5" y="4" width="5" height="12" rx="1.2" opacity="0.5" />
            <rect x="14" y="4" width="5" height="12" rx="1.2" opacity="0.7" />
          </svg>
          <h1 className="text-sm font-semibold">Image Combiner</h1>
        </div>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={clearImages}
            disabled={!hasImages}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("clear")}
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Button
            size="sm"
            onClick={isProcessing ? undefined : handleCombine}
            disabled={!hasImages || isProcessing}
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
        </div>
      </header>

      {/* Main content */}
      <div className="flex min-h-0 flex-1">
        {/* Image area */}
        <div className="flex flex-1 flex-col overflow-hidden p-4">
          <div
            className={`flex-1 rounded-lg border bg-muted/30 ${isVertical ? "overflow-y-auto overflow-x-hidden" : "overflow-x-auto overflow-y-hidden"}`}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={images}
                strategy={
                  isVertical
                    ? verticalListSortingStrategy
                    : horizontalListSortingStrategy
                }
              >
                <div
                  ref={imageListRef}
                  className={`flex gap-3 p-3 ${isVertical ? "h-max min-h-full w-full flex-col items-center justify-start" : "h-full w-max min-w-full items-center justify-center"}`}
                >
                  {images.map((img, index) => (
                    <SortableImage
                      key={img.id}
                      image={img}
                      index={index + 1}
                      onRemove={removeImage}
                      onSelect={handleSelectImage}
                      vertical={isVertical}
                    />
                  ))}
                  {/* Add button */}
                  <button
                    data-flip-key="add-button"
                    onClick={pickFiles}
                    className={`flex shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground text-muted-foreground opacity-40 transition-all hover:opacity-60 hover:bg-muted/50 ${isVertical ? "h-32 w-48" : "h-48 w-32"}`}
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
                      src={activeImage.thumbnail ?? undefined}
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
        <Separator orientation="vertical" />
        <aside
          ref={sidebarRef}
          className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto p-4"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Settings2 className="h-4 w-4" />
            {t("outputSettings")}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t("direction")}</Label>
            <div className="flex gap-1.5">
              {(["horizontal", "vertical"] as const).map((dir) => (
                <button
                  key={dir}
                  onClick={() => {
                    captureFlipRects();
                    setDirection(dir);
                  }}
                  className={`flex-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                    direction === dir
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {t(dir)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="height" className="text-xs">
              {isVertical ? t("outputWidth") : t("outputHeight")}
            </Label>
            <Input
              id="height"
              type="number"
              value={outputHeight === 0 ? "" : outputHeight}
              onChange={(e) => setOutputHeight(Number(e.target.value))}
              placeholder={
                outputHeight === 0
                  ? String(isVertical ? maxImageWidth : maxImageHeight)
                  : ""
              }
              min={100}
              max={10000}
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setOutputHeight(0)}
                className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                  outputHeight === 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {isVertical ? t("originalMaxWidth") : t("originalMax")}
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

          {hasImages && (
            <p className="-mt-3 text-[11px] text-muted-foreground">
              {t("outputSize", {
                width: estimatedWidth,
                height: estimatedHeight,
              })}
            </p>
          )}

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
                onValueChange={(v) => setQuality(Array.isArray(v) ? v[0] : v)}
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

          {format === "png" && pngLossy && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t("dithering")}</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {dithering}%
                </span>
              </div>
              <Slider
                value={[dithering]}
                onValueChange={(v) => setDithering(Array.isArray(v) ? v[0] : v)}
                min={0}
                max={100}
                step={1}
              />
            </div>
          )}

          {format === "png" && pngLossy && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t("maxColors")}</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {maxColors}
                </span>
              </div>
              <Slider
                value={[maxColors]}
                onValueChange={(v) => setMaxColors(Array.isArray(v) ? v[0] : v)}
                min={2}
                max={256}
                step={1}
              />
            </div>
          )}
        </aside>
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
