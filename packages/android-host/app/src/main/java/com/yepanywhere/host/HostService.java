package com.yepanywhere.host;

import android.app.*;
import android.content.*;
import android.os.*;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructUtsname;
import java.io.*;
import java.lang.Process;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Android owns the process tree; closing an activity does not stop the host. */
public final class HostService extends Service {
    static volatile boolean running;
    static volatile String appliedSharedStorage;
    static volatile Map<String, String> appliedWorkspaces = Collections.emptyMap();
    private WorkspaceRuntime workspaces;
    private static volatile CountDownLatch shutdown = new CountDownLatch(0);
    private final Object lock = new Object();
    private Process child;
    private File groupFile;
    private HostResolver resolver;
    private boolean started, stopping;

    @Override public IBinder onBind(Intent intent) { return null; }

    static File state(Context c) { return new File(c.getFilesDir(), "state"); }
    static void status(Context c, String value) {
        try { Files.write(new File(c.getFilesDir(), "host-status.txt").toPath(), value.getBytes(StandardCharsets.UTF_8)); }
        catch (IOException ignored) { }
    }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (started) return START_NOT_STICKY;
        started = true;
        running = true;
        status(this, "Starting local host. Saved sessions remain on disk.");
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("host", "On-device sessions", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, HostActivity.class), PendingIntent.FLAG_IMMUTABLE);
        startForeground(1, new Notification.Builder(this, "host")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("YA Host is running")
            .setContentText("On-device server active. Open the app to stop it.")
            .setContentIntent(open).setOngoing(true).build());
        CountDownLatch previousShutdown = shutdown;
        new Thread(() -> runHost(previousShutdown), "ya-host-runtime").start();
        return START_NOT_STICKY;
    }

    private void runHost(CountDownLatch previousShutdown) {
        try {
            // A quick Stop -> Open must join the old group's bounded sweep,
            // not launch another server against its still-bound port.
            if (!previousShutdown.await(8, TimeUnit.SECONDS)) throw new IOException("Previous host shutdown is still pending. Retry from the app.");
            File root = new File(getFilesDir(), "runtime");
            if (!new File(root, "opt/host/launch.mjs").isFile()) {
                throw new IOException("Runtime not installed. Use the developer provisioning command.");
            }
            File home = state(this); home.mkdirs();
            File tmp = new File(getCacheDir(), "proot"); tmp.mkdirs();
            String lib = getApplicationInfo().nativeLibraryDir;
            StructUtsname uts = Os.uname();
            // PRoot's full UTS format changes only the guest hostname. Keep
            // the real kernel/architecture and leave hardware capabilities
            // unchanged (-1); no Android hostname or namespace is modified.
            String guestKernel = "\\" + uts.sysname + "\\ya-phone\\" + uts.release
                + "\\" + uts.version + "\\" + uts.machine + "\\localdomain\\-1\\";
            synchronized (lock) {
                if (stopping) return;
                resolver = new HostResolver(this);
                workspaces = new WorkspaceRuntime(getApplicationContext());
                appliedSharedStorage = workspaces.sharedSource == null ? null : workspaces.sharedSource.toString();
                appliedWorkspaces = Collections.unmodifiableMap(new HashMap<>(workspaces.applied));
            }
            List<String> command = new ArrayList<>(Arrays.asList(
                lib + "/libproot.so", "--kill-on-exit", "--link2symlink", "-i", "1000:1000", "-k", guestKernel,
                "-r", root.toString(), "-b", "/dev", "-b", "/proc", "-b", "/sys",
                "-b", new File(root, "opt/host/hosts") + ":/etc/hosts",
                "-b", new File(root, "opt/host/hostname") + ":/etc/hostname",
                "-b", resolver.file + ":/etc/resolv.conf",
                "-b", home + ":/home/user"));
            workspaces.bind(command);
            command.addAll(Arrays.asList("-w", "/home/user", "/usr/bin/env", "-i",
                "YEP_ANDROID_SAF_SOCKET=" + workspaces.socket,
                "HOME=/home/user", "USER=user", "LOGNAME=user", "SHELL=/bin/bash", "HOSTNAME=ya-phone", "LANG=C.UTF-8", "PATH=/usr/bin:/bin",
                "/usr/bin/node", "/opt/host/launch.mjs"));
            // Own a session/process group so Stop reaches tracees too. Killing
            // only the PRoot tracer can leave Node and providers orphaned.
            File pidFile = File.createTempFile("host-group-", ".pid", getCacheDir());
            List<String> grouped = new ArrayList<>(Arrays.asList(
                "/system/bin/setsid", "/system/bin/sh", "-c",
                "printf '%s' \"$$\" > \"$1\"; shift; exec \"$@\"",
                "ya-host", pidFile.toString()));
            grouped.addAll(command);
            ProcessBuilder builder = new ProcessBuilder(grouped);
            builder.directory(getFilesDir());
            builder.environment().clear();
            builder.environment().put("PROOT_LOADER", lib + "/libproot-loader.so");
            builder.environment().put("PROOT_TMP_DIR", tmp.toString());
            builder.environment().put("LD_LIBRARY_PATH", lib);
            builder.redirectErrorStream(true);
            Process process;
            synchronized (lock) {
                if (stopping) { pidFile.delete(); return; }
                groupFile = pidFile;
                child = process = builder.start();
            }
            status(this, "Host process started. Open Yep Anywhere when ready.");
            process.getOutputStream().close();
            try (InputStream in = process.getInputStream(); OutputStream log = new FileOutputStream(new File(getFilesDir(), "host.log"))) {
                byte[] bytes = new byte[4096]; int n, total = 0;
                while ((n = in.read(bytes)) >= 0) {
                    int keep = Math.min(n, Math.max(0, 1024 * 1024 - total));
                    log.write(bytes, 0, keep); total += keep;
                }
            }
            int result = process.waitFor();
            synchronized (lock) { if (!stopping) status(this, "Host exited (" + result + "). Saved sessions remain on disk."); }
        } catch (Exception error) {
            synchronized (lock) { if (!stopping) status(this, "Host unavailable: " + error.getMessage()); }
        } finally { stopSelf(); }
    }

    @Override public void onDestroy() {
        CountDownLatch completion = new CountDownLatch(1);
        shutdown = completion;
        running = false;
        Process process;
        File pidFile;
        synchronized (lock) {
            stopping = true; process = child; pidFile = groupFile;
            if (resolver != null) resolver.close();
            if (workspaces != null) { workspaces.close(); workspaces = null; appliedWorkspaces = Collections.emptyMap(); appliedSharedStorage = null; }
        }
        if (process != null) {
            new Thread(() -> {
                try {
                    // Startup can race Stop before the shell writes its pid.
                    String value = "";
                    for (int attempt = 0; attempt < 100; attempt++) {
                        value = new String(Files.readAllBytes(pidFile.toPath()), StandardCharsets.US_ASCII).trim();
                        if (!value.isEmpty() || !process.isAlive()) break;
                        Thread.sleep(10);
                    }
                    if (value.matches("[1-9][0-9]*")) {
                        int group = Integer.parseInt(value);
                        try { Os.kill(-group, OsConstants.SIGTERM); }
                        catch (android.system.ErrnoException ignored) { }
                        // Always sweep the owned group, including children
                        // left behind if its leader exits before they do.
                        Thread.sleep(2000);
                        try { Os.kill(-group, OsConstants.SIGKILL); }
                        catch (android.system.ErrnoException ignored) { }
                    }
                } catch (Exception error) {
                    status(this, "Host shutdown could not be verified. Stop the app before restarting.");
                } finally {
                    // Android's Process.destroy closes streams; keep it off
                    // the main thread and signal the group before doing so.
                    try { process.destroyForcibly(); pidFile.delete(); }
                    finally { completion.countDown(); }
                }
            }, "ya-host-stop").start();
        } else completion.countDown();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
