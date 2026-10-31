package id.tekdroid.tv;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

// Halaman login Vidio menolak dibuka di dalam iframe (X-Frame-Options), jadi tombol "Login" di pemutar berakhir
// dengan ERR_BLOCKED_BY_RESPONSE. Halaman login itu dipindah ke tampilan utama aplikasi; setelah login Vidio
// membuka halaman live-nya (user_return_to), dan tombol Kembali membawa penonton ke halaman TEKDROID TV semula.
public class FrameLoginClient extends BridgeWebViewClient {

    private String returnUrl;

    public FrameLoginClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (!request.isForMainFrame() && isVidioLogin(request.getUrl())) {
            String loginUrl = request.getUrl().toString();
            view.post(() -> {
                if (returnUrl == null) {
                    returnUrl = view.getUrl();
                }
                view.loadUrl(loginUrl);
            });
            return new WebResourceResponse("text/html", "utf-8",
                new ByteArrayInputStream("<!doctype html><title>Login</title>".getBytes(StandardCharsets.UTF_8)));
        }
        return super.shouldInterceptRequest(view, request);
    }

    // Halaman login yang sudah dilewati langsung meneruskan ke halaman live lagi, jadi riwayat Kembali biasa
    // akan berputar di Vidio. Dipanggil dari tombol Kembali; mengembalikan true bila sudah ditangani.
    public boolean returnFromLogin(WebView view) {
        String current = view.getUrl();
        if (returnUrl == null || current == null || !isVidio(Uri.parse(current))) {
            return false;
        }
        String target = returnUrl;
        returnUrl = null;
        view.loadUrl(target);
        return true;
    }

    private static boolean isVidio(Uri uri) {
        String host = uri.getHost();
        return host != null && (host.equals("vidio.com") || host.endsWith(".vidio.com"));
    }

    private static boolean isVidioLogin(Uri uri) {
        String path = uri.getPath();
        return isVidio(uri) && path != null && path.startsWith("/users/");
    }
}
