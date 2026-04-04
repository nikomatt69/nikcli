use crate::types::WrBuffer;
use image::ImageEncoder;

/// Screenshot format options.
#[derive(Clone, Copy)]
pub enum ScreenshotFormat {
    Png,
    Jpeg(u8), // quality 0-100
}

/// Encode raw RGBA pixels to PNG bytes.
pub fn encode_png(pixels: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    encoder
        .write_image(pixels, width, height, image::ExtendedColorType::Rgba8)
        .ok()?;
    Some(buf)
}

/// Encode raw RGBA pixels to JPEG bytes.
pub fn encode_jpeg(pixels: &[u8], width: u32, height: u32, quality: u8) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .write_image(pixels, width, height, image::ExtendedColorType::Rgba8)
        .ok()?;
    Some(buf)
}

/// Take raw RGBA pixels and produce a WrBuffer.
pub fn rgba_to_buffer(pixels: Vec<u8>, width: u32, height: u32) -> WrBuffer {
    WrBuffer::new(pixels, width, height)
}
