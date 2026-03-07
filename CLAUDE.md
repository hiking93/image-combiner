# CLAUDE.md

## Project Overview

Image Combiner — a Tauri 2 desktop app that combines multiple images horizontally into one. React frontend + Rust backend.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite 7 + Tailwind CSS v4 + shadcn/ui v4 (base-ui)
- **Backend**: Tauri 2 + Rust
- **Package manager**: pnpm
- **Linting**: oxlint + Prettier + Husky + lint-staged

## Key Commands

```bash
pnpm tauri dev      # Dev mode (Vite on localhost:1420 + Tauri)
pnpm tauri build    # Production build
pnpm lint           # oxlint src
pnpm format         # Prettier src
```

## Architecture

### Frontend (`src/`)

- `App.tsx` — Main component: image list, sidebar settings, drag-and-drop, combine workflow
- `components/SortableImage.tsx` — Draggable image card using @dnd-kit
- `components/ZoomableImage.tsx` — Pan & zoom image viewer (wheel + pointer events)
- `components/SettingsDialog.tsx` — Theme (light/dark/system) and language settings
- `components/ui/` — shadcn/ui v4 components (dialog, select, slider, button, etc.)
- `i18n/` — i18next with zh-TW and en locales
- `App.css` — Tailwind imports, CSS theme variables (oklch), custom animations

### Backend (`src-tauri/src/lib.rs`)

Tauri commands:

- `get_image_info(path)` → thumbnail (base64) + metadata
- `get_image_preview(path)` → higher-res preview (base64)
- `combine_images(image_paths, output_height, quality, format, png_lossy, dithering, max_colors)` → encoded bytes
- `save_combined_image(data, format)` → file dialog save

Image processing uses `image` crate with `rayon` for parallel operations. Lossy PNG uses `imagequant` + `png` crates.

Progress events emitted via `app.emit("combine-progress", ...)`.

## Important Conventions

### shadcn/ui v4 (base-ui)

This project uses shadcn v4 which is based on `@base-ui/react`, NOT Radix. Key API differences:

- `TooltipProvider` uses `delay` not `delayDuration`
- `TooltipTrigger` has no `asChild`, uses `render` prop instead
- `Slider` `onValueChange` returns `number | readonly number[]` — always handle both

### UI Language

All user-facing text should be in Traditional Chinese (繁體中文) by default. Use i18n keys from `src/i18n/locales/zh-TW.json`.

### Dark Mode

Uses class-based dark mode via `@custom-variant dark (&:where(.dark, .dark *))` in Tailwind v4. Theme applied by toggling `.dark` class on `<html>`.

### Settings Persistence

Output settings (height, quality, format, PNG options) are persisted to localStorage. App settings (theme, language) also in localStorage.

### File Paths in Tauri

`File.path` requires cast: `(f as File & { path: string }).path`

### Code Style

- Semicolons are used
- Double quotes for strings (Prettier default)
- Use `@/` path alias for imports (maps to `src/`)
