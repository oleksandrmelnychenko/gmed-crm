package com.gmedhealth.console;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.Size;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;

import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class BmpCarrierScannerActivity extends AppCompatActivity {
    public static final String EXTRA_INSTRUCTION = "instruction";
    public static final String EXTRA_CANCEL = "cancel";
    public static final String EXTRA_TORCH_ON = "torch_on";
    public static final String EXTRA_TORCH_OFF = "torch_off";
    public static final String EXTRA_INVALID = "invalid";
    public static final String RESULT_XML = "carrier_xml";
    public static final String RESULT_BYTE_LENGTH = "byte_length";
    public static final String RESULT_SOURCE = "decode_source";

    private final AtomicBoolean processing = new AtomicBoolean(false);
    private final AtomicBoolean completed = new AtomicBoolean(false);
    private final AtomicBoolean torchEnabled = new AtomicBoolean(false);
    private ExecutorService analysisExecutor;
    private BarcodeScanner barcodeScanner;
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private TextView statusText;
    private Button torchButton;
    private String invalidText;
    private String torchOnText;
    private String torchOffText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );

        invalidText = textExtra(EXTRA_INVALID, "This is not a supported BMP Data Matrix");
        torchOnText = textExtra(EXTRA_TORCH_ON, "Light on");
        torchOffText = textExtra(EXTRA_TORCH_OFF, "Light off");
        analysisExecutor = Executors.newSingleThreadExecutor();
        barcodeScanner = BarcodeScanning.getClient(
            new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_DATA_MATRIX)
                .build()
        );

        PreviewView previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        setContentView(buildScannerLayout(previewView));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                cancelScan();
            }
        });
        startCamera(previewView);
    }

    private View buildScannerLayout(PreviewView previewView) {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.addView(previewView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        LinearLayout topPanel = new LinearLayout(this);
        topPanel.setOrientation(LinearLayout.VERTICAL);
        topPanel.setPadding(dp(20), dp(18), dp(20), dp(16));
        topPanel.setBackgroundColor(Color.argb(210, 15, 23, 42));
        statusText = new TextView(this);
        statusText.setText(textExtra(
            EXTRA_INSTRUCTION,
            "Place the BMP Data Matrix in the centre of the frame"
        ));
        statusText.setTextColor(Color.WHITE);
        statusText.setTextSize(16);
        statusText.setGravity(Gravity.CENTER);
        topPanel.addView(statusText, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        );
        root.addView(topPanel, topParams);

        View target = new View(this);
        GradientDrawable targetBorder = new GradientDrawable();
        targetBorder.setColor(Color.TRANSPARENT);
        targetBorder.setCornerRadius(dp(18));
        targetBorder.setStroke(dp(3), Color.rgb(255, 111, 15));
        target.setBackground(targetBorder);
        target.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        FrameLayout.LayoutParams targetParams = new FrameLayout.LayoutParams(
            dp(260),
            dp(260),
            Gravity.CENTER
        );
        root.addView(target, targetParams);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        actions.setPadding(dp(16), dp(12), dp(16), dp(24));
        actions.setBackgroundColor(Color.argb(195, 15, 23, 42));

        Button cancel = scannerButton(textExtra(EXTRA_CANCEL, "Cancel"));
        cancel.setOnClickListener(view -> cancelScan());
        actions.addView(cancel, weightedButtonParams());

        torchButton = scannerButton(torchOnText);
        torchButton.setEnabled(false);
        torchButton.setOnClickListener(view -> toggleTorch());
        LinearLayout.LayoutParams torchParams = weightedButtonParams();
        torchParams.setMarginStart(dp(10));
        actions.addView(torchButton, torchParams);

        FrameLayout.LayoutParams actionParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        root.addView(actions, actionParams);
        return root;
    }

    private Button scannerButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(14);
        button.setTextColor(Color.WHITE);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(225, 30, 41, 59));
        background.setCornerRadius(dp(12));
        background.setStroke(dp(1), Color.argb(120, 255, 255, 255));
        button.setBackground(background);
        return button;
    }

    private LinearLayout.LayoutParams weightedButtonParams() {
        return new LinearLayout.LayoutParams(0, dp(48), 1f);
    }

    private void startCamera(PreviewView previewView) {
        var providerFuture = ProcessCameraProvider.getInstance(this);
        providerFuture.addListener(() -> {
            try {
                cameraProvider = providerFuture.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                    .setResolutionSelector(new ResolutionSelector.Builder()
                        .setResolutionStrategy(new ResolutionStrategy(
                            new Size(1280, 720),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                        ))
                        .build())
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build();
                analysis.setAnalyzer(analysisExecutor, this::analyzeImage);

                cameraProvider.unbindAll();
                camera = cameraProvider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis
                );
                boolean hasFlash = camera.getCameraInfo().hasFlashUnit();
                torchButton.setEnabled(hasFlash);
                if (!hasFlash) torchButton.setVisibility(View.GONE);
            } catch (Exception error) {
                showStatus("Camera unavailable");
            }
        }, ContextCompat.getMainExecutor(this));
    }

    @SuppressLint("UnsafeOptInUsageError")
    private void analyzeImage(@NonNull ImageProxy imageProxy) {
        if (completed.get() || !processing.compareAndSet(false, true)) {
            imageProxy.close();
            return;
        }

        android.media.Image mediaImage = imageProxy.getImage();
        if (mediaImage == null) {
            processing.set(false);
            imageProxy.close();
            return;
        }

        InputImage input = InputImage.fromMediaImage(
            mediaImage,
            imageProxy.getImageInfo().getRotationDegrees()
        );
        barcodeScanner.process(input)
            .addOnSuccessListener(this::inspectBarcodes)
            .addOnCompleteListener(task -> {
                processing.set(false);
                imageProxy.close();
            });
    }

    private void inspectBarcodes(List<Barcode> barcodes) {
        if (completed.get()) return;
        boolean sawDataMatrix = false;
        for (Barcode barcode : barcodes) {
            if (barcode.getFormat() != Barcode.FORMAT_DATA_MATRIX) continue;
            sawDataMatrix = true;
            BmpCarrierDecoder.DecodedCarrier carrier = BmpCarrierDecoder.decode(
                barcode.getRawBytes(),
                barcode.getRawValue()
            );
            if (carrier != null) {
                finishWithCarrier(carrier);
                return;
            }
        }
        if (sawDataMatrix) showStatus(invalidText);
    }

    private void finishWithCarrier(BmpCarrierDecoder.DecodedCarrier carrier) {
        if (!completed.compareAndSet(false, true)) return;
        Intent result = new Intent();
        result.putExtra(RESULT_XML, carrier.xml());
        result.putExtra(RESULT_BYTE_LENGTH, carrier.byteLength());
        result.putExtra(RESULT_SOURCE, carrier.source());
        setResult(Activity.RESULT_OK, result);
        finish();
    }

    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        boolean next = !torchEnabled.get();
        camera.getCameraControl().enableTorch(next).addListener(
            () -> {
                torchEnabled.set(next);
                torchButton.setText(next ? torchOffText : torchOnText);
            },
            ContextCompat.getMainExecutor(this)
        );
    }

    private void showStatus(String text) {
        runOnUiThread(() -> statusText.setText(text));
    }

    private String textExtra(String key, String fallback) {
        String value = getIntent().getStringExtra(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void cancelScan() {
        if (!completed.compareAndSet(false, true)) return;
        setResult(Activity.RESULT_CANCELED);
        finish();
    }

    @Override
    protected void onDestroy() {
        if (cameraProvider != null) cameraProvider.unbindAll();
        if (barcodeScanner != null) barcodeScanner.close();
        if (analysisExecutor != null) analysisExecutor.shutdownNow();
        super.onDestroy();
    }
}
