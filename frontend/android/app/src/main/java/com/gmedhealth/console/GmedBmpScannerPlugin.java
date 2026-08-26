package com.gmedhealth.console;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "GmedBmpScanner",
    permissions = @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
)
public class GmedBmpScannerPlugin extends Plugin {
    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionResult");
            return;
        }
        openScanner(call);
    }

    @PermissionCallback
    private void cameraPermissionResult(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            call.reject("Camera permission is required to scan a BMP", "camera_permission_denied");
            return;
        }
        openScanner(call);
    }

    private void openScanner(PluginCall call) {
        Intent intent = new Intent(getContext(), BmpCarrierScannerActivity.class);
        putOptionalText(intent, BmpCarrierScannerActivity.EXTRA_INSTRUCTION, call.getString("instruction"));
        putOptionalText(intent, BmpCarrierScannerActivity.EXTRA_CANCEL, call.getString("cancel"));
        putOptionalText(intent, BmpCarrierScannerActivity.EXTRA_TORCH_ON, call.getString("torchOn"));
        putOptionalText(intent, BmpCarrierScannerActivity.EXTRA_TORCH_OFF, call.getString("torchOff"));
        putOptionalText(intent, BmpCarrierScannerActivity.EXTRA_INVALID, call.getString("invalid"));
        startActivityForResult(call, intent, "scanResult");
    }

    private void putOptionalText(Intent intent, String key, String value) {
        if (value != null && !value.isBlank()) intent.putExtra(key, value);
    }

    @ActivityCallback
    private void scanResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            call.reject("BMP scanning was cancelled", "scan_cancelled");
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("BMP scanner did not return a result", "scan_failed");
            return;
        }

        String xml = data.getStringExtra(BmpCarrierScannerActivity.RESULT_XML);
        int byteLength = data.getIntExtra(BmpCarrierScannerActivity.RESULT_BYTE_LENGTH, 0);
        String source = data.getStringExtra(BmpCarrierScannerActivity.RESULT_SOURCE);
        if (xml == null || xml.isBlank() || byteLength <= 0) {
            call.reject("BMP scanner returned an invalid carrier", "invalid_bmp_carrier");
            return;
        }

        JSObject response = new JSObject();
        response.put("carrierXml", xml);
        response.put("byteLength", byteLength);
        response.put("source", source == null ? "unknown" : source);
        call.resolve(response);
    }
}
