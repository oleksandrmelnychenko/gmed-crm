package com.gmedhealth.console;

import static java.nio.charset.StandardCharsets.UTF_8;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "GmedSecureStorage")
public class GmedSecureStoragePlugin extends Plugin {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "com.gmedhealth.console.auth.aes.v1";
    private static final String PREFERENCES_NAME = "com.gmedhealth.console.secure_auth";
    private static final String SESSION_KEY = "session_v1";
    private static final String ASSOCIATED_DATA = "com.gmedhealth.console.auth.session.v1";
    private static final String CIPHER_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH_BITS = 128;

    @PluginMethod
    public void getSession(PluginCall call) {
        try {
            String payload = preferences().getString(SESSION_KEY, null);
            JSObject result = new JSObject();
            if (payload == null || payload.isEmpty()) {
                call.resolve(result);
                return;
            }

            JSONObject session = new JSONObject(decrypt(payload));
            String accessToken = session.optString("accessToken", "");
            String refreshToken = session.optString("refreshToken", "");
            if (!accessToken.isEmpty() && !refreshToken.isEmpty()) {
                result.put("accessToken", accessToken);
                result.put("refreshToken", refreshToken);
            } else {
                preferences().edit().remove(SESSION_KEY).commit();
            }
            call.resolve(result);
        } catch (Exception error) {
            // A restored/corrupt ciphertext must never fall back to plaintext storage.
            preferences().edit().remove(SESSION_KEY).commit();
            call.reject("Unable to read the protected session", error);
        }
    }

    @PluginMethod
    public void setSession(PluginCall call) {
        String accessToken = call.getString("accessToken");
        String refreshToken = call.getString("refreshToken");
        if (accessToken == null || accessToken.isEmpty() || refreshToken == null || refreshToken.isEmpty()) {
            call.reject("Both session tokens are required");
            return;
        }

        try {
            JSONObject session = new JSONObject();
            session.put("accessToken", accessToken);
            session.put("refreshToken", refreshToken);
            boolean committed = preferences().edit()
                .putString(SESSION_KEY, encrypt(session.toString()))
                .commit();
            if (!committed) {
                call.reject("Unable to persist the protected session");
                return;
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to persist the protected session", error);
        }
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        if (preferences().edit().remove(SESSION_KEY).commit()) {
            call.resolve();
        } else {
            call.reject("Unable to clear the protected session");
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);
        SecretKey existing = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;

        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER
        );
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        cipher.updateAAD(ASSOCIATED_DATA.getBytes(UTF_8));
        String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
        String ciphertext = Base64.encodeToString(
            cipher.doFinal(plaintext.getBytes(UTF_8)),
            Base64.NO_WRAP
        );
        return iv + "." + ciphertext;
    }

    private String decrypt(String payload) throws Exception {
        String[] parts = payload.split("\\.", 2);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid protected session");

        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
        cipher.init(
            Cipher.DECRYPT_MODE,
            getOrCreateKey(),
            new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        );
        cipher.updateAAD(ASSOCIATED_DATA.getBytes(UTF_8));
        return new String(cipher.doFinal(ciphertext), UTF_8);
    }
}
