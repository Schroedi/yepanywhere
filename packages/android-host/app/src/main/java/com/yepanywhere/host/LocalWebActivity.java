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
    @android.annotation.SuppressLint("SetJavaScriptEnabled") // Fixed authenticated loopback app; no privileged JS bridge.
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        try {
            String token = new String(Files.readAllBytes(new File(HostService.state(this), ".local-access-token").toPath()), java.nio.charset.StandardCharsets.UTF_8).trim();
            if (!token.matches("[A-Za-z0-9_-]{43}")) throw new Exception("Host credential not ready");
            web = new WebView(this);
            web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if ("http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 13400) return false;
                    if ("https".equals(uri.getScheme())) startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
            });
            android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
            frame.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
            frame.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
            });
            setContentView(frame); web.loadUrl("http://127.0.0.1:13400/?desktop_token=" + token);
        } catch (Exception error) {
            android.widget.TextView status = new android.widget.TextView(this);
            status.setText(R.string.start_first); setContentView(status);
        }
    }
    @Override protected void onDestroy() { if (web != null) web.destroy(); super.onDestroy(); }
}
