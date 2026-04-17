use image::imageops::FilterType;
use image::{ImageBuffer, RgbaImage};
use std::ptr;

const GLYPHS: [char; 16] = [
    ' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█',
];

#[repr(C)]
pub struct TbBuffer {
    data: *mut u8,
    len: usize,
    width: u32,
    height: u32,
}

impl TbBuffer {
    fn from_vec(mut data: Vec<u8>, width: u32, height: u32) -> *mut TbBuffer {
        let len = data.len();
        let ptr = data.as_mut_ptr();
        std::mem::forget(data);
        Box::into_raw(Box::new(TbBuffer {
            data: ptr,
            len,
            width,
            height,
        }))
    }

    unsafe fn free(self) {
        if !self.data.is_null() && self.len > 0 {
            let _ = Vec::from_raw_parts(self.data, self.len, self.len);
        }
    }
}

fn pack_rgb(r: u8, g: u8, b: u8) -> u32 {
    ((r as u32) << 16) | ((g as u32) << 8) | b as u32
}

fn unpack_rgb(rgb: u32) -> (u8, u8, u8) {
    (
        ((rgb >> 16) & 0xff) as u8,
        ((rgb >> 8) & 0xff) as u8,
        (rgb & 0xff) as u8,
    )
}

fn color_distance(a: u32, b: u32) -> i32 {
    let (ar, ag, ab) = unpack_rgb(a);
    let (br, bg, bb) = unpack_rgb(b);
    let dr = ar as i32 - br as i32;
    let dg = ag as i32 - bg as i32;
    let db = ab as i32 - bb as i32;
    dr * dr + dg * dg + db * db
}

fn quantize_ansi256(rgb: u32) -> u32 {
    let (r, g, b) = unpack_rgb(rgb);
    let cube = |value: u8| -> u8 {
        let normalized = ((value as f32 / 255.0) * 5.0).round() as u8;
        [0, 95, 135, 175, 215, 255][normalized as usize]
    };

    let gray_level = (((r as u16 + g as u16 + b as u16) / 3) as f32 / 255.0 * 23.0).round() as u8;
    let gray = if gray_level == 0 { 0 } else { 8 + gray_level * 10 };

    let cube_rgb = (cube(r), cube(g), cube(b));
    let gray_rgb = (gray, gray, gray);

    let cube_packed = pack_rgb(cube_rgb.0, cube_rgb.1, cube_rgb.2);
    let gray_packed = pack_rgb(gray_rgb.0, gray_rgb.1, gray_rgb.2);

    if color_distance(rgb, cube_packed) <= color_distance(rgb, gray_packed) {
        cube_packed
    } else {
        gray_packed
    }
}

fn quantize_mono(rgb: u32) -> u32 {
    let (r, g, b) = unpack_rgb(rgb);
    let luma = (r as u16 * 54 + g as u16 * 183 + b as u16 * 19) / 256;
    if luma > 127 {
        0xffffff
    } else {
        0x000000
    }
}

fn quantize_color(r: u8, g: u8, b: u8, mode: u8) -> u32 {
    let rgb = pack_rgb(r, g, b);
    match mode {
        1 => quantize_ansi256(rgb),
        2 => quantize_mono(rgb),
        _ => rgb,
    }
}

fn push_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn build_counts(colors: &[u32; 4]) -> Vec<(u32, usize)> {
    let mut counts: Vec<(u32, usize)> = Vec::new();
    for color in colors {
      if let Some(entry) = counts.iter_mut().find(|(existing, _)| existing == color) {
          entry.1 += 1;
      } else {
          counts.push((*color, 1));
      }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    counts
}

fn pixel_offset(width: u32, x: u32, y: u32) -> usize {
    ((y * width + x) * 4) as usize
}

#[no_mangle]
pub unsafe extern "C" fn tb_decode_image(input: *const u8, input_len: usize) -> *mut TbBuffer {
    if input.is_null() || input_len == 0 {
        return ptr::null_mut();
    }

    let bytes = std::slice::from_raw_parts(input, input_len);
    let Ok(image) = image::load_from_memory(bytes) else {
        return ptr::null_mut();
    };
    let rgba = image.to_rgba8();
    TbBuffer::from_vec(rgba.into_raw(), image.width(), image.height())
}

#[no_mangle]
pub unsafe extern "C" fn tb_resize_rgba(
    input: *const u8,
    width: u32,
    height: u32,
    new_width: u32,
    new_height: u32,
) -> *mut TbBuffer {
    if input.is_null() || width == 0 || height == 0 || new_width == 0 || new_height == 0 {
        return ptr::null_mut();
    }

    let bytes = std::slice::from_raw_parts(input, (width * height * 4) as usize).to_vec();
    let Some(image): Option<RgbaImage> = ImageBuffer::from_raw(width, height, bytes) else {
        return ptr::null_mut();
    };

    let resized = image::imageops::resize(&image, new_width, new_height, FilterType::Triangle);
    TbBuffer::from_vec(resized.into_raw(), new_width, new_height)
}

#[no_mangle]
pub unsafe extern "C" fn tb_render_cells(
    input: *const u8,
    width: u32,
    height: u32,
    color_mode: u8,
) -> *mut TbBuffer {
    if input.is_null() || width < 2 || height < 2 {
        return ptr::null_mut();
    }

    let pixels = std::slice::from_raw_parts(input, (width * height * 4) as usize);
    let cell_width = width / 2;
    let cell_height = height / 2;
    let mut output = Vec::with_capacity((cell_width * cell_height * 12) as usize);

    for row in 0..cell_height {
        for column in 0..cell_width {
            let positions = [
                (column * 2, row * 2),
                (column * 2 + 1, row * 2),
                (column * 2, row * 2 + 1),
                (column * 2 + 1, row * 2 + 1),
            ];

            let mut colors = [0u32; 4];
            for (index, (x, y)) in positions.iter().enumerate() {
                let offset = pixel_offset(width, *x, *y);
                colors[index] = quantize_color(pixels[offset], pixels[offset + 1], pixels[offset + 2], color_mode);
            }

            let counts = build_counts(&colors);
            let bg = counts[0].0;
            let fg = counts.get(1).map(|entry| entry.0).unwrap_or(bg);

            let mask = if fg == bg {
                0u32
            } else {
                let mut mask = 0u32;
                for (index, color) in colors.iter().enumerate() {
                    let use_fg = if *color == fg {
                        true
                    } else if *color == bg {
                        false
                    } else {
                        color_distance(*color, fg) <= color_distance(*color, bg)
                    };

                    if use_fg {
                        mask |= 1 << index;
                    }
                }
                mask
            };

            push_u32(&mut output, GLYPHS[mask as usize] as u32);
            push_u32(&mut output, fg);
            push_u32(&mut output, bg);
        }
    }

    TbBuffer::from_vec(output, cell_width, cell_height)
}

#[no_mangle]
pub unsafe extern "C" fn tb_buffer_free(buf: *mut TbBuffer) {
    if buf.is_null() {
        return;
    }
    let buffer = Box::from_raw(buf);
    buffer.free();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantize_mono_returns_black_or_white() {
        assert_eq!(quantize_mono(0x000000), 0x000000);
        assert_eq!(quantize_mono(0xffffff), 0xffffff);
    }

    #[test]
    fn glyph_table_covers_all_masks() {
        assert_eq!(GLYPHS.len(), 16);
        assert_eq!(GLYPHS[0], ' ');
        assert_eq!(GLYPHS[15], '█');
    }
}
