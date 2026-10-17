package com.yepanywhere.host;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.content.Intent;
import android.net.Uri;
import java.io.File;
import java.nio.file.Files;

/** Same YA frontend, authenticated with the existing desktop-token mechanism. */
public final class LocalWebActivity extends Activity {
    private WebView web;
    private WebView popup;
    private void openBrowser(Uri uri) {
        if (!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (android.content.ActivityNotFoundException error) {
            android.widget.Toast.makeText(this, R.string.browser_unavailable, android.widget.Toast.LENGTH_LONG).show();
        }
    }
    private void closePopup(WebView child) {
        if (popup == child) { popup = null; child.destroy(); }
    }
    @android.annotation.SuppressLint("SetJavaScriptEnabled") // Fixed authenticated loopback app; no privileged JS bridge.
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        try {
            String token = new String(Files.readAllBytes(new File(HostService.state(this), ".local-access-token").toPath()), java.nio.charset.StandardCharsets.UTF_8).trim();
            if (!token.matches("[A-Za-z0-9_-]{43}")) throw new Exception("Host credential not ready");
            web = new WebView(this);
            web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setSupportMultipleWindows(true);
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (!request.isForMainFrame()) return false;
                    Uri uri = request.getUrl();
                    if ("http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 13400) return false;
                    openBrowser(uri);
                    return true;
                }
            });
            // Ordinary links can use target=_blank. Android needs an explicit
            // window transport or the tap can silently do nothing.
            web.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message message) {
                    if (!gesture || view != web) return false;
                    if (popup != null) popup.destroy();
                    popup = new WebView(LocalWebActivity.this);
                    popup.setWebViewClient(new WebViewClient() {
                        @Override public WebResourceResponse shouldInterceptRequest(WebView child, WebResourceRequest request) {
                            return new WebResourceResponse("text/plain", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
                        }
                        @Override public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                            Uri uri = request.getUrl();
                            if (request.isForMainFrame()) openBrowser(uri);
                            child.post(() -> closePopup(child));
                            return true;
                        }
                    });
                    ((WebView.WebViewTransport) message.obj).setWebView(popup);
                    message.sendToTarget();
                    WebView child = popup;
                    web.postDelayed(() -> closePopup(child), 5000);
                    return true;
                }
            });
            android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
            frame.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
            frame.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
            });
            String provider = getIntent().getStringExtra("provider");
            String path = ("codex".equals(provider) || "claude".equals(provider)) ? "/provider-sign-in/" + provider : "/";
            setContentView(frame); web.loadUrl("http://127.0.0.1:13400" + path + "?desktop_token=" + token);
        } catch (Exception error) {
            android.widget.TextView status = new android.widget.TextView(this);
            status.setText(R.string.start_first); setContentView(status);
        }
    }
    @Override protected void onDestroy() { if (popup != null) popup.destroy(); if (web != null) web.destroy(); super.onDestroy(); }
}
