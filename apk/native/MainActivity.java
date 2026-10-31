package id.tekdroid.tv;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) {
            return;
        }
        FullscreenChromeClient chrome = new FullscreenChromeClient(bridge);
        bridge.getWebView().setWebChromeClient(chrome);

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
}
