//! Vector rendering of the gmed wordmark for generated PDF documents.
//!
//! The path data mirrors the marketing site logo (`LogoSvgOld`). The SVG is
//! parsed once into cubic-bezier rings and replayed as filled PDF polygons, so
//! documents get a crisp vector logo without image or SVG dependencies.

use std::sync::OnceLock;

use printpdf::{Color, LinePoint, Mm, Op, PaintMode, Point, Polygon, PolygonRing, WindingOrder};

/// Logo aspect ratio from the source SVG: `viewBox="0 0 726 286"`.
pub const GMED_LOGO_ASPECT: f32 = 726.0 / 286.0;
const VIEWBOX_HEIGHT: f32 = 286.0;

const GMED_LOGO_PATHS: &[&str] = &[
    "M502.995 141.388c6.298.026 13.472-.102 19.697.13l.432.378c.805 20.367-.237 43.156.244 63.997l.209.537c-.558 3.785-.404 8.852-.406 12.797l-.005 18.84.012 21.18c.005 4.317-.136 9.875.341 14.05l.021.26-20.54.035.077-.394c.252-.749.608-129.207-.054-131.44z",
    "M590.269 245.191c1.707 2.071-.117 24.02.85 28.784l-1.535-.451c-2.909-1.022-30.361.856-32.49-.895 18.444-2.84 27.638-9.448 33.175-27.438",
    "M556.213 189.474c1.29 1.713.717 1.717 1.053 4.286-.07 6.758-.28 15.384-.021 22.032-.091 2.202.144 4.613-.882 6.423-2.47-8.739-8.931-14.917-18.229-15.77l-.677-1.292c9.872-1.278 16.101-6.12 18.756-15.679",
    "M557.815 141.458c6.387.003 17.208-.308 23.279.153-.025 4.443.901 24.181-.628 26.423-3.432-15.465-9.611-22.15-25.24-25.635l.212-.484z",
    "M524.811 141.138c6.368-.169 13.271-.242 19.635-.076 12.212.317 25.013-.468 37.157.144-.065 5.109.407 30.773-.417 33.102-.784-.909-1.03-5.135-.72-6.274 1.529-2.242.603-21.98.628-26.423-6.071-.461-16.892-.15-23.279-.153l-8.14-.035c-4.555-.04-21.491.382-24.864-.285",
    "M590.269 245.191c.03-2.167.12-5.278.574-7.35l.34-.176c.653 2.592.301 35.829-.064 36.31-.967-4.764.857-26.713-.85-28.784",
    "M523.54 273.557c9.075-.09 18.199.097 27.296.039 3.287-.007 8.408-.171 11.55.049-8.397.815-23.541.277-32.583.308-7.049.024-21.026.409-27.744-.021l.941-.34z",
    "M550.741 273.196c1.916-.165 4.567-.614 6.353-.567 2.129 1.751 29.581-.127 32.49.895-3.045.774-22.65.149-27.198.121-3.142-.22-8.263-.056-11.55-.049z",
    "M485.416 141.404c2.078-.833 34.555-.331 39.173-.257l-1.897.371c-6.225-.232-13.399-.104-19.697-.13-5.836-.056-11.737.003-17.579.016",
    "M523.368 205.893c2.05-.562 10.942-.522 14.089-.74l.677 1.292c-5.139-.348-9.703.188-14.557-.015z",
    "M502.059 273.932c-3.023-.141-14.724.305-16.504-.542 4.996-.349 12.433-.211 17.522-.192l-.077.394z",
    "m524.589 141.147.222-.009c3.373.667 20.309.245 24.864.285l.105.438c-8.349-.231-18.323-.254-26.656.035l-.432-.378z",
    "M523.519 273.297c8.754-.05 18.594.168 27.222-.101l.095.4c-9.097.058-18.221-.129-27.296-.039z",
    "M556.213 189.474c.107-2.168.37-4.554.981-6.642.085 1.593.634 9.936.072 10.928-.336-2.569.237-2.573-1.053-4.286",
    "M557.245 215.792c.577 2.941.27 9.295-.058 12.424-.344-1.957-.772-4.023-.824-6.001 1.026-1.81.791-4.221.882-6.423",
    "M485.416 141.404c5.842-.013 11.743-.072 17.579-.016l.028.37c-2.155.092-16.664.332-17.607-.354",
    "m549.675 141.423 8.14.035-2.377.457-.212.484c-1.216-.012-4.116-.399-5.446-.538z",
    "M260.74 0h12.042c4.027.803 10.164.933 14.508 1.503a137.7 137.7 0 0 1 33.576 8.738c-2.99 1.31-5.598 2.825-8.436 4.42-19.782-8.336-38.113-11.205-59.443-9.986-4.354.25-12.662 1.855-15.555 1.77h-.798c-.344.545-1.324.882-1.926.997l-.103.135A134.59 134.59 0 0 0 151.97 69.37c-13.593 22.561-18.97 45.178-19.847 71.259 6.224.422 13.205.238 19.496.23l29.31-.005 94.278.01 25.414-.024c6.863-.048 13.431-.36 20.263.352l.458.502-.584.352c-.281 3.06-.226 9.058-.312 12.341a1118 1118 0 0 0-.256 37.265q-.284 40.806.384 81.607l.228.754c-2.812.69-8.984 3.349-12.788 4.474a159.4 159.4 0 0 1-39.479 6.547c-54.523 2.294-104.691-24.019-131.818-71.925-12.804-22.61-17.144-42.795-18.222-68.542-5.91.448-15.64-.079-21.9.042-9.34.18-18.988-.139-28.407.358-2.493.132-11.425-.593-13.135-.116l-1.062.075c-1.634-.569-8.354-.174-10.385-.218-6.942-.353-18.11.019-23.23 5.637-8.24 9.04-6.858 10.154-19.97 9.223 10.562-19.23 34.54-18.903 53.515-18.428l1.032-.25c4.195.503 13.402.096 18.186.173 15.009.244 30.301-.415 45.27-.121.005-30.044 11.975-62.328 30.71-85.622 15.563-19.349 36.36-34.792 59.479-43.907 5.498-2.168 11.966-4.845 17.858-5.506l.803-.105a2.7 2.7 0 0 1-.051-1.285c3.191.259 14.629-2.319 18.982-2.884 4.013-.521 10.908-.989 14.55-1.632m18.87 250.594c30.768-34.49 26.271-63.384 26.917-105.954l-121.878-.046-35.099.027c-3.633.005-14.284.236-17.357-.188-.402 35.393 15.064 70.927 39.726 96.11a138.84 138.84 0 0 0 51.976 33.467c9.375 3.356 11.114 4.454 20.584.685a99.1 99.1 0 0 0 32.905-21.588 23 23 0 0 0 2.226-2.513m-30.424 29.686c19.787 2.095 38.251 1.589 57.29-5.263.052-11.371.066-30.169-.124-42.056l-.426-.536-.432-.158c-14.445 22.358-31.829 36.832-57.443 45.303-1.191.394-1.041-.014-1.939.91.656 1.446 1.581 1.493 3.074 1.8",
    "M431.86 141.773c1.945-.725 18.035-.502 21.1-.496l.436.416c-.966.758-.802 2.251-.806 3.55-.102 37.532-.057 75.081-.064 112.612-.001 2.371-.211 13.942.402 15.399l.093.31-19.692-.029-.675-1.325c-.303-1.495-.188-8.457-.186-10.352l.025-22.196-.09-89.116c.3-.718.061-1.323.157-1.69.978-3.711-.439-4.355-.7-7.083",
    "M621.001 141.387c6.709.032 15.058.293 21.636.013l-.038.324-1.146.318c-.445 1.393-.735 124.802.083 131.233l.054.29c-6.757-.097-13.761.008-20.537.025l.105-.371c.265-1.232.168-12.847.169-14.927l.005-37.173-.005-57.176c-.001-3.246.162-20.338-.274-22.16z",
    "M337.452 142.165c.382-.62.495-.706 1.052-1.179 6.766.572 13.423.205 20.155.526 2.105 4.414 4.105 10.333 5.821 15l8.958 24.352 18.162 49.252c1.709 4.645 4 9.995 5.57 14.475.097 1.196.252 1.463.774 2.558-1.751 4.234-8.299 27.054-10.403 28.362-2.739-2.516-42.365-115.118-48.464-129.389l-.174-1.065c-.725.082-.772.143-1.415.52-.123-1.248-.079-2.174-.036-3.412",
    "M691.65 152.119c.142-1.041.461-1.312 1.139-2.113 4.606-.214 21.259 18.306 23.347 22.881 1.077 2.357 4.169 9.266 5.636 10.118 2.134 5.641 2.629 11.114 4.228 16.958v15.416c-1.063 4.145-2.077 10.568-3.161 14.014a67.28 67.28 0 0 1-30.457 37.589c-2.514 1.478-4.534 2.283-7.218 3.328-1.127-.222-.765-.105-1.653-1.054 20.076-11.345 20.8-39.457 21.004-59.805.167-16.69-1.243-44.247-12.865-57.332",
    "M53.92 141.139c.37-4.395.414-8.329.9-12.841a141.2 141.2 0 0 1 11.53-42.887c14.077-31.672 42.313-60.727 74.855-73.24l.66.724c-36.349 16.178-63.001 42.297-77.42 79.8a139.3 139.3 0 0 0-8.441 34.677c-.514 4.665-.599 9.059-1.05 13.517z",
    "M397.17 244.591c.458-.491.591-.781.803-1.398l21.965-65.766c3.258-9.715 9.53-26.311 11.922-35.654.261 2.728 1.678 3.372.7 7.083-.096.367.143.972-.157 1.69-.173-.841-.214-1.172-.621-1.961l-.539-.046c-1.404 3.024-5.728 16.507-6.998 20.171l-17.806 52.93-5.94 17.625c-.421 1.24-2.437 6.958-2.555 7.884-.522-1.095-.677-1.362-.774-2.558",
    "M253.426 12.833c34.289 15.274 58.28 39.596 73.706 73.698l-.902 1.073C311.72 52.88 286.434 29.2 252.651 13.607z",
    "M337.488 145.577c.643-.377.69-.438 1.415-.52l.174 1.065-.413.234c-.637 7.085-.387 16.394-.383 23.704l.004 37.136.008 39.065c0 6.766-.26 16.416.253 23.016l-1.141-2.188c-.222-4.163.028-11.053.03-15.418l.011-32.39c.006-24.025-.514-49.887.042-73.704",
    "M113.485 258.112c21.79 16.064 47.513 24.736 74.341 26.775 4.555.346 9.955-.206 14.027.128 2.048.476 4.64.101 5.553.985h-21.575c-1.847-.771-12.894-1.789-16.711-2.552-19.004-3.797-41.027-12.684-56.43-24.649z",
    "M669.77 141.376c19.368.779 37.314 14.38 46.85 30.698 2.292 3.923 3.346 6.925 5.152 10.931-1.467-.852-4.559-7.761-5.636-10.118-2.088-4.575-18.741-23.095-23.347-22.881-.678.801-.997 1.072-1.139 2.113-1.029-1.06-3.804-3.973-4.847-4.659-11.671-7.671-30.48-5.469-44.204-5.736l.038-.324c7.184.043 20.456.489 27.133-.024",
    "M141.205 12.172a141.3 141.3 0 0 1 73.279-10.02c3.575.483 9.535 1.183 12.724 2.364-.083.492-.071.8.051 1.285l-.803.105c-.789-1.455-9.335-2.315-11.239-2.592-22.761-3.31-52.43-.062-73.352 9.58z",
    "m53.991 144.925 1.062-.075a141.8 141.8 0 0 0 17.595 67.28c.702 1.249 4.794 8.309 5.553 9.185l-.718.783c-15.802-24.22-22.734-48.482-23.492-77.173",
    "M335.309 110.805c2.231 5.8 4.477 23.96 3.195 30.181-.557.473-.67.559-1.052 1.179-4.078-.456-12.31-.158-16.694-.12l.584-.352-.458-.502c5.391-.309 10.942.033 16.46-.174-.041-7.577-.485-19.996-2.887-27.247.121-1.421.113-1.771.852-2.965",
    "M78.2 221.315c8.099 12.029 22.883 29.045 35.285 36.797l-.795.687c-12.027-7.406-27.484-24.957-35.207-36.701z",
    "m603.861 141.672-.368-.082.412-.362c2.451-.345 7.777-.205 10.479-.203l18.933.017 23.157-.011c3.447.001 10.219-.177 13.296.345-6.677.513-19.949.067-27.133.024-6.578.28-14.927.019-21.636-.013-2.873-.007-14.99-.194-17.14.285",
    "m432.654 272.21.675 1.325c-2.302-.056-4.265-.011-6.568.082-3.716-.075-8.037.35-11.657-.366l-.103-.284c4.549-1.514 15.099.227 17.653-.757",
    "m234.605 7.577.103-.135c.602-.115 1.582-.452 1.926-.997h.798c.961 1.03 13.365 5.274 15.994 6.388l-.775.774c-3.827-1.867-14.034-5.52-18.046-6.03",
    "M201.853 285.015c6.986-.193 13.957-1.289 20.86-2.403.417.232.902.471 1.266.764-2.477.541-15.489 1.872-16.317 2.624h-.256c-.913-.884-3.505-.509-5.553-.985",
    "M641.59 273.565q9.063-.04 18.125.032c2.73.004 7.575-.158 10.064.045-2.723.443-8.028.341-11.024.342l-19.195-.072c-4.099-.008-16.014.325-19.398-.001l.891-.321c6.776-.017 13.78-.122 20.537-.025",
    "m337.405 267.089 1.141 2.188c.904 2.009 1.034 2.763 2.853 4.098-2.603.338-4.135.321-6.779.28l.165-.663c2.427-1.343 2.402-3.422 2.62-5.903",
    "M641.536 273.275c10.358-.015 22.591.398 32.703-1.025l.364.719 1.007.22-5.831.453c-2.489-.203-7.334-.041-10.064-.045q-9.062-.072-18.125-.032z",
    "m470.02 273.317.059.382c-1.45.443-40.383.394-43.318-.082 2.303-.093 4.266-.138 6.568-.082l19.692.029c5.047-.075 12.083.419 16.999-.247",
    "M328.492 89.922c1.485 3.201 2.763 6.962 3.86 10.325l-1.253-.074c-.534-.942-2.36-6.798-3.438-9.047z",
    "M341.399 273.375c1.845-.266 12.34-.364 13.859.136-2.789.53-19.653.589-22.928.399l2.29-.255c2.644.041 4.176.058 6.779-.28",
    "M683.511 269.256c.888.949.526.832 1.653 1.054a137 137 0 0 1-9.554 2.879l-1.007-.22-.364-.719a32 32 0 0 0 9.272-2.994",
    "m334.785 272.992-.165.663-2.29.255c-3.309.2-8.104.08-11.528.102l-.228-.754c4.342-.35 9.572-.049 14.211-.266",
    "m332.402 104.608 1.18.207c.488 1.108 1.746 4.915 1.727 5.99-.739 1.194-.731 1.544-.852 2.965-.128-2.964-1.477-6.104-2.055-9.162",
    "M603.804 273.314c4.82-.095 12.602-.337 17.354-.095l-.105.371-.891.321-.674-.038c-4.146-.81-11.182.281-15.684-.559",
    "M453.565 141.12c5.223.65 11.457-.124 16.455.552-3.369.102-13.642.385-16.624.021l-.436-.416z",
    "M603.861 141.672c2.15-.479 14.267-.292 17.14-.285l.052.396c-4.313.248-12.802.045-17.192-.111",
    "M453.565 141.12c3.3-.115 13.402-.277 16.51.048l-.055.504c-4.998-.676-11.232.098-16.455-.552",
    "M452.928 273.254c5.509-.01 11.63-.15 17.092.063-4.916.666-11.952.172-16.999.247z",
    "M619.488 273.873c-1.927.118-14.834.352-15.913-.249l.229-.31c4.502.84 11.538-.251 15.684.559",
    "m331.099 100.173 1.253.074 1.23 4.568-1.18-.207c-.502-1.5-.887-2.914-1.303-4.435",
    "M222.713 282.612c1.604-.306 3.27-.772 4.839-.421l.098.335c-1.318.607-2.253.662-3.671.85-.364-.293-.849-.532-1.266-.764",
    "m327.132 86.53 1.36 3.392-.831 1.204c-.138-1.01-.971-2.564-1.431-3.522z",
];

/// (x, y, is-bezier-control) in SVG user units, y pointing down.
type UnitPoint = (f32, f32, bool);
/// One SVG path element: subpath rings of unit points.
type UnitPath = Vec<Vec<UnitPoint>>;

struct PathTokens<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> PathTokens<'a> {
    fn new(data: &'a str) -> Self {
        Self {
            bytes: data.as_bytes(),
            pos: 0,
        }
    }

    fn skip_separators(&mut self) {
        while self.pos < self.bytes.len() {
            let byte = self.bytes[self.pos];
            if byte == b' ' || byte == b',' || byte == b'\n' || byte == b'\t' || byte == b'\r' {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn next_command(&mut self) -> Option<u8> {
        self.skip_separators();
        let byte = *self.bytes.get(self.pos)?;
        if byte.is_ascii_alphabetic() {
            self.pos += 1;
            Some(byte)
        } else {
            None
        }
    }

    fn next_number(&mut self) -> Option<f32> {
        self.skip_separators();
        let start = self.pos;
        let mut seen_digit = false;
        let mut seen_dot = false;
        while self.pos < self.bytes.len() {
            let byte = self.bytes[self.pos];
            match byte {
                b'0'..=b'9' => {
                    seen_digit = true;
                    self.pos += 1;
                }
                b'.' if !seen_dot => {
                    seen_dot = true;
                    self.pos += 1;
                }
                b'-' | b'+' if self.pos == start => {
                    self.pos += 1;
                }
                _ => break,
            }
        }
        if !seen_digit {
            self.pos = start;
            return None;
        }
        std::str::from_utf8(&self.bytes[start..self.pos])
            .ok()
            .and_then(|text| text.parse::<f32>().ok())
    }

    /// Arc flags are single characters and may be glued to the next number.
    fn next_flag(&mut self) -> Option<f32> {
        self.skip_separators();
        match self.bytes.get(self.pos)? {
            b'0' => {
                self.pos += 1;
                Some(0.0)
            }
            b'1' => {
                self.pos += 1;
                Some(1.0)
            }
            _ => None,
        }
    }

    fn exhausted(&mut self) -> bool {
        self.skip_separators();
        self.pos >= self.bytes.len()
    }
}

fn push_cubic(ring: &mut Vec<UnitPoint>, c1: (f32, f32), c2: (f32, f32), end: (f32, f32)) {
    ring.push((c1.0, c1.1, true));
    ring.push((c2.0, c2.1, true));
    ring.push((end.0, end.1, false));
}

/// Convert an SVG arc segment to cubic beziers appended to `ring`.
#[allow(clippy::too_many_arguments)]
fn arc_to_cubics(
    ring: &mut Vec<UnitPoint>,
    from: (f32, f32),
    mut rx: f32,
    mut ry: f32,
    x_rotation_deg: f32,
    large_arc: bool,
    sweep: bool,
    to: (f32, f32),
) {
    // W3C SVG implementation notes, endpoint to center parameterization.
    if rx == 0.0 || ry == 0.0 {
        ring.push((to.0, to.1, false));
        return;
    }
    rx = rx.abs();
    ry = ry.abs();
    let phi = x_rotation_deg.to_radians();
    let (sin_phi, cos_phi) = phi.sin_cos();
    let dx2 = (from.0 - to.0) / 2.0;
    let dy2 = (from.1 - to.1) / 2.0;
    let x1p = cos_phi * dx2 + sin_phi * dy2;
    let y1p = -sin_phi * dx2 + cos_phi * dy2;

    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if lambda > 1.0 {
        let scale = lambda.sqrt();
        rx *= scale;
        ry *= scale;
    }

    let numerator = (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p).max(0.0);
    let denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let mut coefficient = if denominator == 0.0 {
        0.0
    } else {
        (numerator / denominator).sqrt()
    };
    if large_arc == sweep {
        coefficient = -coefficient;
    }
    let cxp = coefficient * rx * y1p / ry;
    let cyp = -coefficient * ry * x1p / rx;
    let cx = cos_phi * cxp - sin_phi * cyp + (from.0 + to.0) / 2.0;
    let cy = sin_phi * cxp + cos_phi * cyp + (from.1 + to.1) / 2.0;

    let angle = |ux: f32, uy: f32, vx: f32, vy: f32| -> f32 {
        let dot = ux * vx + uy * vy;
        let len = (ux * ux + uy * uy).sqrt() * (vx * vx + vy * vy).sqrt();
        let mut value = (dot / len).clamp(-1.0, 1.0).acos();
        if ux * vy - uy * vx < 0.0 {
            value = -value;
        }
        value
    };
    let theta1 = angle(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let mut delta = angle(
        (x1p - cxp) / rx,
        (y1p - cyp) / ry,
        (-x1p - cxp) / rx,
        (-y1p - cyp) / ry,
    );
    if !sweep && delta > 0.0 {
        delta -= std::f32::consts::TAU;
    } else if sweep && delta < 0.0 {
        delta += std::f32::consts::TAU;
    }

    let segments = ((delta.abs() / std::f32::consts::FRAC_PI_2).ceil() as usize).max(1);
    let step = delta / segments as f32;
    let alpha = 4.0 / 3.0 * (step / 4.0).tan();

    let point_at = |theta: f32| -> (f32, f32) {
        let (sin_t, cos_t) = theta.sin_cos();
        (
            cx + rx * cos_t * cos_phi - ry * sin_t * sin_phi,
            cy + rx * cos_t * sin_phi + ry * sin_t * cos_phi,
        )
    };
    let derivative_at = |theta: f32| -> (f32, f32) {
        let (sin_t, cos_t) = theta.sin_cos();
        (
            -rx * sin_t * cos_phi - ry * cos_t * sin_phi,
            -rx * sin_t * sin_phi + ry * cos_t * cos_phi,
        )
    };

    let mut theta = theta1;
    for _ in 0..segments {
        let theta_next = theta + step;
        let end = point_at(theta_next);
        let start = point_at(theta);
        let d1 = derivative_at(theta);
        let d2 = derivative_at(theta_next);
        push_cubic(
            ring,
            (start.0 + alpha * d1.0, start.1 + alpha * d1.1),
            (end.0 - alpha * d2.0, end.1 - alpha * d2.1),
            end,
        );
        theta = theta_next;
    }
}

fn parse_path(data: &str) -> UnitPath {
    let mut tokens = PathTokens::new(data);
    let mut rings: UnitPath = Vec::new();
    let mut ring: Vec<UnitPoint> = Vec::new();
    let mut current = (0.0_f32, 0.0_f32);
    let mut subpath_start = current;
    let mut command = 0_u8;

    while !tokens.exhausted() {
        if let Some(next) = tokens.next_command() {
            command = next;
        } else if command == b'M' {
            // Implicit repeats after a moveto continue as lineto.
            command = b'L';
        } else if command == b'm' {
            command = b'l';
        }

        match command {
            b'M' | b'm' => {
                let Some(x) = tokens.next_number() else { break };
                let Some(y) = tokens.next_number() else { break };
                let target = if command == b'm' {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                if ring.len() > 1 {
                    rings.push(std::mem::take(&mut ring));
                } else {
                    ring.clear();
                }
                current = target;
                subpath_start = target;
                ring.push((target.0, target.1, false));
            }
            b'L' | b'l' => {
                let Some(x) = tokens.next_number() else { break };
                let Some(y) = tokens.next_number() else { break };
                current = if command == b'l' {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                ring.push((current.0, current.1, false));
            }
            b'H' | b'h' => {
                let Some(x) = tokens.next_number() else { break };
                current.0 = if command == b'h' { current.0 + x } else { x };
                ring.push((current.0, current.1, false));
            }
            b'V' | b'v' => {
                let Some(y) = tokens.next_number() else { break };
                current.1 = if command == b'v' { current.1 + y } else { y };
                ring.push((current.0, current.1, false));
            }
            b'C' | b'c' => {
                let Some(x1) = tokens.next_number() else {
                    break;
                };
                let Some(y1) = tokens.next_number() else {
                    break;
                };
                let Some(x2) = tokens.next_number() else {
                    break;
                };
                let Some(y2) = tokens.next_number() else {
                    break;
                };
                let Some(x) = tokens.next_number() else { break };
                let Some(y) = tokens.next_number() else { break };
                let (c1, c2, end) = if command == b'c' {
                    (
                        (current.0 + x1, current.1 + y1),
                        (current.0 + x2, current.1 + y2),
                        (current.0 + x, current.1 + y),
                    )
                } else {
                    ((x1, y1), (x2, y2), (x, y))
                };
                push_cubic(&mut ring, c1, c2, end);
                current = end;
            }
            b'Q' | b'q' => {
                let Some(x1) = tokens.next_number() else {
                    break;
                };
                let Some(y1) = tokens.next_number() else {
                    break;
                };
                let Some(x) = tokens.next_number() else { break };
                let Some(y) = tokens.next_number() else { break };
                let (control, end) = if command == b'q' {
                    (
                        (current.0 + x1, current.1 + y1),
                        (current.0 + x, current.1 + y),
                    )
                } else {
                    ((x1, y1), (x, y))
                };
                // Elevate the quadratic segment to a cubic one.
                let c1 = (
                    current.0 + 2.0 / 3.0 * (control.0 - current.0),
                    current.1 + 2.0 / 3.0 * (control.1 - current.1),
                );
                let c2 = (
                    end.0 + 2.0 / 3.0 * (control.0 - end.0),
                    end.1 + 2.0 / 3.0 * (control.1 - end.1),
                );
                push_cubic(&mut ring, c1, c2, end);
                current = end;
            }
            b'A' | b'a' => {
                let Some(rx) = tokens.next_number() else {
                    break;
                };
                let Some(ry) = tokens.next_number() else {
                    break;
                };
                let Some(rotation) = tokens.next_number() else {
                    break;
                };
                let Some(large_arc) = tokens.next_flag() else {
                    break;
                };
                let Some(sweep) = tokens.next_flag() else {
                    break;
                };
                let Some(x) = tokens.next_number() else { break };
                let Some(y) = tokens.next_number() else { break };
                let end = if command == b'a' {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                arc_to_cubics(
                    &mut ring,
                    current,
                    rx,
                    ry,
                    rotation,
                    large_arc != 0.0,
                    sweep != 0.0,
                    end,
                );
                current = end;
            }
            b'Z' | b'z' => {
                if ring.len() > 1 {
                    rings.push(std::mem::take(&mut ring));
                } else {
                    ring.clear();
                }
                current = subpath_start;
            }
            _ => break,
        }
    }
    if ring.len() > 1 {
        rings.push(ring);
    }
    rings
}

fn parsed_logo() -> &'static Vec<UnitPath> {
    static PARSED: OnceLock<Vec<UnitPath>> = OnceLock::new();
    PARSED.get_or_init(|| {
        GMED_LOGO_PATHS
            .iter()
            .map(|data| parse_path(data))
            .collect()
    })
}

/// Ops drawing the gmed wordmark with its top-left corner at
/// (`left_mm`, `top_mm`), scaled to `height_mm`, filled with `color`.
pub fn gmed_logo_ops(left_mm: f32, top_mm: f32, height_mm: f32, color: Color) -> Vec<Op> {
    let scale = height_mm / VIEWBOX_HEIGHT;
    let mut ops = vec![Op::SetFillColor { col: color }];
    for path in parsed_logo() {
        if path.is_empty() {
            continue;
        }
        let rings = path
            .iter()
            .map(|ring| PolygonRing {
                points: ring
                    .iter()
                    .map(|(x, y, bezier)| LinePoint {
                        p: Point::new(Mm(left_mm + x * scale), Mm(top_mm - y * scale)),
                        bezier: *bezier,
                    })
                    .collect(),
            })
            .collect();
        ops.push(Op::DrawPolygon {
            polygon: Polygon {
                rings,
                mode: PaintMode::Fill,
                winding_order: WindingOrder::NonZero,
            },
        });
    }
    ops
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logo_parses_into_expected_path_count() {
        let parsed = parsed_logo();
        assert_eq!(parsed.len(), GMED_LOGO_PATHS.len());
        let rings: usize = parsed.iter().map(|path| path.len()).sum();
        assert!(rings >= GMED_LOGO_PATHS.len(), "every path yields rings");
        let points: usize = parsed
            .iter()
            .flat_map(|path| path.iter())
            .map(|ring| ring.len())
            .sum();
        assert!(
            points > 1_000,
            "wordmark should be densely described, got {points}"
        );
    }

    #[test]
    fn logo_points_stay_inside_viewbox() {
        for path in parsed_logo() {
            for ring in path {
                for (x, y, _) in ring {
                    assert!((-40.0..=766.0).contains(x), "x out of bounds: {x}");
                    assert!((-40.0..=326.0).contains(y), "y out of bounds: {y}");
                }
            }
        }
    }

    #[test]
    fn logo_ops_scale_to_requested_box() {
        let ops = gmed_logo_ops(
            18.0,
            13.7,
            8.5,
            Color::Rgb(printpdf::Rgb::new(0.0, 0.0, 0.0, None)),
        );
        assert!(ops.len() > GMED_LOGO_PATHS.len() / 2);
    }
}
