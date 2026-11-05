package com.vexyeclipse.argent;

import android.annotation.TargetApi;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.UiModeManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Argent on Android TV, Google TV and Android phones: the built web app (dist/, bundled as the
 * APK's assets) in a full-screen WebView, as the Electron shell does on Windows. The page talks
 * to the Jellyfin server directly.
 *
 * The app is served as http://localhost, answered from the APK and never the network. Home
 * servers are usually plain http, and an https page may fetch() from them but WebView still
 * blocks their images and video as mixed content. An http page has no mixed content, and
 * localhost still counts as a secure context, so crypto.randomUUID and the like keep working.
 */
public class MainActivity extends Activity {
    private static final String HOST = "localhost";
    private static final String START_URL = "http://" + HOST + "/";
    private static final int BACKGROUND = 0xFF0A0A0B;

    // Back is offered to the page as Escape, which closes whatever is open (a menu, a dialog,
    // the player) and on TV goes back a page. Handlers that act on it mark it handled.
    private static final String BACK_JS =
            "(function(){var e=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true});"
                    + "(document.activeElement||document.body).dispatchEvent(e);return e.defaultPrevented})()";

    private static final Map<String, String> TYPES = new HashMap<>();

    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("mjs", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("json", "application/json");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("png", "image/png");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("webp", "image/webp");
        TYPES.put("ico", "image/x-icon");
        TYPES.put("woff2", "font/woff2");
        TYPES.put("ttf", "font/ttf");
        TYPES.put("wasm", "application/wasm");
        TYPES.put("txt", "text/plain");
    }

    private static WeakReference<MainActivity> instance = new WeakReference<>(null);

    private FrameLayout root;
    private WebView web;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        instance = new WeakReference<>(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) fitSystemBars();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        createWebView();
        web.loadUrl(START_URL);
    }

    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        root.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // trailers, autoplay of the next episode
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100); // the TV layout is already sized for 10 feet
        // The web app picks its TV interface from this token (src/platform/platform.tsx).
        s.setUserAgentString(s.getUserAgentString() + (isTv() ? " ArgentTV" : " ArgentAndroid"));

        web.addJavascriptInterface(new Bridge(), "argentAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(this::download);
        web.requestFocus();
    }

    private boolean isTv() {
        UiModeManager ui = getSystemService(UiModeManager.class);
        return (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
                || getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }

    /** Phones draw edge to edge, so keep the page clear of the status bar, notch and keyboard. TVs have none. */
    @TargetApi(30)
    private void fitSystemBars() {
        getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    private void back() {
        web.evaluateJavascript(BACK_JS, handled -> {
            if ("true".equals(handled)) return;
            if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
            else if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back(); // Android 12 and earlier; newer versions use the callback registered in onCreate.
    }

    private void download(String url, String userAgent, String contentDisposition, String mimeType, long length) {
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                .setTitle(name)
                .setMimeType(mimeType)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .addRequestHeader("User-Agent", userAgent);
        if (Build.VERSION.SDK_INT >= 29) request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        else request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
        getSystemService(DownloadManager.class).enqueue(request);
        Toast.makeText(this, name, Toast.LENGTH_SHORT).show();
    }

    /** A file from dist/. Unknown paths are client-side routes: hand back index.html. */
    private WebResourceResponse serve(Uri uri) {
        String path = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/+", "");
        InputStream in = path.isEmpty() || path.contains("..") ? null : open(path);
        if (in == null) {
            path = "index.html";
            in = open(path);
        }
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String type = TYPES.containsKey(ext) ? TYPES.get(ext) : "application/octet-stream";
        boolean text = type.startsWith("text/") || type.equals("application/json") || type.equals("image/svg+xml");
        WebResourceResponse response = new WebResourceResponse(type, text ? "utf-8" : null, in);
        Map<String, String> headers = new HashMap<>();
        // Vite names everything under assets/ by content hash.
        headers.put("Cache-Control", path.startsWith("assets/") ? "max-age=31536000, immutable" : "no-cache");
        response.setResponseHeaders(headers);
        return response;
    }

    private InputStream open(String path) {
        try {
            return getAssets().open(path);
        } catch (IOException e) {
            return null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (instance.get() == this) instance = new WeakReference<>(null);
        web.destroy();
        super.onDestroy();
    }

    /**
     * Hands an event to the page (an "argent-native" DOM event): the native player's state
     * and result, and update progress. Safe from any thread.
     */
    static void sendEvent(JSONObject detail) {
        MainActivity a = instance.get();
        if (a == null) return;
        String js = "window.dispatchEvent(new CustomEvent('argent-native',{detail:" + detail + "}))";
        a.runOnUiThread(() -> {
            if (a.web != null) a.web.evaluateJavascript(js, null);
        });
    }

    /** window.argentAndroid in the page (src/platform/android.ts). */
    private final class Bridge {
        @JavascriptInterface
        public void exit() {
            runOnUiThread(MainActivity.this::finish);
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException e) {
                return "";
            }
        }

        @JavascriptInterface
        public String capabilities() {
            return Capabilities.probe(MainActivity.this, isTv());
        }

        /** Opens the native player with an ExternalRequest (JSON). */
        @JavascriptInterface
        public void play(String request) {
            runOnUiThread(() -> {
                Intent intent = new Intent(MainActivity.this, PlayerActivity.class).putExtra(PlayerActivity.EXTRA_REQUEST, request);
                startActivity(intent);
            });
        }

        /** A PlayerCommand (JSON) for the open native player: remote control, Stop. */
        @JavascriptInterface
        public void control(String command) {
            runOnUiThread(() -> {
                PlayerActivity player = PlayerActivity.current();
                if (player == null) return;
                try {
                    player.control(new JSONObject(command));
                } catch (JSONException ignored) {
                    // not a command
                }
            });
        }

        @JavascriptInterface
        public void installUpdate(String url, String version) {
            runOnUiThread(() -> Updater.install(MainActivity.this, url, version));
        }
    }

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            // Only the bare origin: a server on the device itself (localhost:8096) goes to the network.
            Uri url = request.getUrl();
            return HOST.equals(url.getHost()) && url.getPort() == -1 ? serve(url) : null;
        }

        /** Low-memory TV boxes can lose the page's renderer; start it again rather than crash. */
        @Override
        @TargetApi(26)
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            root.removeView(web);
            web.destroy();
            createWebView();
            web.loadUrl(START_URL);
            return true;
        }
    }

    /** The player's full screen. */
    private final class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            if (Build.VERSION.SDK_INT >= 30) getWindow().getInsetsController().hide(WindowInsets.Type.systemBars());
        }

        @Override
        public void onHideCustomView() {
            if (fullscreenView == null) return;
            root.removeView(fullscreenView);
            fullscreenView = null;
            fullscreenCallback = null;
            if (Build.VERSION.SDK_INT >= 30) getWindow().getInsetsController().show(WindowInsets.Type.systemBars());
        }
    }
}
