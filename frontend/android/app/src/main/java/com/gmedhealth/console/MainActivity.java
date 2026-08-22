package com.gmedhealth.console;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GmedSecureStoragePlugin.class);
        super.onCreate(savedInstanceState);

        // Staff screens can contain patient and financial data. Keep them out of
        // screenshots, screen recordings, casting and Android's recent-app preview.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
    }
}
