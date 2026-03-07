use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GenericImageView, ImageReader};
use serde::Serialize;
use std::io::Cursor;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

struct AppState {
    generation: CombineGeneration,
    pool: rayon::ThreadPool,
}

struct CombineGeneration(AtomicU64);

impl CombineGeneration {
    fn current(&self) -> u64 {
        self.0.load(Ordering::Relaxed)
    }

    fn next(&self) -> u64 {
        self.0.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn cancel(&self) {
        self.0.fetch_add(1, Ordering::Relaxed);
    }
}

#[derive(Serialize, Clone)]
struct CombineProgress {
    step: String,
    current: usize,
    total: usize,
}

#[derive(Serialize)]
struct ImageInfo {
    width: u32,
    height: u32,
    file_size: u64,
    file_name: String,
}

fn load_and_decode(path: &str) -> Result<DynamicImage, String> {
    ImageReader::open(path)
        .map_err(|e| format!("Failed to open {}: {}", path, e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to detect format {}: {}", path, e))?
        .decode()
        .map_err(|e| format!("Failed to decode {}: {}", path, e))
}

fn resize_and_combine(
    images: &[DynamicImage],
    output_size: u32,
    direction: &str,
) -> DynamicImage {
    let vertical = direction == "vertical";

    let scaled: Vec<DynamicImage> = images
        .iter()
        .map(|img| {
            let (w, h) = img.dimensions();
            if vertical {
                let scale = output_size as f64 / w as f64;
                let new_height = (h as f64 * scale).round() as u32;
                img.resize_exact(output_size, new_height, image::imageops::FilterType::CatmullRom)
            } else {
                let scale = output_size as f64 / h as f64;
                let new_width = (w as f64 * scale).round() as u32;
                img.resize_exact(new_width, output_size, image::imageops::FilterType::CatmullRom)
            }
        })
        .collect();

    if vertical {
        let total_height: u32 = scaled.iter().map(|img| img.height()).sum();
        let mut combined = DynamicImage::new_rgba8(output_size, total_height);
        let mut y_offset: u32 = 0;
        for img in &scaled {
            image::imageops::overlay(&mut combined, img, 0, y_offset as i64);
            y_offset += img.height();
        }
        combined
    } else {
        let total_width: u32 = scaled.iter().map(|img| img.width()).sum();
        let mut combined = DynamicImage::new_rgba8(total_width, output_size);
        let mut x_offset: u32 = 0;
        for img in &scaled {
            image::imageops::overlay(&mut combined, img, x_offset as i64, 0);
            x_offset += img.width();
        }
        combined
    }
}

fn encode_to_jpeg_base64(img: &DynamicImage, quality: u8) -> Result<String, String> {
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    img.to_rgb8()
        .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut cursor, quality,
        ))
        .map_err(|e| format!("Failed to encode: {}", e))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(&buf)))
}

fn encode_png_lossy(
    combined: &DynamicImage,
    quality: u32,
    dithering: f32,
    max_colors: u32,
) -> Result<Vec<u8>, String> {
    let rgba = combined.to_rgba8();
    let (width, height) = rgba.dimensions();
    let pixels: Vec<imagequant::RGBA> = rgba
        .pixels()
        .map(|p| imagequant::RGBA::new(p[0], p[1], p[2], p[3]))
        .collect();

    let mut attr = imagequant::Attributes::new();
    attr.set_quality(0, quality.min(100) as u8)
        .map_err(|e| format!("Failed to set quality: {}", e))?;
    attr.set_max_colors(max_colors.clamp(2, 256) as u32)
        .map_err(|e| format!("Failed to set max colors: {}", e))?;
    let mut img = attr
        .new_image_borrowed(&pixels, width as usize, height as usize, 0.0)
        .map_err(|e| format!("Failed to create quantization image: {}", e))?;
    let mut res = attr
        .quantize(&mut img)
        .map_err(|e| format!("Failed to quantize: {}", e))?;
    res.set_dithering_level(dithering.clamp(0.0, 1.0))
        .map_err(|e| format!("Failed to set dithering: {}", e))?;
    let (palette, indexed_pixels) = res
        .remapped(&mut img)
        .map_err(|e| format!("Failed to remap: {}", e))?;

    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Indexed);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Best);

        let mut plte = Vec::with_capacity(palette.len() * 3);
        let mut trns = Vec::with_capacity(palette.len());
        for c in &palette {
            plte.extend_from_slice(&[c.r, c.g, c.b]);
            trns.push(c.a);
        }
        encoder.set_palette(plte);
        encoder.set_trns(trns);

        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("Failed to write PNG header: {}", e))?;
        writer
            .write_image_data(&indexed_pixels)
            .map_err(|e| format!("Failed to write PNG data: {}", e))?;
    }
    Ok(buf)
}

fn encode_output(
    combined: &DynamicImage,
    format: &str,
    quality: u32,
    png_lossy: bool,
    dithering: f32,
    max_colors: u32,
) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    match format {
        "png" if png_lossy => {
            return encode_png_lossy(combined, quality, dithering, max_colors);
        }
        "png" => {
            let mut cursor = Cursor::new(&mut buf);
            combined
                .to_rgba8()
                .write_with_encoder(image::codecs::png::PngEncoder::new_with_quality(
                    &mut cursor,
                    image::codecs::png::CompressionType::Best,
                    image::codecs::png::FilterType::Adaptive,
                ))
                .map_err(|e| format!("Failed to encode PNG: {}", e))?;
        }
        "webp" => {
            let mut cursor = Cursor::new(&mut buf);
            combined
                .to_rgba8()
                .write_with_encoder(
                    image::codecs::webp::WebPEncoder::new_lossless(&mut cursor),
                )
                .map_err(|e| format!("Failed to encode WebP: {}", e))?;
        }
        "avif" => {
            let mut cursor = Cursor::new(&mut buf);
            combined
                .to_rgba8()
                .write_with_encoder(
                    image::codecs::avif::AvifEncoder::new_with_speed_quality(
                        &mut cursor,
                        4,
                        quality as u8,
                    ),
                )
                .map_err(|e| format!("Failed to encode AVIF: {}", e))?;
        }
        "tiff" => {
            let mut cursor = Cursor::new(&mut buf);
            combined
                .to_rgba8()
                .write_with_encoder(image::codecs::tiff::TiffEncoder::new(&mut cursor))
                .map_err(|e| format!("Failed to encode TIFF: {}", e))?;
        }
        _ => {
            let mut cursor = Cursor::new(&mut buf);
            combined
                .to_rgb8()
                .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
                    &mut cursor,
                    quality as u8,
                ))
                .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
        }
    }
    Ok(buf)
}

fn emit_progress(app: &tauri::AppHandle, step: &str, current: usize, total: usize) {
    let _ = app.emit(
        "combine-progress",
        CombineProgress {
            step: step.to_string(),
            current,
            total,
        },
    );
}

#[tauri::command]
async fn get_image_info(path: String) -> Result<ImageInfo, String> {
    tokio::task::spawn_blocking(move || {
        let metadata =
            std::fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {}", e))?;
        let file_name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let (width, height) = ImageReader::open(&path)
            .map_err(|e| format!("Failed to open {}: {}", path, e))?
            .with_guessed_format()
            .map_err(|e| format!("Failed to detect format {}: {}", path, e))?
            .into_dimensions()
            .map_err(|e| format!("Failed to read dimensions {}: {}", path, e))?;

        Ok(ImageInfo {
            width,
            height,
            file_size: metadata.len(),
            file_name,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
async fn combine_images(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    image_paths: Vec<String>,
    output_height: u32,
    quality: u32,
    format: String,
    png_lossy: bool,
    dithering: f32,
    max_colors: u32,
    direction: String,
) -> Result<Vec<u8>, String> {
    let state = state.inner().clone();
    let my_gen = state.generation.next();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let task_state = state.clone();
    state.pool.spawn(move || {
        let cancelled = || -> Result<(), String> {
            if task_state.generation.current() != my_gen {
                Err("cancelled".to_string())
            } else {
                Ok(())
            }
        };
        let result = (|| {
            let total = image_paths.len();

            // Step 1: Load images
            emit_progress(&app, "loading", 0, total);
            let counter = Arc::new(AtomicUsize::new(0));
            let images: Vec<DynamicImage> = image_paths
                .iter()
                .map(|p| {
                    cancelled()?;
                    let result = load_and_decode(p);
                    let done = counter.fetch_add(1, Ordering::Relaxed) + 1;
                    emit_progress(&app, "loading", done, total);
                    result
                })
                .collect::<Result<Vec<_>, _>>()?;

            cancelled()?;

            // Step 2: Resize and combine
            emit_progress(&app, "resizing", 0, total);
            let combined = resize_and_combine(&images, output_height, &direction);
            emit_progress(&app, "combining", 1, 1);

            cancelled()?;

            // Step 3: Encode via subprocess (killable)
            emit_progress(&app, "encoding", 0, 1);

            let temp_dir = std::env::temp_dir().join("image-combiner-encode");
            std::fs::create_dir_all(&temp_dir)
                .map_err(|e| format!("Failed to create temp dir: {}", e))?;
            let input_path = temp_dir.join(format!("input_{}.bmp", my_gen));
            let output_path = temp_dir.join(format!("output_{}", my_gen));

            // Save combined image as BMP (fast, lossless)
            combined
                .save(&input_path)
                .map_err(|e| format!("Failed to save temp image: {}", e))?;

            cancelled()?;

            // Spawn encoder subprocess
            let exe = std::env::current_exe()
                .map_err(|e| format!("Failed to get exe path: {}", e))?;
            let child = std::process::Command::new(exe)
                .args([
                    "--encode",
                    &format,
                    &quality.to_string(),
                    &png_lossy.to_string(),
                    &dithering.to_string(),
                    &max_colors.to_string(),
                    &input_path.to_string_lossy(),
                    &output_path.to_string_lossy(),
                ])
                .spawn()
                .map_err(|e| format!("Failed to spawn encoder: {}", e))?;

            // Poll subprocess, checking for cancellation
            let mut child = child;
            let status = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break status,
                    Ok(None) => {
                        if let Err(e) = cancelled() {
                            let _ = child.kill();
                            let _ = child.wait();
                            let _ = std::fs::remove_file(&input_path);
                            let _ = std::fs::remove_file(&output_path);
                            return Err(e);
                        }
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(e) => return Err(format!("Encoder process failed: {}", e)),
                }
            };

            // Clean up temp input
            let _ = std::fs::remove_file(&input_path);

            if !status.success() {
                let _ = std::fs::remove_file(&output_path);
                cancelled()?;
                return Err("Encoding failed".to_string());
            }

            // Read encoded output
            let result = std::fs::read(&output_path)
                .map_err(|e| format!("Failed to read encoded output: {}", e))?;
            let _ = std::fs::remove_file(&output_path);

            emit_progress(&app, "encoding", 1, 1);

            Ok(result)
        })();
        let _ = tx.send(result);
    });
    rx.await.map_err(|_| "Task failed".to_string())?
}

#[tauri::command]
async fn cancel_combine(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    state.generation.cancel();
    Ok(())
}

#[tauri::command]
async fn save_combined_image(
    app: tauri::AppHandle,
    data: Vec<u8>,
    format: String,
) -> Result<String, String> {
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let (filter_name, extensions, default_name) = match format.as_str() {
        "png" => ("PNG Image", vec!["png"], format!("combined_{}.png", timestamp)),
        "webp" => ("WebP Image", vec!["webp"], format!("combined_{}.webp", timestamp)),
        "avif" => ("AVIF Image", vec!["avif"], format!("combined_{}.avif", timestamp)),
        "tiff" => ("TIFF Image", vec!["tiff", "tif"], format!("combined_{}.tiff", timestamp)),
        _ => ("JPEG Image", vec!["jpg", "jpeg"], format!("combined_{}.jpg", timestamp)),
    };

    let file_path = app
        .dialog()
        .file()
        .add_filter(filter_name, &extensions)
        .set_file_name(&default_name)
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            tokio::task::spawn_blocking(move || {
                std::fs::write(&path_str, &data)
                    .map_err(|e| format!("Failed to save: {}", e))?;
                Ok(path_str)
            })
            .await
            .map_err(|e| format!("Task failed: {}", e))?
        }
        None => Err("Save cancelled".to_string()),
    }
}

#[tauri::command]
async fn get_thumbnail(path: String, direction: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let img = load_and_decode(&path)?;
        let thumbnail = if direction == "vertical" {
            img.thumbnail(384, 999999)
        } else {
            img.thumbnail(999999, 384)
        };
        encode_to_jpeg_base64(&thumbnail, 80)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
async fn get_image_preview(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let img = load_and_decode(&path)?;
        let preview = img.thumbnail(u32::MAX, 1200);
        encode_to_jpeg_base64(&preview, 90)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
async fn save_pasted_image(data: Vec<u8>, mime_type: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let ext = match mime_type.as_str() {
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/bmp" => "bmp",
            _ => "jpg",
        };
        let temp_dir = std::env::temp_dir().join("image-combiner-paste");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temp dir: {}", e))?;
        let file_name = format!("pasted_{}.{}", chrono::Local::now().format("%Y%m%d_%H%M%S_%3f"), ext);
        let file_path = temp_dir.join(&file_name);
        std::fs::write(&file_path, &data)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        Ok(file_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Subprocess entry point for encoding. Returns true if handled.
pub fn try_encode_subprocess() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 || args[1] != "--encode" {
        return false;
    }
    // Args: --encode <format> <quality> <png_lossy> <dithering> <max_colors> <input> <output>
    if args.len() < 9 {
        eprintln!("Usage: --encode <format> <quality> <png_lossy> <dithering> <max_colors> <input> <output>");
        std::process::exit(1);
    }
    let format = &args[2];
    let quality: u32 = args[3].parse().unwrap_or(85);
    let png_lossy: bool = args[4].parse().unwrap_or(false);
    let dithering: f32 = args[5].parse().unwrap_or(1.0);
    let max_colors: u32 = args[6].parse().unwrap_or(256);
    let input_path = &args[7];
    let output_path = &args[8];

    let img = load_and_decode(input_path).unwrap_or_else(|e| {
        eprintln!("Failed to load input: {}", e);
        std::process::exit(1);
    });
    let result = encode_output(&img, format, quality, png_lossy, dithering, max_colors)
        .unwrap_or_else(|e| {
            eprintln!("Failed to encode: {}", e);
            std::process::exit(1);
        });
    std::fs::write(output_path, &result).unwrap_or_else(|e| {
        eprintln!("Failed to write output: {}", e);
        std::process::exit(1);
    });
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AppState {
            generation: CombineGeneration(AtomicU64::new(0)),
            pool: rayon::ThreadPoolBuilder::new().build().unwrap(),
        }))
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

            let settings = MenuItemBuilder::with_id("settings", "偏好設定…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Image Combiner")
                .item(&PredefinedMenuItem::about(app, None, None)?)
                .separator()
                .item(&settings)
                .separator()
                .item(&PredefinedMenuItem::hide(app, None)?)
                .item(&PredefinedMenuItem::hide_others(app, None)?)
                .item(&PredefinedMenuItem::show_all(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, None)?)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .item(&PredefinedMenuItem::fullscreen(app, None)?)
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                if event.id() == settings.id() {
                    let _ = app_handle.emit("open-settings", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_image_info,
            get_thumbnail,
            get_image_preview,
            combine_images,
            cancel_combine,
            save_combined_image,
            save_pasted_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
