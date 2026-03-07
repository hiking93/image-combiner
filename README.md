# Image Combiner

A desktop application for combining multiple images side-by-side horizontally into a single image.

## Features

- **Drag & drop** images or use file picker (supports PNG, JPEG, WebP, BMP, GIF, TIFF)
- **Drag to reorder** images with smooth animations
- **Click to preview** individual images with pan & zoom
- **Configurable output height** with presets or auto (tallest image)
- **JPEG output** with adjustable quality (1-100%)
- **PNG output** with lossless or lossy (quantization) mode
  - Lossy PNG supports dithering and max color count settings
- **i18n**: English and Traditional Chinese (繁體中文)
- **Theme**: Light / Dark / System

## Getting Started

```bash
# Install dependencies
pnpm install

# Start development (launches Tauri + Vite dev server on localhost:1420)
pnpm tauri dev

# Build for production
pnpm tauri build
```

## License

[Apache License 2.0](LICENSE)
