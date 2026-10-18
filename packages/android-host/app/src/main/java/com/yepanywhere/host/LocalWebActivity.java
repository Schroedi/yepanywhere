package com.yepanywhere.host;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.*;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.*;
import java.io.File;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Same YA frontend, authenticated with the existing desktop-token mechanism. */
public final class LocalWebActivity extends Activity {
    private WebView web;
    private WebView popup;
    private LinearLayout recovery;
    private TextView message;
    private ProgressBar progress;
    private Button retry;
    private final Handler handler = new Handler(Looper.getMainLooper());
    // One active probe and at most one newer request; cancelled generations
    // cannot accumulate an unbounded queue during rapid lifecycle changes.
    private final ThreadPoolExecutor probes = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(1), new ThreadPoolExecutor.DiscardOldestPolicy());
    private Future<?> pending;
    private int generation;
    private int navigation;
    private boolean resumed, pageLoaded;
    private String lastToken;
    private Uri lastRoute;
    private Uri mainNavigation;
    private void trace(String event) {
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
            android.util.Log.d("YAHostWeb", event);
    }

    private boolean current(int attempt) { return resumed && generation == attempt; }
    private void showConnecting() {
        recovery.setVisibility(View.VISIBLE); web.setVisibility(View.GONE);
        if (pageLoaded) unload();
        message.setText(R.string.host_connecting); progress.setVisibility(View.VISIBLE);
        retry.setVisibility(View.GONE);
    }
    private void failed(int label) {
        generation++;
        if (pending != null) pending.cancel(true);
        recovery.setVisibility(View.VISIBLE); web.setVisibility(View.GONE);
        unload();
        message.setText(label); progress.setVisibility(View.GONE); retry.setVisibility(View.VISIBLE);
    }
    private boolean local(Uri uri) {
        return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 13400;
    }
    private void unload() {
        if (pageLoaded && web.getUrl() != null && local(Uri.parse(web.getUrl()))) lastRoute = Uri.parse(web.getUrl());
        pageLoaded = false;
        mainNavigation = null;
        // A hidden failed page must not keep its JS subscriptions/retries alive.
        web.stopLoading(); web.loadUrl("about:blank");
    }
    private void navigating(Uri uri) {
        if (pageLoaded && web.getUrl() != null && local(Uri.parse(web.getUrl()))) lastRoute = Uri.parse(web.getUrl());
        mainNavigation = uri.buildUpon().fragment(null).build(); pageLoaded = false; navigation++; generation++;
        if (pending != null) pending.cancel(true);
    }
    private boolean mainRequest(WebResourceRequest request) {
        // WebView reports the service worker's failed fetch of a navigation as
        // main=false. Match only our outstanding top-level URL, never arbitrary
        // failed images/API calls. Clear the marker on completion or unload.
        return request.isForMainFrame() || (mainNavigation != null &&
            mainNavigation.equals(request.getUrl().buildUpon().fragment(null).build()));
    }
    private void verifyNavigation(String url, boolean complete) {
        if (!resumed) return;
        int attempt = generation, load = navigation;
        if (pending != null) pending.cancel(true);
        pending = probes.submit(() -> {
            String token = HostConnection.ready(HostService.state(this));
            handler.post(() -> {
                if (!current(attempt) || navigation != load || web.getVisibility() != View.VISIBLE) return;
                if (token == null || !local(Uri.parse(url))) { failed(R.string.host_open_failed); return; }
                if (complete) {
                    pageLoaded = true; mainNavigation = null;
                    Uri route = Uri.parse(web.getUrl());
                    lastRoute = local(route) ? route : Uri.parse(url);
                }
            });
        });
    }
    private void ready(String token, boolean reload) {
        recovery.setVisibility(View.GONE); web.setVisibility(View.VISIBLE);
        if (!pageLoaded || reload || !token.equals(lastToken)) {
            String provider = getIntent().getStringExtra("provider");
            String path = ("codex".equals(provider) || "claude".equals(provider)) ? "/provider-sign-in/" + provider : "/";
            Uri uri = Uri.parse(HostConnection.ORIGIN + path);
            // Preserve the existing route/query when recovering a warm page.
            if (pageLoaded && web.getUrl() != null && local(Uri.parse(web.getUrl()))) uri = Uri.parse(web.getUrl());
            else if (lastRoute != null) uri = lastRoute;
            Uri.Builder target = uri.buildUpon().clearQuery();
            for (String key : uri.getQueryParameterNames()) {
                if (!"desktop_token".equals(key))
                    for (String value : uri.getQueryParameters(key)) target.appendQueryParameter(key, value);
            }
            lastToken = token;
            Uri destination = target.appendQueryParameter("desktop_token", token).build();
            navigating(destination); web.loadUrl(destination.toString());
        }
    }
    private void connect() {
        int attempt = ++generation;
        if (pending != null) pending.cancel(true);
        if (!new File(getFilesDir(), "runtime/opt/host/launch.mjs").isFile()) { failed(R.string.host_runtime_missing); return; }
        if (!pageLoaded) showConnecting();
        pending = probes.submit(() -> {
            String token = HostConnection.ready(HostService.state(this));
            handler.post(() -> {
                if (!current(attempt)) return;
                if (token != null) { ready(token, false); return; }
                showConnecting();
                // This is a visible user-open/retry, not boot or background
                // auto-restart. Service startup is idempotent in its process.
                try { startForegroundService(new Intent(this, HostService.class)); }
                catch (RuntimeException denied) { failed(R.string.host_start_failed); return; }
                pending = probes.submit(() -> awaitReady(attempt));
            });
        });
    }
    private void awaitReady(int attempt) {
        long deadline = SystemClock.uptimeMillis() + 45000;
        while (!Thread.currentThread().isInterrupted() && SystemClock.uptimeMillis() < deadline) {
            String token = HostConnection.ready(HostService.state(this));
            if (token != null) {
                handler.post(() -> { if (current(attempt)) ready(token, true); }); return;
            }
            try { Thread.sleep(500); }
            catch (InterruptedException cancelled) { Thread.currentThread().interrupt(); return; }
        }
        handler.post(() -> { if (current(attempt)) failed(R.string.host_not_ready); });
    }
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
            web = new WebView(this);
            web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setSupportMultipleWindows(true);
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    trace("navigate main=" + request.isForMainFrame());
                    if (!request.isForMainFrame()) return false;
                    Uri uri = request.getUrl();
                    if (local(uri)) {
                        Uri current = web.getUrl() == null ? null : Uri.parse(web.getUrl());
                        boolean fragmentOnly = pageLoaded && current != null &&
                            !java.util.Objects.equals(uri.getFragment(), current.getFragment()) &&
                            uri.buildUpon().fragment(null).build().equals(current.buildUpon().fragment(null).build());
                        if (!fragmentOnly) {
                            navigating(uri);
                            // A service-worker fetch failure can arrive before
                            // this top-level navigation callback. Verify here
                            // too, even if no page-start/finish event follows.
                            verifyNavigation(uri.toString(), false);
                        }
                        return false;
                    }
                    openBrowser(uri);
                    return true;
                }
                @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                    trace("start scheme=" + Uri.parse(url).getScheme() + " visible=" + web.getVisibility());
                    if (local(Uri.parse(url))) {
                        navigating(Uri.parse(url));
                    } else navigation++;
                }
                @Override public void onPageFinished(WebView view, String url) {
                    trace("finish scheme=" + Uri.parse(url).getScheme() + " visible=" + web.getVisibility() + " same=" + url.equals(web.getUrl()));
                    if (web.getVisibility() != View.VISIBLE || "about:blank".equals(url)) return;
                    // A completed document load still needs a live backend.
                    verifyNavigation(url, true);
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    trace("error code=" + error.getErrorCode() + " main=" + request.isForMainFrame() + " visible=" + web.getVisibility());
                    if (mainRequest(request) && web.getVisibility() == View.VISIBLE) failed(R.string.host_open_failed);
                }
                @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                    trace("http code=" + response.getStatusCode() + " main=" + request.isForMainFrame() + " visible=" + web.getVisibility());
                    if (mainRequest(request) && web.getVisibility() == View.VISIBLE) failed(R.string.host_open_failed);
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
            recovery = new LinearLayout(this); recovery.setOrientation(LinearLayout.VERTICAL);
            recovery.setPadding(32, 32, 32, 32);
            message = new TextView(this); recovery.addView(message);
            progress = new ProgressBar(this); recovery.addView(progress);
            retry = new Button(this); retry.setText(R.string.host_retry); retry.setOnClickListener(view -> connect()); recovery.addView(retry);
            Button controls = new Button(this); controls.setText(R.string.host_controls);
            controls.setOnClickListener(view -> { startActivity(new Intent(this, HostActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish(); });
            recovery.addView(controls); frame.addView(recovery, new android.widget.FrameLayout.LayoutParams(-1, -1));
            frame.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
            });
            setContentView(frame); showConnecting();
        } catch (Exception error) {
            android.widget.TextView status = new android.widget.TextView(this);
            status.setText(R.string.host_start_failed); setContentView(status);
        }
    }
    @Override protected void onResume() { super.onResume(); resumed = true; if (recovery != null) connect(); }
    @Override protected void onPause() {
        resumed = false; generation++; if (pending != null) pending.cancel(true); super.onPause();
    }
    @Override protected void onDestroy() {
        probes.shutdownNow(); handler.removeCallbacksAndMessages(null);
        if (popup != null) popup.destroy(); if (web != null) web.destroy(); super.onDestroy();
    }
}
