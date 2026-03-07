use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GenericImageView, ImageReader};
use rayon::prelude::*;
use serde::Serialize;
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

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
    thumbnail: String,
}

fn load_and_decode(path: &str) -> Result<DynamicImage, String> {
    ImageReader::open(path)
        .map_err(|e| format!("Failed to open {}: {}", path, e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to detect format {}: {}", path, e))?
        .decode()
        .map_err(|e| format!("Failed to decode {}: {}", path, e))
}

fn resize_and_combine(images: &[DynamicImage], output_height: u32) -> DynamicImage {
    let scaled: Vec<DynamicImage> = images
        .par_iter()
        .map(|img| {
            let (w, h) = img.dimensions();
            let scale = output_height as f64 / h as f64;
            let new_width = (w as f64 * scale).round() as u32;
            img.resize_exact(new_width, output_height, image::imageops::FilterType::CatmullRom)
        })
        .collect();

    let total_width: u32 = scaled.iter().map(|img| img.width()).sum();
    let mut combined = DynamicImage::new_rgba8(total_width, output_height);
    let mut x_offset: u32 = 0;
    for img in &scaled {
        image::imageops::overlay(&mut combined, img, x_offset as i64, 0);
        x_offset += img.width();
    }
    combined
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

        let img = load_and_decode(&path)?;
        let (width, height) = img.dimensions();

        let thumbnail = img.thumbnail(999999, 384);
        let thumbnail_data = encode_to_jpeg_base64(&thumbnail, 80)?;

        Ok(ImageInfo {
            width,
            height,
            file_size: metadata.len(),
            file_name,
            thumbnail: thumbnail_data,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
async fn combine_images(
    app: tauri::AppHandle,
    image_paths: Vec<String>,
    output_height: u32,
    quality: u32,
    format: String,
    png_lossy: bool,
    dithering: f32,
    max_colors: u32,
) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || {
        let total = image_paths.len();

        // Step 1: Load images in parallel
        emit_progress(&app, "loading", 0, total);
        let counter = Arc::new(AtomicUsize::new(0));
        let images: Vec<DynamicImage> = image_paths
            .par_iter()
            .map(|p| {
                let result = load_and_decode(p);
                let done = counter.fetch_add(1, Ordering::Relaxed) + 1;
                emit_progress(&app, "loading", done, total);
                result
            })
            .collect::<Result<Vec<_>, _>>()?;

        // Step 2: Resize and combine
        emit_progress(&app, "resizing", 0, total);
        let combined = resize_and_combine(&images, output_height);
        emit_progress(&app, "combining", 1, 1);

        // Step 3: Encode
        emit_progress(&app, "encoding", 0, 1);
        let result = encode_output(&combined, &format, quality, png_lossy, dithering, max_colors)?;
        emit_progress(&app, "encoding", 1, 1);

        Ok(result)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            get_image_preview,
            combine_images,
            save_combined_image,
            save_pasted_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
