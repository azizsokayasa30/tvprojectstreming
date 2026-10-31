package id.tekdroid.tv;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.webkit.JavascriptInterface;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String DEFAULT_BAR_COLOR = "#06121f";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBars(DEFAULT_BAR_COLOR, false);
        if (bridge == null) {
            return;
        }
        FullscreenChromeClient chrome = new FullscreenChromeClient(bridge);
        bridge.getWebView().setWebChromeClient(chrome);

        // Dipanggil web (applyTheme di assets/app.js) agar bilah status & navigasi ikut tema gelap/terang.
        bridge.getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setTheme(String color, boolean light) {
                runOnUiThread(() -> applySystemBars(color, light));
            }
        }, "TekdroidNative");

        // Didaftarkan setelah plugin App, jadi tombol Kembali keluar dari layar penuh dulu sebelum menutup halaman.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (chrome.isFullscreen()) {
                    chrome.onHideCustomView();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void applySystemBars(String color, boolean light) {
        int value;
        try {
            value = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            return;
        }
        Window window = getWindow();
        // Android 15+ selalu edge-to-edge: area bilah sistem memperlihatkan latar jendela, bukan warna bilah.
        window.getDecorView().setBackgroundColor(value);
        window.setStatusBarColor(value);
        window.setNavigationBarColor(value);
        WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(window, window.getDecorView());
        insets.setAppearanceLightStatusBars(light);
        insets.setAppearanceLightNavigationBars(light);
    }
}
