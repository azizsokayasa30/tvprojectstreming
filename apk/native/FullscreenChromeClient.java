package id.tekdroid.tv;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

// Bawaan Capacitor langsung membatalkan permintaan layar penuh dari halaman web.
// Di sini tampilan layar penuh benar-benar ditampilkan: bilah sistem disembunyikan dan layar diputar ke landscape.
public class FullscreenChromeClient extends BridgeWebChromeClient {

    private final AppCompatActivity activity;
    private View fullscreenView;
    private CustomViewCallback fullscreenCallback;
    private int previousCutoutMode;

    public FullscreenChromeClient(Bridge bridge) {
        super(bridge);
        this.activity = bridge.getActivity();
    }

    public boolean isFullscreen() {
        return fullscreenView != null;
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
        if (fullscreenView != null) {
            callback.onCustomViewHidden();
            return;
        }
        fullscreenView = view;
        fullscreenCallback = callback;

        Window window = activity.getWindow();
        ViewGroup decor = (ViewGroup) window.getDecorView();
        view.setBackgroundColor(Color.BLACK);
        decor.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            previousCutoutMode = attrs.layoutInDisplayCutoutMode;
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(window, decor);
        insets.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        insets.hide(WindowInsetsCompat.Type.systemBars());
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    }

    @Override
    public void onHideCustomView() {
        if (fullscreenView == null) {
            return;
        }
        Window window = activity.getWindow();
        ViewGroup decor = (ViewGroup) window.getDecorView();
        decor.removeView(fullscreenView);
        fullscreenView = null;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode = previousCutoutMode;
            window.setAttributes(attrs);
        }
        WindowCompat.getInsetsController(window, decor).show(WindowInsetsCompat.Type.systemBars());
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);

        CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        if (callback != null) {
            callback.onCustomViewHidden();
        }
    }
}
