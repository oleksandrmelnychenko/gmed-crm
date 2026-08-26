package com.gmedhealth.console;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertNotNull;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

public class BmpCarrierDecoderTest {
    @Test
    public void decodesOfficialLatin1CarrierBytesWithoutUtf8Corruption() {
        String xml = "<MP v=\"028\" l=\"de-DE\"><P g=\"Jörg\"/></MP>";
        BmpCarrierDecoder.DecodedCarrier result = BmpCarrierDecoder.decode(
            xml.getBytes(StandardCharsets.ISO_8859_1),
            null
        );

        assertNotNull(result);
        assertEquals(xml, result.xml());
        assertEquals("raw_bytes", result.source());
    }

    @Test
    public void ignoresTrailingDataMatrixNullPadding() {
        byte[] raw = "<MP v=\"028\"></MP>\0\0".getBytes(StandardCharsets.ISO_8859_1);
        BmpCarrierDecoder.DecodedCarrier result = BmpCarrierDecoder.decode(raw, null);

        assertNotNull(result);
        assertEquals("<MP v=\"028\"></MP>", result.xml());
    }

    @Test
    public void rejectsNonBmpPayloadsAndOversizeCarriers() {
        assertNull(BmpCarrierDecoder.decode("https://example.test".getBytes(StandardCharsets.UTF_8), null));
        assertNull(BmpCarrierDecoder.decode(new byte[BmpCarrierDecoder.MAX_CARRIER_BYTES + 1], null));
    }
}
