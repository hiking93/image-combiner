import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewSrc: string | null;
  isLoading: boolean;
}

export function PreviewDialog({
  open,
  onOpenChange,
  previewSrc,
  isLoading,
}: PreviewDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("previewTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center overflow-auto rounded-lg bg-muted/50 p-4">
          {isLoading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {t("generatingPreview")}
            </div>
          ) : previewSrc ? (
            <img
              src={previewSrc}
              alt="Combined preview"
              className="max-h-[60vh] w-auto rounded"
            />
          ) : (
            <p className="py-12 text-sm text-muted-foreground">
              {t("previewFailed")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
