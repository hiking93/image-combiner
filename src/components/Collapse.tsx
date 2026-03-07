import { useState, useEffect, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";

interface CollapseProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Collapse({ open, children, className }: CollapseProps) {
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setRender(true);
    } else {
      setVisible(false);
      const id = setTimeout(() => setRender(false), 200);
      return () => clearTimeout(id);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (open && render) {
      requestAnimationFrame(() => setVisible(true));
    }
  }, [open, render]);

  if (!render) return null;

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
