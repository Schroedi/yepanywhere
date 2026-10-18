package com.yepanywhere.host;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.widget.*;
import java.io.File;
import java.nio.file.Files;

/** Incubation controls, not the final onboarding/sign-in design. */
public final class HostActivity extends Activity {
    private TextView status;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable refresh = new Runnable() {
        public void run() { updateStatus(); handler.postDelayed(this, 1000); }
    };
    private void button(LinearLayout layout, String title, Runnable action) {
        Button button = new Button(this); button.setText(title);
        button.setOnClickListener(view -> action.run()); layout.addView(button);
    }
    // Core function: uninterrupted user-started agent execution. Distribution
    // eligibility still needs review; this dialog is only offered on request.
    @android.annotation.SuppressLint("BatteryLife")
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 48, 32, 32);
        TextView heading = new TextView(this); heading.setText(R.string.host_heading); heading.setTextSize(22); layout.addView(heading);
        status = new TextView(this); status.setTextIsSelectable(true); layout.addView(status);
        button(layout, "Start local host", () -> startForegroundService(new Intent(this, HostService.class)));
        button(layout, "Open Yep Anywhere", () -> startActivity(new Intent(this, LocalWebActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));
        button(layout, "Set up Codex", () -> startActivity(new Intent(this, LocalWebActivity.class).putExtra("provider", "codex")));
        button(layout, "Set up Claude", () -> startActivity(new Intent(this, LocalWebActivity.class).putExtra("provider", "claude")));
        button(layout, "Stop local host", () -> {
            stopService(new Intent(this, HostService.class));
            HostService.status(this, "Stopped. Saved sessions remain on disk."); updateStatus();
        });
        button(layout, "Enable notifications", () -> {
            if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        });
        button(layout, "Allow background operation", () -> {
            PowerManager power = getSystemService(PowerManager.class);
            if (!power.isIgnoringBatteryOptimizations(getPackageName())) {
                new android.app.AlertDialog.Builder(this).setTitle("Keep sessions running")
                    .setMessage("Allow background operation so sessions can continue with the screen off. This may increase battery usage.")
                    .setNegativeButton("Not now", null).setPositiveButton("Continue", (dialog, which) ->
                        startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())))).show();
            }
        });
        TextView remote = new TextView(this); remote.setText(R.string.host_planned); layout.addView(remote);
        ScrollView scroll = new ScrollView(this); scroll.addView(layout);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        });
        setContentView(scroll);
    }
    private void updateStatus() {
        String message = "Stopped. Runtime needs developer provisioning.";
        try {
            File file = new File(getFilesDir(), "host-status.txt");
            if (file.isFile()) message = new String(Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception ignored) { }
        if (!HostService.running && (message.startsWith("Host process started") || message.startsWith("Starting local host")))
            message = "Stopped. Saved sessions remain on disk. Open Yep Anywhere to start it again.";
        boolean background = getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName());
        status.setText(getString(R.string.host_status, message,
            getString(getSystemService(android.app.NotificationManager.class).areNotificationsEnabled() ? R.string.allowed : R.string.off),
            getString(background ? R.string.allowed : R.string.optimized)));
    }
    @Override public void onResume() { super.onResume(); handler.post(refresh); }
    @Override public void onPause() { handler.removeCallbacks(refresh); super.onPause(); }
}
