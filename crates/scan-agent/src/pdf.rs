//! Assemble scanned JPEG pages into one PDF without re-encoding them: each
//! page embeds the scanner's JPEG bytes as a `DCTDecode` image.

use anyhow::{Result, bail};
use lopdf::{Document, Object, Stream, dictionary};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JpegInfo {
    pub width: u32,
    pub height: u32,
    pub components: u8,
}

/// Read the frame header (SOFn) of a baseline or progressive JPEG.
pub fn jpeg_info(data: &[u8]) -> Result<JpegInfo> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        bail!("the page is not a JPEG image");
    }
    let mut position = 2;
    while position + 4 <= data.len() {
        if data[position] != 0xFF {
            bail!("corrupt JPEG marker stream");
        }
        let marker = data[position + 1];
        // Fill bytes and standalone markers carry no length.
        if marker == 0xFF {
            position += 1;
            continue;
        }
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            position += 2;
            continue;
        }
        let length = usize::from(u16::from_be_bytes([data[position + 2], data[position + 3]]));
        if length < 2 || position + 2 + length > data.len() {
            bail!("truncated JPEG segment");
        }
        let is_frame_header =
            matches!(marker, 0xC0..=0xCF) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
        if is_frame_header {
            if length < 8 {
                bail!("truncated JPEG frame header");
            }
            let segment = &data[position + 4..position + 2 + length];
            let height = u32::from(u16::from_be_bytes([segment[1], segment[2]]));
            let width = u32::from(u16::from_be_bytes([segment[3], segment[4]]));
            let components = segment[5];
            if width == 0 || height == 0 {
                bail!("JPEG without image dimensions");
            }
            return Ok(JpegInfo {
                width,
                height,
                components,
            });
        }
        if marker == 0xDA {
            break;
        }
        position += 2 + length;
    }
    bail!("JPEG frame header not found")
}

/// Build a PDF with one page per JPEG, sized from the scan resolution.
pub fn jpeg_pages_to_pdf(pages: &[Vec<u8>], dpi: u32) -> Result<Vec<u8>> {
    if pages.is_empty() {
        bail!("no pages to put into the PDF");
    }
    if dpi == 0 {
        bail!("invalid scan resolution");
    }
    let mut document = Document::with_version("1.7");
    let pages_id = document.new_object_id();
    let mut kids = Vec::with_capacity(pages.len());
    for jpeg in pages {
        let info = jpeg_info(jpeg)?;
        let color_space = match info.components {
            1 => "DeviceGray",
            3 => "DeviceRGB",
            4 => "DeviceCMYK",
            other => bail!("unsupported JPEG with {other} color components"),
        };
        let image = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => i64::from(info.width),
                "Height" => i64::from(info.height),
                "ColorSpace" => color_space,
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            },
            jpeg.clone(),
        )
        .with_compression(false);
        let image_id = document.add_object(image);
        let width = info.width as f32 * 72.0 / dpi as f32;
        let height = info.height as f32 * 72.0 / dpi as f32;
        let content = format!("q {width:.3} 0 0 {height:.3} 0 0 cm /Scan Do Q");
        let content_id = document.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), Object::Real(width), Object::Real(height)],
            "Contents" => content_id,
            "Resources" => dictionary! {
                "XObject" => dictionary! { "Scan" => image_id },
            },
        });
        kids.push(Object::Reference(page_id));
    }
    let count = kids.len() as i64;
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => count,
        }),
    );
    let catalog_id = document.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    document.trailer.set("Root", catalog_id);
    let mut output = Vec::new();
    document.save_to(&mut output)?;
    Ok(output)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A structurally valid JPEG header (SOI, APP0, SOF0, SOS, EOI); enough
    /// for the parser and for embedding, not for decoding pixels.
    pub(crate) fn fake_jpeg(width: u16, height: u16, components: u8) -> Vec<u8> {
        let mut data = vec![0xFF, 0xD8];
        data.extend_from_slice(&[0xFF, 0xE0, 0x00, 0x10]);
        data.extend_from_slice(b"JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00");
        let sof_length = 8 + 3 * u16::from(components);
        data.extend_from_slice(&[0xFF, 0xC0]);
        data.extend_from_slice(&sof_length.to_be_bytes());
        data.push(8);
        data.extend_from_slice(&height.to_be_bytes());
        data.extend_from_slice(&width.to_be_bytes());
        data.push(components);
        for id in 1..=components {
            data.extend_from_slice(&[id, 0x11, 0x00]);
        }
        data.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        data.extend_from_slice(&[0x00, 0xFF, 0xD9]);
        data
    }

    #[test]
    fn reads_jpeg_dimensions() {
        let info = jpeg_info(&fake_jpeg(2480, 3508, 3)).unwrap();
        assert_eq!(
            info,
            JpegInfo {
                width: 2480,
                height: 3508,
                components: 3
            }
        );
        assert!(jpeg_info(b"%PDF-1.7").is_err());
        assert!(jpeg_info(&[0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02]).is_err());
    }

    #[test]
    fn builds_one_pdf_page_per_scan() {
        let pages = vec![fake_jpeg(2480, 3508, 3), fake_jpeg(2480, 3508, 1)];
        let pdf = jpeg_pages_to_pdf(&pages, 300).unwrap();
        assert!(pdf.starts_with(b"%PDF-1.7"));
        let document = Document::load_mem(&pdf).unwrap();
        let page_ids: Vec<_> = document.get_pages().into_values().collect();
        assert_eq!(page_ids.len(), 2);
        let first = document.get_dictionary(page_ids[0]).unwrap();
        let media_box = first.get(b"MediaBox").unwrap().as_array().unwrap();
        let width = media_box[2].as_float().unwrap();
        let height = media_box[3].as_float().unwrap();
        // A4 at 300 dpi is 595 x 842 pt.
        assert!((width - 595.2).abs() < 0.5, "{width}");
        assert!((height - 841.9).abs() < 0.5, "{height}");
        // The JPEG bytes are embedded untouched.
        assert!(
            pdf.windows(pages[0].len())
                .any(|window| window == pages[0].as_slice())
        );
    }
}
