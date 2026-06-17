//! Bundeseinheitlicher Medikationsplan (BMP) — carrier (2D Data-Matrix) payload.
//!
//! Builds the XML "Ultrakurzformat" carrier segment per the BMP specification
//! (Anlage 3 zu Anhang 31a BMV-Ä) and encodes it as an ECC200 Data-Matrix.
//!
//! The carrier string has no XML prolog, no whitespace between elements, and is
//! stored as ISO-8859-1 bytes. Schema (single-letter attributes):
//!
//! ```xml
//! <MP U="32-hex-GUID" v="022" l="de-DE">
//!   <P g="Vorname" f="Nachname" b="YYYY-MM-DD" s="M|W|X"/>
//!   <A n="Praxis" s="Straße" z="PLZ" c="Ort" p="Tel" e="Mail" t="YYYY-MM-DD"/>
//!   <O/>
//!   <S>            <!-- Dauermedikation: default section, no heading -->
//!     <M a="Handelsname" fd="Form" m="1" d="0" v="1" h="0" dud="Stück" i="Hinweis" r="Grund">
//!       <W w="Wirkstoff" s="Stärke"/>
//!     </M>
//!   </S>
//!   <S t="Zu besonderen Zeiten anzuwendende Medikamente"> … </S>
//!   <S t="Selbstmedikation"> … </S>
//! </MP>
//! ```

use datamatrix::{DataMatrix, SymbolList};

/// BMP specification version encoded in the carrier (`MP.v`).
pub const BMP_VERSION: &str = "022";

#[derive(Debug, Default, Clone)]
pub struct BmpPatient {
    pub vorname: String,
    pub nachname: String,
    /// `YYYY-MM-DD` (may be partial per the spec).
    pub geburtsdatum: Option<String>,
    /// `M` | `W` | `X`.
    pub geschlecht: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct BmpIssuer {
    pub name: String,
    pub strasse: Option<String>,
    pub plz: Option<String>,
    pub ort: Option<String>,
    pub telefon: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct BmpMed {
    /// `dauer` | `besondere` | `selbst` (anything else → trailing default section).
    pub category: String,
    pub wirkstoff: Option<String>,
    pub handelsname: Option<String>,
    pub staerke: Option<String>,
    pub form: Option<String>,
    pub dose_morgens: Option<String>,
    pub dose_mittags: Option<String>,
    pub dose_abends: Option<String>,
    pub dose_nachts: Option<String>,
    pub einheit: Option<String>,
    pub hinweis: Option<String>,
    pub grund: Option<String>,
}

/// XML-escape a value for use inside a double-quoted attribute.
fn esc(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn attr_opt(out: &mut String, key: &str, value: &Option<String>) {
    if let Some(v) = value {
        attr_str(out, key, v);
    }
}

fn attr_str(out: &mut String, key: &str, value: &str) {
    let v = value.trim();
    if v.is_empty() {
        return;
    }
    out.push(' ');
    out.push_str(key);
    out.push_str("=\"");
    out.push_str(&esc(v));
    out.push('"');
}

fn has_text(value: &Option<String>) -> bool {
    value.as_ref().is_some_and(|v| !v.trim().is_empty())
}

fn push_med(out: &mut String, m: &BmpMed) {
    out.push_str("<M");
    attr_opt(out, "a", &m.handelsname);
    attr_opt(out, "fd", &m.form);
    attr_opt(out, "m", &m.dose_morgens);
    attr_opt(out, "d", &m.dose_mittags);
    attr_opt(out, "v", &m.dose_abends);
    attr_opt(out, "h", &m.dose_nachts);
    attr_opt(out, "dud", &m.einheit);
    attr_opt(out, "i", &m.hinweis);
    attr_opt(out, "r", &m.grund);
    // Wirkstoff + Wirkstärke live in a nested <W> element.
    if has_text(&m.wirkstoff) || has_text(&m.staerke) {
        out.push('>');
        out.push_str("<W");
        attr_opt(out, "w", &m.wirkstoff);
        attr_opt(out, "s", &m.staerke);
        out.push_str("/></M>");
    } else {
        out.push_str("/>");
    }
}

/// The three standard BMP sections, in print order. A `None` heading is the
/// default Dauermedikation block (rendered without a heading, per the spec).
const BMP_SECTIONS: [(&str, Option<&str>); 3] = [
    ("dauer", None),
    (
        "besondere",
        Some("Zu besonderen Zeiten anzuwendende Medikamente"),
    ),
    ("selbst", Some("Selbstmedikation")),
];

/// Builds the BMP carrier XML string (no prolog, no inter-element whitespace).
/// `plan_uuid` should be a 32-char uppercase hex GUID (no dashes).
pub fn build_bmp_xml(
    plan_uuid: &str,
    patient: &BmpPatient,
    issuer: &BmpIssuer,
    print_date: &str,
    meds: &[BmpMed],
) -> String {
    let mut out = String::new();
    out.push_str("<MP");
    attr_str(&mut out, "U", plan_uuid);
    attr_str(&mut out, "v", BMP_VERSION);
    attr_str(&mut out, "l", "de-DE");
    out.push('>');

    out.push_str("<P");
    attr_str(&mut out, "g", &patient.vorname);
    attr_str(&mut out, "f", &patient.nachname);
    attr_opt(&mut out, "b", &patient.geburtsdatum);
    attr_opt(&mut out, "s", &patient.geschlecht);
    out.push_str("/>");

    out.push_str("<A");
    attr_str(&mut out, "n", &issuer.name);
    attr_opt(&mut out, "s", &issuer.strasse);
    attr_opt(&mut out, "z", &issuer.plz);
    attr_opt(&mut out, "c", &issuer.ort);
    attr_opt(&mut out, "p", &issuer.telefon);
    attr_opt(&mut out, "e", &issuer.email);
    attr_str(&mut out, "t", print_date);
    out.push_str("/>");

    out.push_str("<O/>");

    for (key, heading) in BMP_SECTIONS {
        let rows = meds.iter().filter(|m| m.category == key);
        push_section(&mut out, heading, rows);
    }
    // Anything with an unrecognised category goes into a trailing default block.
    let known = BMP_SECTIONS.map(|(k, _)| k);
    let other = meds.iter().filter(|m| !known.contains(&m.category.as_str()));
    push_section(&mut out, None, other);

    out.push_str("</MP>");
    out
}

fn push_section<'a>(out: &mut String, heading: Option<&str>, rows: impl Iterator<Item = &'a BmpMed>) {
    let rows: Vec<&BmpMed> = rows.collect();
    if rows.is_empty() {
        return;
    }
    out.push_str("<S");
    if let Some(h) = heading {
        attr_str(out, "t", h);
    }
    out.push('>');
    for m in rows {
        push_med(out, m);
    }
    out.push_str("</S>");
}

/// Set ("black") module coordinates plus the symbol width/height (in modules).
pub type DataMatrixModules = (Vec<(usize, usize)>, usize, usize);

/// Encodes the carrier XML as an ECC200 Data-Matrix. Returns the set ("black")
/// module coordinates plus the symbol width/height (in modules), or `None` on
/// failure. The payload is stored as ISO-8859-1 bytes per the BMP spec.
pub fn encode_datamatrix(payload: &str) -> Option<DataMatrixModules> {
    let latin1: Vec<u8> = payload
        .chars()
        .map(|c| if (c as u32) <= 0xFF { c as u8 } else { b'?' })
        .collect();
    let code = DataMatrix::encode(&latin1, SymbolList::default()).ok()?;
    let bitmap = code.bitmap();
    let (width, height) = (bitmap.width(), bitmap.height());
    let pixels: Vec<(usize, usize)> = bitmap.pixels().collect();
    Some((pixels, width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_meds() -> Vec<BmpMed> {
        vec![
            BmpMed {
                category: "dauer".into(),
                wirkstoff: Some("Metformin".into()),
                handelsname: Some("Metformin Atid".into()),
                staerke: Some("500 mg".into()),
                form: Some("Filmtabl.".into()),
                dose_morgens: Some("1".into()),
                dose_abends: Some("1".into()),
                einheit: Some("Stück".into()),
                hinweis: Some("nach den Mahlzeiten".into()),
                grund: Some("Blutzucker".into()),
                ..Default::default()
            },
            BmpMed {
                category: "selbst".into(),
                handelsname: Some("Roter Reis".into()),
                grund: Some("Blutfette".into()),
                ..Default::default()
            },
        ]
    }

    #[test]
    fn builds_bmp_carrier_xml() {
        let patient = BmpPatient {
            vorname: "Maxi".into(),
            nachname: "Mustermann".into(),
            geburtsdatum: Some("1960-01-01".into()),
            geschlecht: Some("X".into()),
        };
        let issuer = BmpIssuer {
            name: "Praxis Dr. Anton".into(),
            strasse: Some("Gallenweg 6".into()),
            plz: Some("10115".into()),
            ort: Some("Berlin".into()),
            telefon: Some("030-123456".into()),
            email: None,
        };
        let xml = build_bmp_xml(
            "ABCDEF0123456789ABCDEF0123456789",
            &patient,
            &issuer,
            "2026-06-17",
            &sample_meds(),
        );

        assert!(xml.starts_with("<MP U=\"ABCDEF0123456789ABCDEF0123456789\" v=\"022\" l=\"de-DE\">"));
        assert!(xml.contains("<P g=\"Maxi\" f=\"Mustermann\" b=\"1960-01-01\" s=\"X\"/>"));
        assert!(xml.contains(
            "<A n=\"Praxis Dr. Anton\" s=\"Gallenweg 6\" z=\"10115\" c=\"Berlin\" p=\"030-123456\" t=\"2026-06-17\"/>"
        ));
        // Dauermedikation: default section with no heading; Wirkstoff/Stärke nested in <W>.
        assert!(xml.contains(
            "<S><M a=\"Metformin Atid\" fd=\"Filmtabl.\" m=\"1\" v=\"1\" dud=\"Stück\" i=\"nach den Mahlzeiten\" r=\"Blutzucker\"><W w=\"Metformin\" s=\"500 mg\"/></M></S>"
        ));
        // Selbstmedikation: free-text heading, PZN-less medication without <W>.
        assert!(xml.contains("<S t=\"Selbstmedikation\"><M a=\"Roter Reis\" r=\"Blutfette\"/></S>"));
        assert!(xml.ends_with("</MP>"));
        // No empty "Zu besonderen Zeiten" section is emitted.
        assert!(!xml.contains("Zu besonderen Zeiten"));
    }

    #[test]
    fn escapes_special_characters() {
        let xml = build_bmp_xml(
            "U",
            &BmpPatient {
                vorname: "A&B".into(),
                nachname: "<X>".into(),
                ..Default::default()
            },
            &BmpIssuer {
                name: "Praxis".into(),
                ..Default::default()
            },
            "2026-06-17",
            &[],
        );
        assert!(xml.contains("g=\"A&amp;B\" f=\"&lt;X&gt;\""));
    }

    #[test]
    fn encodes_a_scannable_datamatrix() {
        let xml = build_bmp_xml(
            "ABCDEF0123456789ABCDEF0123456789",
            &BmpPatient {
                vorname: "Maxi".into(),
                nachname: "Mustermann".into(),
                ..Default::default()
            },
            &BmpIssuer {
                name: "Praxis".into(),
                ..Default::default()
            },
            "2026-06-17",
            &sample_meds(),
        );
        let (pixels, width, height) = encode_datamatrix(&xml).expect("datamatrix encodes");
        assert!(width >= 10 && height >= 10);
        assert!(!pixels.is_empty());
        assert!(pixels.iter().all(|&(x, y)| x < width && y < height));
    }
}
