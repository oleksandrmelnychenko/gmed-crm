//! Parser for the EU consolidated financial sanctions list, XML format 1.1 of
//! the Financial Sanctions Files (FSF) of the European Commission.
//!
//! Only what screening and the CEO's review need is kept: subject type, all
//! name variants, birth dates, citizenships, the legal acts (regulation,
//! programme, EUR-Lex link), the EU / UN references and the remark. Addresses,
//! identity documents and contact data of listed persons are skipped.

use chrono::{DateTime, NaiveDate, Utc};
use quick_xml::escape::resolve_xml_entity;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use serde::{Deserialize, Serialize};

/// Hard limits for one file. The real list is ~26 MB with ~5 500 entries.
pub const MAX_XML_BYTES: usize = 150 * 1024 * 1024;
const MAX_XML_EVENTS: usize = 40_000_000;
const MAX_XML_DEPTH: usize = 24;
const MAX_ATTRIBUTE_BYTES: usize = 20_000;
const MAX_REMARK_CHARS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SubjectType {
    #[default]
    Person,
    /// Enterprises, organisations and other non-persons.
    Entity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ListName {
    pub whole_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub middle_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
}

impl ListName {
    /// The whole name, or the parts joined when the list gives only parts.
    pub fn display(&self) -> String {
        let whole = self.whole_name.trim();
        if !whole.is_empty() {
            return whole.to_string();
        }
        [&self.first_name, &self.middle_name, &self.last_name]
            .iter()
            .filter_map(|part| part.as_deref())
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ListBirthDate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(default)]
    pub circa: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ListRegulation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub programme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publication_date: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_into_force_date: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// One listed person or entity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ListEntry {
    /// FSF `logicalId`: stable across list versions.
    pub logical_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eu_reference: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub un_reference: Option<String>,
    pub subject_type: SubjectType,
    #[serde(default)]
    pub names: Vec<ListName>,
    #[serde(default)]
    pub birth_dates: Vec<ListBirthDate>,
    /// Upper-case ISO 3166-1 alpha-2 codes.
    #[serde(default)]
    pub citizenships: Vec<String>,
    #[serde(default)]
    pub regulations: Vec<ListRegulation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub designation_date: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remark: Option<String>,
}

impl ListEntry {
    pub fn programmes(&self) -> Vec<String> {
        let mut programmes: Vec<String> = Vec::new();
        for regulation in &self.regulations {
            if let Some(programme) = regulation.programme.as_deref().map(str::trim)
                && !programme.is_empty()
                && !programmes.iter().any(|known| known == programme)
            {
                programmes.push(programme.to_string());
            }
        }
        programmes
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedList {
    pub generated_at: Option<DateTime<Utc>>,
    pub global_file_id: Option<String>,
    pub entries: Vec<ListEntry>,
}

impl ParsedList {
    pub fn person_count(&self) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry.subject_type == SubjectType::Person)
            .count()
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FsfParseError {
    #[error("the file is empty or larger than the allowed size")]
    Size,
    #[error("the file is not the EU consolidated sanctions list (FSF XML 1.1): {0}")]
    Format(String),
    #[error("the file contains no sanctioned persons or entities")]
    Empty,
}

fn invalid(message: impl Into<String>) -> FsfParseError {
    FsfParseError::Format(message.into())
}

#[derive(Default)]
struct ParseState {
    stack: Vec<String>,
    root_seen: bool,
    root_closed: bool,
    generated_at: Option<DateTime<Utc>>,
    global_file_id: Option<String>,
    entries: Vec<ListEntry>,
    current: Option<ListEntry>,
    current_regulation: Option<ListRegulation>,
    text: Option<String>,
}

/// Parses an FSF XML file.
pub fn parse_fsf_xml(bytes: &[u8]) -> Result<ParsedList, FsfParseError> {
    if bytes.is_empty() || bytes.len() > MAX_XML_BYTES {
        return Err(FsfParseError::Size);
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = true;
    let mut state = ParseState::default();
    let mut events = 0usize;

    loop {
        events += 1;
        if events > MAX_XML_EVENTS {
            return Err(invalid("too many XML nodes"));
        }
        match reader.read_event() {
            Ok(Event::Start(event)) => open_element(&reader, &mut state, &event, false)?,
            Ok(Event::Empty(event)) => open_element(&reader, &mut state, &event, true)?,
            Ok(Event::End(event)) => {
                let name = local_name(event.local_name().as_ref())?;
                close_element(&mut state, &name)?;
            }
            Ok(Event::Text(text)) => {
                if let Some(buffer) = state.text.as_mut() {
                    let decoded = text
                        .xml10_content()
                        .map_err(|error| invalid(format!("invalid text: {error}")))?;
                    buffer.push_str(decoded.as_ref());
                }
            }
            Ok(Event::CData(data)) => {
                if let Some(buffer) = state.text.as_mut() {
                    buffer.push_str(&String::from_utf8_lossy(data.as_ref()));
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if let Some(buffer) = state.text.as_mut() {
                    if reference.is_char_ref() {
                        if let Ok(Some(character)) = reference.resolve_char_ref() {
                            buffer.push(character);
                        }
                    } else {
                        let decoded = reference
                            .decode()
                            .map_err(|error| invalid(format!("invalid reference: {error}")))?;
                        let resolved = resolve_xml_entity(decoded.as_ref())
                            .ok_or_else(|| invalid("custom XML entities are not allowed"))?;
                        buffer.push_str(resolved);
                    }
                }
            }
            Ok(Event::DocType(_)) => return Err(invalid("DTD declarations are not allowed")),
            Ok(Event::Decl(_)) | Ok(Event::Comment(_)) | Ok(Event::PI(_)) => {}
            Ok(Event::Eof) => break,
            Err(error) => return Err(invalid(error.to_string())),
        }
    }

    if !state.root_seen || !state.root_closed || !state.stack.is_empty() {
        return Err(invalid("incomplete document"));
    }
    if state.entries.is_empty() {
        return Err(FsfParseError::Empty);
    }
    Ok(ParsedList {
        generated_at: state.generated_at,
        global_file_id: state.global_file_id,
        entries: state.entries,
    })
}

fn local_name(raw: &[u8]) -> Result<String, FsfParseError> {
    std::str::from_utf8(raw)
        .map(str::to_string)
        .map_err(|_| invalid("element name is not UTF-8"))
}

fn attributes(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
) -> Result<Vec<(String, String)>, FsfParseError> {
    let mut values = Vec::new();
    for attribute in event.attributes().with_checks(true) {
        let attribute = attribute.map_err(|error| invalid(error.to_string()))?;
        let name = local_name(attribute.key.local_name().as_ref())?;
        let value = attribute
            .decoded_and_normalized_value(XmlVersion::Implicit1_0, reader.decoder())
            .map_err(|error| invalid(error.to_string()))?
            .into_owned();
        if value.len() > MAX_ATTRIBUTE_BYTES {
            return Err(invalid("attribute value is too long"));
        }
        values.push((name, value));
    }
    Ok(values)
}

fn attr<'a>(attributes: &'a [(String, String)], name: &str) -> Option<&'a str> {
    attributes
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty())
}

fn attr_string(attributes: &[(String, String)], name: &str) -> Option<String> {
    attr(attributes, name).map(str::to_string)
}

fn attr_date(attributes: &[(String, String)], name: &str) -> Option<NaiveDate> {
    attr(attributes, name).and_then(parse_date)
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    let date_part = value.get(..10).unwrap_or(value);
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()
}

fn country_attr(attributes: &[(String, String)]) -> Option<String> {
    attr(attributes, "countryIso2Code")
        .map(str::to_ascii_uppercase)
        .filter(|code| code.len() == 2 && code.chars().all(|ch| ch.is_ascii_uppercase()))
}

fn open_element(
    reader: &Reader<&[u8]>,
    state: &mut ParseState,
    event: &BytesStart<'_>,
    empty: bool,
) -> Result<(), FsfParseError> {
    let name = local_name(event.local_name().as_ref())?;
    if state.root_closed {
        return Err(invalid("content after the root element"));
    }
    if state.stack.len() >= MAX_XML_DEPTH {
        return Err(invalid("XML nesting is too deep"));
    }
    let parent = state.stack.last().map(String::as_str);
    match (parent, name.as_str()) {
        (None, "export") => {
            if state.root_seen {
                return Err(invalid("more than one root element"));
            }
            state.root_seen = true;
            let values = attributes(reader, event)?;
            state.generated_at = attr(&values, "generationDate").and_then(|value| {
                DateTime::parse_from_rfc3339(value)
                    .map(|date| date.with_timezone(&Utc))
                    .ok()
                    .or_else(|| {
                        parse_date(value)
                            .and_then(|date| date.and_hms_opt(0, 0, 0))
                            .map(|date| date.and_utc())
                    })
            });
            state.global_file_id = attr_string(&values, "globalFileId");
        }
        (None, other) => return Err(invalid(format!("unexpected root element {other}"))),
        (Some("export"), "sanctionEntity") => {
            let values = attributes(reader, event)?;
            let eu_reference = attr_string(&values, "euReferenceNumber");
            let logical_id = attr_string(&values, "logicalId")
                .or_else(|| eu_reference.clone())
                .ok_or_else(|| invalid("sanctionEntity without logicalId"))?;
            state.current = Some(ListEntry {
                logical_id,
                eu_reference,
                un_reference: attr_string(&values, "unitedNationId"),
                designation_date: attr_date(&values, "designationDate"),
                ..ListEntry::default()
            });
        }
        (Some("sanctionEntity"), element) => {
            let values = attributes(reader, event)?;
            let entry = state
                .current
                .as_mut()
                .ok_or_else(|| invalid("entity content outside sanctionEntity"))?;
            match element {
                "subjectType" => {
                    entry.subject_type = match attr(&values, "code") {
                        Some("person") => SubjectType::Person,
                        _ => SubjectType::Entity,
                    };
                }
                "nameAlias" => {
                    let name = ListName {
                        whole_name: attr_string(&values, "wholeName").unwrap_or_default(),
                        first_name: attr_string(&values, "firstName"),
                        middle_name: attr_string(&values, "middleName"),
                        last_name: attr_string(&values, "lastName"),
                        language: attr_string(&values, "nameLanguage"),
                        gender: attr_string(&values, "gender"),
                    };
                    if !name.display().is_empty() && !entry.names.contains(&name) {
                        entry.names.push(name);
                    }
                }
                "citizenship" => {
                    if let Some(code) = country_attr(&values)
                        && !entry.citizenships.contains(&code)
                    {
                        entry.citizenships.push(code);
                    }
                }
                "birthdate" => {
                    let year = attr(&values, "year").and_then(|value| value.parse::<i32>().ok());
                    let date = attr_date(&values, "birthdate").or_else(|| {
                        let month = attr(&values, "monthOfYear")?.parse::<u32>().ok()?;
                        let day = attr(&values, "dayOfMonth")?.parse::<u32>().ok()?;
                        NaiveDate::from_ymd_opt(year?, month, day)
                    });
                    let birth = ListBirthDate {
                        date,
                        year,
                        circa: attr(&values, "circa") == Some("true"),
                        place: attr_string(&values, "city")
                            .or_else(|| attr_string(&values, "place")),
                        country: country_attr(&values),
                    };
                    if (birth.date.is_some() || birth.year.is_some())
                        && !entry.birth_dates.contains(&birth)
                    {
                        entry.birth_dates.push(birth);
                    }
                }
                "regulation" => {
                    state.current_regulation = Some(ListRegulation {
                        programme: attr_string(&values, "programme"),
                        number_title: attr_string(&values, "numberTitle"),
                        publication_date: attr_date(&values, "publicationDate"),
                        entry_into_force_date: attr_date(&values, "entryIntoForceDate"),
                        url: attr_string(&values, "publicationUrl"),
                    });
                }
                "remark" => state.text = Some(String::new()),
                _ => {}
            }
        }
        (Some("regulation"), "publicationUrl") if state.current_regulation.is_some() => {
            state.text = Some(String::new());
        }
        _ => {}
    }
    state.stack.push(name.clone());
    if empty {
        close_element(state, &name)?;
    }
    Ok(())
}

fn close_element(state: &mut ParseState, name: &str) -> Result<(), FsfParseError> {
    let opened = state
        .stack
        .pop()
        .ok_or_else(|| invalid("unexpected closing element"))?;
    if opened != name {
        return Err(invalid("mismatched closing element"));
    }
    let parent = state.stack.last().map(String::as_str);
    match (parent, name) {
        (None, "export") => state.root_closed = true,
        (Some("export"), "sanctionEntity") => {
            if let Some(entry) = state.current.take()
                && !entry.names.is_empty()
            {
                state.entries.push(entry);
            }
        }
        (Some("sanctionEntity"), "regulation") => {
            if let (Some(regulation), Some(entry)) =
                (state.current_regulation.take(), state.current.as_mut())
                && !entry.regulations.contains(&regulation)
            {
                entry.regulations.push(regulation);
            }
        }
        (Some("sanctionEntity"), "remark") => {
            if let (Some(text), Some(entry)) = (state.text.take(), state.current.as_mut()) {
                let text = text.trim();
                if !text.is_empty() {
                    let bounded: String = text.chars().take(MAX_REMARK_CHARS).collect();
                    entry.remark = Some(match entry.remark.take() {
                        Some(previous) => format!("{previous}\n{bounded}"),
                        None => bounded,
                    });
                }
            }
        }
        (Some("regulation"), "publicationUrl") => {
            if let (Some(text), Some(regulation)) =
                (state.text.take(), state.current_regulation.as_mut())
            {
                let url = text.trim();
                if url.starts_with("http://") || url.starts_with("https://") {
                    regulation.url = Some(url.to_string());
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// A tiny synthetic file in the FSF 1.1 format for tests. All names are
/// invented; nobody on the real list is reproduced.
#[cfg(test)]
pub(crate) const SYNTHETIC_FSF_XML: &str = include_str!("testdata/synthetic_fsf_1_1.xml");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_persons_entities_names_dates_and_regulations() {
        let parsed = parse_fsf_xml(SYNTHETIC_FSF_XML.as_bytes()).unwrap();
        assert_eq!(parsed.global_file_id.as_deref(), Some("990001"));
        assert_eq!(
            parsed.generated_at.unwrap().to_rfc3339(),
            "2026-09-30T16:00:00+00:00"
        );
        assert_eq!(parsed.entries.len(), 3);
        assert_eq!(parsed.person_count(), 2);

        let first = &parsed.entries[0];
        assert_eq!(first.logical_id, "900101");
        assert_eq!(first.eu_reference.as_deref(), Some("EU.9001.01"));
        assert_eq!(first.subject_type, SubjectType::Person);
        assert_eq!(first.names.len(), 3);
        assert_eq!(first.names[0].display(), "Testomir Ivanovich KORNEEV");
        assert_eq!(first.names[2].display(), "Тестомир Иванович Корнеев");
        assert_eq!(first.citizenships, vec!["RU"]);
        assert_eq!(
            first.birth_dates[0].date,
            NaiveDate::from_ymd_opt(1961, 3, 14)
        );
        assert_eq!(first.regulations.len(), 1);
        let regulation = &first.regulations[0];
        assert_eq!(regulation.programme.as_deref(), Some("UKR"));
        assert_eq!(regulation.number_title.as_deref(), Some("2099/1 (OJ L 1)"));
        assert_eq!(
            regulation.url.as_deref(),
            Some("https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32099R0001&qid=1")
        );
        assert_eq!(
            first.remark.as_deref(),
            Some("Synthetic test person & no real data.")
        );
        assert_eq!(first.programmes(), vec!["UKR"]);

        let second = &parsed.entries[1];
        // Unknown country (`00`) is dropped, a year-only birth date is kept.
        assert!(second.citizenships.is_empty());
        assert_eq!(second.birth_dates[0].year, Some(1978));
        assert_eq!(second.birth_dates[0].date, None);
        assert!(second.birth_dates[0].circa);
        assert_eq!(second.un_reference.as_deref(), Some("QDi.999"));

        let entity = &parsed.entries[2];
        assert_eq!(entity.subject_type, SubjectType::Entity);
        assert_eq!(entity.names[0].display(), "OOO Polartek Shipping");
    }

    #[test]
    fn rejects_other_documents() {
        assert_eq!(parse_fsf_xml(b""), Err(FsfParseError::Size));
        assert!(matches!(
            parse_fsf_xml(b"<rss><channel/></rss>"),
            Err(FsfParseError::Format(_))
        ));
        assert_eq!(
            parse_fsf_xml(b"<export generationDate=\"2026-01-01\"></export>"),
            Err(FsfParseError::Empty)
        );
        assert!(matches!(
            parse_fsf_xml(b"<!DOCTYPE x [<!ENTITY a \"b\">]><export/>"),
            Err(FsfParseError::Format(_))
        ));
        assert!(matches!(
            parse_fsf_xml(b"<export><sanctionEntity logicalId=\"1\">"),
            Err(FsfParseError::Format(_))
        ));
    }

    #[test]
    fn entries_round_trip_through_json() {
        let parsed = parse_fsf_xml(SYNTHETIC_FSF_XML.as_bytes()).unwrap();
        for entry in parsed.entries {
            let json = serde_json::to_value(&entry).unwrap();
            let back: ListEntry = serde_json::from_value(json).unwrap();
            assert_eq!(back, entry);
        }
    }
}
