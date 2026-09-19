//! RFC 6238 time-based one-time passwords with the parameters every
//! authenticator app assumes: HMAC-SHA1, 30-second steps, six digits.

use hmac::{Hmac, Mac};
use rand::RngCore;
use sha1::Sha1;

pub const STEP_SECONDS: u64 = 30;
pub const DIGITS: u32 = 6;
pub const SECRET_LEN: usize = 20;
/// One step of clock drift either way is accepted, as the RFC suggests.
const WINDOW: i64 = 1;

const BASE32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn generate_secret() -> [u8; SECRET_LEN] {
    let mut secret = [0u8; SECRET_LEN];
    rand::rng().fill_bytes(&mut secret);
    secret
}

/// Unpadded base32, the form authenticator apps take as a manual key.
pub fn base32_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let mut buffer: u64 = 0;
    let mut bits = 0u32;
    for &byte in bytes {
        buffer = (buffer << 8) | u64::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32_ALPHABET[((buffer >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(BASE32_ALPHABET[((buffer << (5 - bits)) & 0x1f) as usize] as char);
    }
    out
}

pub fn code_at_step(secret: &[u8], step: u64) -> u32 {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(&step.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = usize::from(digest[digest.len() - 1] & 0x0f);
    let binary = (u32::from(digest[offset] & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    binary % 10u32.pow(DIGITS)
}

pub fn step_for(unix_seconds: u64) -> u64 {
    unix_seconds / STEP_SECONDS
}

/// Returns the step that matched so the caller can store it and refuse a
/// replay. `last_used_step` is the highest step already accepted.
pub fn verify(
    secret: &[u8],
    code: &str,
    unix_seconds: u64,
    last_used_step: Option<i64>,
) -> Option<i64> {
    let code = code.trim().replace(' ', "");
    if code.len() != DIGITS as usize || !code.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let submitted: u32 = code.parse().ok()?;
    let current = i64::try_from(step_for(unix_seconds)).ok()?;
    let mut matched = None;
    // Constant work over the whole window, so timing does not reveal the step.
    for delta in -WINDOW..=WINDOW {
        let step = current + delta;
        if step < 0 {
            continue;
        }
        let expected = code_at_step(secret, step as u64);
        if constant_time_eq(expected, submitted) && last_used_step.is_none_or(|used| step > used) {
            matched = Some(step);
        }
    }
    matched
}

fn constant_time_eq(a: u32, b: u32) -> bool {
    let mut diff = 0u8;
    for (x, y) in a.to_be_bytes().iter().zip(b.to_be_bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn otpauth_uri(issuer: &str, account: &str, secret: &[u8]) -> String {
    let encode = |value: &str| {
        value
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b'@') {
                    (b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect::<String>()
    };
    format!(
        "otpauth://totp/{}:{}?secret={}&issuer={}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}",
        encode(issuer),
        encode(account),
        base32_encode(secret),
        encode(issuer)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const RFC_SECRET: &[u8] = b"12345678901234567890";

    #[test]
    fn matches_rfc_6238_sha1_vectors() {
        // RFC 6238 Appendix B lists 8-digit codes; the last six digits are ours.
        assert_eq!(code_at_step(RFC_SECRET, step_for(59)), 287_082);
        assert_eq!(code_at_step(RFC_SECRET, step_for(1_111_111_109)), 81_804);
        assert_eq!(code_at_step(RFC_SECRET, step_for(1_234_567_890)), 5_924);
        assert_eq!(code_at_step(RFC_SECRET, step_for(20_000_000_000)), 353_130);
    }

    #[test]
    fn accepts_neighbouring_steps_and_refuses_replay() {
        let now = 1_234_567_890;
        let step = step_for(now) as i64;
        let code = format!("{:06}", code_at_step(RFC_SECRET, step as u64));
        assert_eq!(verify(RFC_SECRET, &code, now, None), Some(step));
        assert_eq!(verify(RFC_SECRET, &code, now + 30, None), Some(step));
        assert_eq!(verify(RFC_SECRET, &code, now + 90, None), None);
        assert_eq!(verify(RFC_SECRET, &code, now, Some(step)), None);
        assert_eq!(verify(RFC_SECRET, "12 34 56", now, None), None);
        assert_eq!(verify(RFC_SECRET, "abcdef", now, None), None);
    }

    #[test]
    fn base32_matches_rfc_4648_examples() {
        assert_eq!(base32_encode(b""), "");
        assert_eq!(base32_encode(b"f"), "MY");
        assert_eq!(base32_encode(b"fo"), "MZXQ");
        assert_eq!(base32_encode(b"foo"), "MZXW6");
        assert_eq!(base32_encode(b"foobar"), "MZXW6YTBOI");
    }

    #[test]
    fn otpauth_uri_escapes_issuer_and_account() {
        let uri = otpauth_uri("GMED Console", "it@gmed-health.com", b"foobar");
        assert_eq!(
            uri,
            "otpauth://totp/GMED%20Console:it@gmed-health.com?secret=MZXW6YTBOI&issuer=GMED%20Console&algorithm=SHA1&digits=6&period=30"
        );
    }
}
