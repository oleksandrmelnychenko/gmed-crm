package com.gmedhealth.console;

import java.nio.charset.StandardCharsets;

final class BmpCarrierDecoder {
    static final int MAX_CARRIER_BYTES = 128 * 1024;

    private BmpCarrierDecoder() {}

    static DecodedCarrier decode(byte[] rawBytes, String rawValue) {
        final String source;
        final String decoded;
        final int byteLength;

        if (rawBytes != null && rawBytes.length > 0) {
            int length = rawBytes.length;
            while (length > 0 && rawBytes[length - 1] == 0) length--;
            if (length == 0 || length > MAX_CARRIER_BYTES) return null;
            decoded = new String(rawBytes, 0, length, StandardCharsets.ISO_8859_1);
            byteLength = length;
            source = "raw_bytes";
        } else if (rawValue != null && !rawValue.isBlank()) {
            byte[] encoded = rawValue.getBytes(StandardCharsets.ISO_8859_1);
            if (encoded.length > MAX_CARRIER_BYTES) return null;
            decoded = rawValue;
            byteLength = encoded.length;
            source = "raw_value";
        } else {
            return null;
        }

        String xml = stripLeadingBom(decoded).stripLeading();
        if (!xml.startsWith("<MP") || !xml.contains("</MP>")) return null;
        return new DecodedCarrier(xml, byteLength, source);
    }

    private static String stripLeadingBom(String value) {
        return value.startsWith("\uFEFF") ? value.substring(1) : value;
    }

    record DecodedCarrier(String xml, int byteLength, String source) {}
}
