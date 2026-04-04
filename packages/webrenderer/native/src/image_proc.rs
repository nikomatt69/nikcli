use std::slice;

/// Decode PNG bytes to raw RGBA pixel buffer.
///
/// # Safety
/// - `input` must point to `input_len` valid bytes
/// - Returns pointer to allocated buffer; caller must free with wr_free_buffer()
#[no_mangle]
pub unsafe fn decode_png(
    input: *const u8,
    input_len: usize,
    out_w: *mut u32,
    out_h: *mut u32,
) -> *mut u8 {
    let data = slice::from_raw_parts(input, input_len);

    let img = match image::load_from_memory(data) {
        Ok(i) => i.to_rgba8(),
        Err(e) => {
            eprintln!("[webrenderer] decode_png failed: {e}");
            return std::ptr::null_mut();
        }
    };

    let (w, h) = img.dimensions();
    *out_w = w;
    *out_h = h;

    let mut raw = img.into_raw();
    let ptr = raw.as_mut_ptr();
    std::mem::forget(raw);
    ptr
}

/// Decode JPEG bytes to raw RGBA pixel buffer.
///
/// # Safety
/// - `input` must point to `input_len` valid bytes
/// - Returns pointer to allocated buffer; caller must free with wr_free_buffer()
pub unsafe fn decode_jpeg(
    input: *const u8,
    input_len: usize,
    out_w: *mut u32,
    out_h: *mut u32,
) -> *mut u8 {
    let data = slice::from_raw_parts(input, input_len);

    let img = match image::load_from_memory(data) {
        Ok(i) => i.to_rgba8(),
        Err(e) => {
            eprintln!("[webrenderer] decode_jpeg failed: {e}");
            return std::ptr::null_mut();
        }
    };

    let (w, h) = img.dimensions();
    *out_w = w;
    *out_h = h;

    let mut raw = img.into_raw();
    let ptr = raw.as_mut_ptr();
    std::mem::forget(raw);
    ptr
}

/// Resize RGBA pixel buffer using Lanczos3 filter.
///
/// # Safety
/// - `pixels` must point to `w * h * 4` valid bytes (RGBA)
/// - Returns pointer to allocated buffer; caller must free with wr_free_buffer()
pub unsafe fn resize_rgba(
    pixels: *const u8,
    w: u32,
    h: u32,
    nw: u32,
    nh: u32,
    out_len: *mut usize,
) -> *mut u8 {
    let src_len = (w as usize) * (h as usize) * 4;
    let src = slice::from_raw_parts(pixels, src_len);

    let img = match image::RgbaImage::from_raw(w, h, src.to_vec()) {
        Some(i) => i,
        None => {
            eprintln!("[webrenderer] resize_rgba: invalid dimensions {w}x{h}");
            return std::ptr::null_mut();
        }
    };

    let resized = image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Lanczos3);

    let mut raw = resized.into_raw();
    *out_len = raw.len();
    let ptr = raw.as_mut_ptr();
    std::mem::forget(raw);
    ptr
}

/// Convert BGRA pixels to RGBA (swap R and B channels).
///
/// # Safety
/// - `pixels` must point to `len` valid bytes
/// - Modifies pixels in-place
pub unsafe fn bgra_to_rgba(pixels: *mut u8, len: usize) {
    let buf = slice::from_raw_parts_mut(pixels, len);
    for chunk in buf.chunks_exact_mut(4) {
        chunk.swap(0, 2); // swap B and R
    }
}
