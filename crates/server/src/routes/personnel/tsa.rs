//! RFC 3161 time stamps for the daily personnel archive anchor.
//!
//! Only the SHA-256 of the anchor goes to the time-stamping authority; no
//! personal data leaves the system. The whole response (`.tsr`) is stored.
//! This module checks the status, that the token covers our hash and nonce,
//! and reads the time; the TSA's signature is verified offline with
//! `openssl ts -verify` against the TSA certificate (see the export's
//! README), so no certificate store has to be maintained here.

use std::time::Duration;

use chrono::{DateTime, NaiveDateTime, Utc};

/// OID 2.16.840.1.101.3.4.2.1 (SHA-256), DER content bytes.
const OID_SHA256: &[u8] = &[0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];

/// A granted time stamp.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeStamp {
    /// The complete `TimeStampResp`, as returned by the TSA.
    pub response: Vec<u8>,
    pub gen_time: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Minimal DER
// ---------------------------------------------------------------------------

fn der_len(len: usize, out: &mut Vec<u8>) {
    if len < 0x80 {
        out.push(len as u8);
    } else {
        let bytes = len.to_be_bytes();
        let skip = bytes.iter().take_while(|byte| **byte == 0).count();
        out.push(0x80 | (bytes.len() - skip) as u8);
        out.extend_from_slice(&bytes[skip..]);
    }
}

fn tlv(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    der_len(content.len(), &mut out);
    out.extend_from_slice(content);
    out
}

fn seq(parts: &[Vec<u8>]) -> Vec<u8> {
    tlv(0x30, &parts.concat())
}

/// A DER INTEGER from big-endian unsigned bytes (minimal, non-negative).
fn integer(bytes: &[u8]) -> Vec<u8> {
    let mut content: Vec<u8> = bytes
        .iter()
        .copied()
        .skip_while(|byte| *byte == 0)
        .collect();
    if content.is_empty() {
        content.push(0);
    }
    if content[0] & 0x80 != 0 {
        content.insert(0, 0);
    }
    tlv(0x02, &content)
}

/// Builds a `TimeStampReq` for a SHA-256 digest with a nonce, asking for
/// the TSA certificate in the token.
pub fn build_request(digest: &[u8; 32], nonce: &[u8; 8]) -> Vec<u8> {
    let algorithm = seq(&[tlv(0x06, OID_SHA256), vec![0x05, 0x00]]);
    let imprint = seq(&[algorithm, tlv(0x04, digest)]);
    seq(&[
        integer(&[1]),
        imprint,
        integer(nonce),
        vec![0x01, 0x01, 0xFF],
    ])
}

/// One DER element: tag, content and the bytes after it.
#[derive(Debug, Clone, Copy)]
struct Element<'a> {
    tag: u8,
    content: &'a [u8],
}

fn read_element(input: &[u8]) -> Result<(Element<'_>, &[u8]), String> {
    let (&tag, rest) = input.split_first().ok_or("truncated DER element")?;
    if tag & 0x1F == 0x1F {
        return Err("multi-byte DER tags are not supported".into());
    }
    let (&first, mut rest) = rest.split_first().ok_or("truncated DER length")?;
    let len = if first < 0x80 {
        usize::from(first)
    } else {
        let count = usize::from(first & 0x7F);
        if count == 0 || count > 4 || rest.len() < count {
            return Err("unsupported DER length".into());
        }
        let mut len = 0usize;
        for byte in &rest[..count] {
            len = (len << 8) | usize::from(*byte);
        }
        rest = &rest[count..];
        len
    };
    if rest.len() < len {
        return Err("DER element exceeds its container".into());
    }
    Ok((
        Element {
            tag,
            content: &rest[..len],
        },
        &rest[len..],
    ))
}

/// The children of a constructed element.
fn children(content: &[u8]) -> Result<Vec<Element<'_>>, String> {
    let mut items = Vec::new();
    let mut rest = content;
    while !rest.is_empty() {
        let (element, next) = read_element(rest)?;
        items.push(element);
        rest = next;
    }
    Ok(items)
}

fn expect<'a>(element: Option<&Element<'a>>, tag: u8, what: &str) -> Result<Element<'a>, String> {
    match element {
        Some(element) if element.tag == tag => Ok(*element),
        _ => Err(format!("unexpected structure: {what}")),
    }
}

fn unsigned(content: &[u8]) -> Vec<u8> {
    content
        .iter()
        .copied()
        .skip_while(|byte| *byte == 0)
        .collect()
}

fn parse_generalized_time(content: &[u8]) -> Result<DateTime<Utc>, String> {
    let text = std::str::from_utf8(content).map_err(|_| "genTime is not text")?;
    let text = text.strip_suffix('Z').ok_or("genTime is not in UTC")?;
    let (whole, fraction) = text.split_once('.').unwrap_or((text, ""));
    let parsed = NaiveDateTime::parse_from_str(whole, "%Y%m%d%H%M%S")
        .map_err(|_| "genTime is malformed".to_string())?;
    let mut time = parsed.and_utc();
    if !fraction.is_empty() {
        let digits: String = fraction.chars().take(9).collect();
        if !digits.chars().all(|ch| ch.is_ascii_digit()) {
            return Err("genTime fraction is malformed".into());
        }
        let nanos = format!("{digits:0<9}")
            .parse::<i64>()
            .map_err(|_| "genTime fraction is malformed")?;
        time += chrono::Duration::nanoseconds(nanos);
    }
    Ok(time)
}

/// Checks a `TimeStampResp` against the request digest and nonce and
/// returns the time it attests.
pub fn parse_response(
    response: &[u8],
    digest: &[u8; 32],
    nonce: &[u8; 8],
) -> Result<DateTime<Utc>, String> {
    let (outer, _) = read_element(response)?;
    let outer = expect(Some(&outer), 0x30, "TimeStampResp")?;
    let parts = children(outer.content)?;
    let status_info = expect(parts.first(), 0x30, "PKIStatusInfo")?;
    let status = expect(children(status_info.content)?.first(), 0x02, "PKIStatus")?;
    let status = unsigned(status.content);
    if !(status.is_empty() || status == [1]) {
        return Err(format!(
            "the time-stamping authority refused the request (status {})",
            status.first().copied().unwrap_or(0)
        ));
    }
    // ContentInfo { contentType, [0] SignedData }
    let token = expect(parts.get(1), 0x30, "timeStampToken")?;
    let token_parts = children(token.content)?;
    let signed_data = expect(token_parts.get(1), 0xA0, "SignedData wrapper")?;
    let signed_data = expect(children(signed_data.content)?.first(), 0x30, "SignedData")?;
    // SignedData { version, digestAlgorithms, encapContentInfo, ... }
    let signed_parts = children(signed_data.content)?;
    let encap = expect(signed_parts.get(2), 0x30, "encapContentInfo")?;
    let encap_parts = children(encap.content)?;
    let e_content = expect(encap_parts.get(1), 0xA0, "eContent wrapper")?;
    let tst_octets = expect(children(e_content.content)?.first(), 0x04, "eContent")?;
    let (tst_info, _) = read_element(tst_octets.content)?;
    let tst_info = expect(Some(&tst_info), 0x30, "TSTInfo")?;
    // TSTInfo { version, policy, messageImprint, serialNumber, genTime, ... nonce }
    let tst = children(tst_info.content)?;
    let imprint = expect(tst.get(2), 0x30, "messageImprint")?;
    let hashed = expect(children(imprint.content)?.get(1), 0x04, "hashedMessage")?;
    if hashed.content != digest {
        return Err("the time stamp does not cover the anchor hash".into());
    }
    let gen_time = expect(tst.get(4), 0x18, "genTime")?;
    let gen_time = parse_generalized_time(gen_time.content)?;
    if let Some(nonce_element) = tst.iter().skip(5).find(|element| element.tag == 0x02)
        && unsigned(nonce_element.content) != unsigned(nonce)
    {
        return Err("the time stamp answers another request (nonce)".into());
    }
    Ok(gen_time)
}

/// Requests a time stamp for `digest` from the TSA at `url`.
pub async fn request_time_stamp(url: &str, digest: &[u8; 32]) -> Result<TimeStamp, String> {
    let mut nonce: [u8; 8] = rand::random();
    nonce[0] = (nonce[0] & 0x7F).max(1);
    let request = build_request(digest, &nonce);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(3))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("http client: {error}"))?;
    let response = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/timestamp-query")
        .header(reqwest::header::ACCEPT, "application/timestamp-reply")
        .body(request)
        .send()
        .await
        .map_err(|error| format!("time-stamping authority unreachable: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "time-stamping authority answered HTTP {}",
            response.status().as_u16()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("time-stamping authority response: {error}"))?;
    if bytes.len() > 64 * 1024 {
        return Err("time-stamping authority response is too large".into());
    }
    let gen_time = parse_response(&bytes, digest, &nonce)?;
    Ok(TimeStamp {
        response: bytes.to_vec(),
        gen_time,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A syntactically complete response as a TSA would send it (the
    /// signature parts are placeholders; they are not checked here).
    fn fake_response(status: u8, digest: &[u8; 32], nonce: &[u8; 8], time: &str) -> Vec<u8> {
        let algorithm = seq(&[tlv(0x06, OID_SHA256), vec![0x05, 0x00]]);
        let tst_info = seq(&[
            integer(&[1]),
            tlv(0x06, &[0x2A, 0x03, 0x04]),
            seq(&[algorithm.clone(), tlv(0x04, digest)]),
            integer(&[0x12, 0x34]),
            tlv(0x18, time.as_bytes()),
            integer(nonce),
        ]);
        let encap = seq(&[
            tlv(
                0x06,
                &[
                    0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x01, 0x04,
                ],
            ),
            tlv(0xA0, &tlv(0x04, &tst_info)),
        ]);
        let signed_data = seq(&[integer(&[3]), tlv(0x31, &algorithm), encap, tlv(0x31, &[])]);
        let token = seq(&[
            tlv(
                0x06,
                &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x02],
            ),
            tlv(0xA0, &signed_data),
        ]);
        seq(&[seq(&[integer(&[status])]), token])
    }

    #[test]
    fn request_is_a_der_timestamp_query() {
        let digest = [0xAB; 32];
        let nonce = [0x01, 2, 3, 4, 5, 6, 7, 8];
        let request = build_request(&digest, &nonce);
        assert_eq!(request[0], 0x30);
        let (outer, rest) = read_element(&request).unwrap();
        assert!(rest.is_empty());
        let parts = children(outer.content).unwrap();
        assert_eq!(parts.len(), 4);
        assert_eq!(parts[0].content, &[1]);
        let imprint = children(parts[1].content).unwrap();
        assert_eq!(children(imprint[0].content).unwrap()[0].content, OID_SHA256);
        assert_eq!(imprint[1].content, &digest);
        assert_eq!(parts[2].content, &nonce);
        assert_eq!(parts[3].content, &[0xFF]);
    }

    #[test]
    fn integers_are_minimal_and_positive() {
        assert_eq!(integer(&[0, 0, 5]), vec![0x02, 0x01, 0x05]);
        assert_eq!(integer(&[0x80]), vec![0x02, 0x02, 0x00, 0x80]);
        assert_eq!(integer(&[]), vec![0x02, 0x01, 0x00]);
    }

    #[test]
    fn long_lengths_round_trip() {
        let content = vec![7u8; 300];
        let encoded = tlv(0x04, &content);
        assert_eq!(&encoded[..4], &[0x04, 0x82, 0x01, 0x2C]);
        let (element, rest) = read_element(&encoded).unwrap();
        assert!(rest.is_empty());
        assert_eq!(element.content.len(), 300);
    }

    #[test]
    fn granted_response_yields_its_time() {
        let digest = [0x11; 32];
        let nonce = [0x05; 8];
        let response = fake_response(0, &digest, &nonce, "20261001120000.25Z");
        let time = parse_response(&response, &digest, &nonce).unwrap();
        assert_eq!(time.to_rfc3339(), "2026-10-01T12:00:00.250+00:00");
    }

    /// Responses recorded from public TSAs on 2026-10-01 for the SHA-256 of
    /// `GMED personnel anchor fixture`; `openssl ts -verify` accepts both.
    #[test]
    fn recorded_responses_of_public_tsas_are_accepted() {
        let digest: [u8; 32] =
            hex::decode("53361e5bab2f169bbba036dbe316274b21fa1e85fcc723586ef2f95d21f635a8")
                .unwrap()
                .try_into()
                .unwrap();
        let nonce = [0xC5, 0x02, 0x4B, 0xC5, 0xA7, 0xB6, 0xB8, 0xC2];
        for (name, response, time) in [
            (
                "sectigo",
                include_bytes!("testdata/sectigo.tsr").as_slice(),
                "2026-10-01T17:17:15+00:00",
            ),
            (
                "digicert",
                include_bytes!("testdata/digicert.tsr").as_slice(),
                "2026-10-01T17:17:16+00:00",
            ),
        ] {
            let parsed = parse_response(response, &digest, &nonce)
                .unwrap_or_else(|problem| panic!("{name}: {problem}"));
            assert_eq!(parsed.to_rfc3339(), time, "{name}");
            assert!(
                parse_response(response, &[0x22; 32], &nonce).is_err(),
                "{name}"
            );
            assert!(
                parse_response(response, &digest, &[0x06; 8]).is_err(),
                "{name}"
            );
        }
    }

    #[test]
    fn wrong_digest_nonce_or_status_is_refused() {
        let digest = [0x11; 32];
        let nonce = [0x05; 8];
        let response = fake_response(0, &digest, &nonce, "20261001120000Z");
        assert!(parse_response(&response, &[0x22; 32], &nonce).is_err());
        assert!(parse_response(&response, &digest, &[0x06; 8]).is_err());
        let rejected = fake_response(2, &digest, &nonce, "20261001120000Z");
        assert!(
            parse_response(&rejected, &digest, &nonce)
                .unwrap_err()
                .contains("refused")
        );
        assert!(parse_response(&[0x30, 0x05, 0x01], &digest, &nonce).is_err());
    }
}
