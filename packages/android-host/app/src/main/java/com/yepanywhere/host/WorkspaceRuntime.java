package com.yepanywhere.host;

import android.content.Context;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.CancellationSignal;
import android.system.Os;
import dev.machinecontrol.android.storage.LocalWorkspace;
import dev.machinecontrol.android.storage.SafDocuments;
import dev.machinecontrol.android.storage.SharedStorage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Same-app-UID native document bridge, owned by the foreground host lifecycle. */
final class WorkspaceRuntime implements AutoCloseable {
    // This is a guest path. Android supplies the actual source through StorageManager.
    @android.annotation.SuppressLint("SdCardPath")
    static final String SHARED_PATH = "/sdcard";
    final String socket;
    final File sharedSource;
    private final File sharedPlaceholder;
    final Map<String, String> applied = new HashMap<>(); // At most 16 registry roots; fixed for this runtime.
    private final Map<String, File> sources = new LinkedHashMap<>();
    private final Context context;
    private final WorkspaceRegistry registry;
    private final LocalServerSocket server;
    private final Map<LocalSocket, CancellationSignal> clients = new ConcurrentHashMap<>(); // Bounded by four workers + four queued clients.
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(4));
    private final ScheduledThreadPoolExecutor deadlines = new ScheduledThreadPoolExecutor(1);
    private volatile boolean closed;
    WorkspaceRuntime(Context context) throws Exception {
        deadlines.setRemoveOnCancelPolicy(true);
        this.context = context.getApplicationContext(); registry = new WorkspaceRegistry(context); socket = context.getPackageName() + ".saf." + UUID.randomUUID();
        File primary = null;
        try { primary = SharedStorage.primary(context); }
        catch (IOException ignored) { /* Shared status reports current authority/availability. */ }
        sharedSource = primary;
        sharedPlaceholder = new File(context.getFilesDir(), "shared-storage-blocked");
        if (!sharedPlaceholder.isDirectory() && !sharedPlaceholder.mkdir()) throw new IOException("Cannot create blocked shared-storage placeholder");
        Os.chmod(sharedPlaceholder.toString(), 0000);
        JSONArray roots = registry.roots();
        File view = new File(context.getFilesDir(), "workspace-view"); view.mkdirs(); Os.chmod(view.toString(), 0700);
        File[] old = view.listFiles();
        if (old != null) for (File entry : old) { Os.chmod(entry.toString(), 0700); if (!entry.delete()) throw new IOException("Cannot refresh workspace placeholders"); }
        for (int i = 0; i < roots.length(); i++) {
            JSONObject root = roots.getJSONObject(i); String name = root.getString("name"); WorkspaceRegistry.name(name);
            File placeholder = new File(view, name); if (!placeholder.mkdir()) throw new IOException("Cannot create blocked workspace placeholder");
            Os.chmod(placeholder.toString(), 0000);
            if (root.getBoolean("direct")) try {
                File source = LocalWorkspace.resolve(context, android.net.Uri.parse(root.getString("tree")));
                sources.put(name, source); applied.put(name, root.getString("tree"));
            } catch (Exception ignored) { /* Per-root status explains refusal; other roots and private host remain usable. */ }
        }
        Os.chmod(view.toString(), 0555);
        server = new LocalServerSocket(socket);
        java.nio.file.Files.write(new File(HostService.state(context), "android-saf-socket").toPath(), socket.getBytes(StandardCharsets.UTF_8));
        Thread accept = new Thread(() -> {
            while (!closed) {
                LocalSocket client = null;
                try {
                    client = server.accept();
                    if (client.getPeerCredentials().getUid() != android.os.Process.myUid()) { client.close(); continue; }
                    client.setSoTimeout(30000); clients.put(client, new CancellationSignal()); LocalSocket owned = client;
                    workers.execute(() -> serve(owned));
                } catch (Exception error) {
                    if (client != null) { clients.remove(client); try { client.close(); } catch (IOException ignored) { } }
                }
            }
        }, "ya-saf-accept"); accept.start();
    }
    static JSONObject sharedStatus(Context context, String applied) throws Exception {
        JSONObject status = new JSONObject().put("path", SHARED_PATH).put("available", false).put("mapped", false);
        try {
            File source = SharedStorage.primary(context);
            status.put("available", true).put("source", source.toString()).put("mapped", source.toString().equals(applied));
        } catch (IOException error) { status.put("reason", error.getMessage()); }
        return status;
    }
    void bind(List<String> command) {
        command.addAll(Arrays.asList("-b", (sharedSource == null ? sharedPlaceholder : sharedSource) + ":" + SHARED_PATH + "!"));
        command.addAll(Arrays.asList("-b", new File(context.getFilesDir(), "workspace-view") + ":/workspaces"));
        // PRoot consumes a final ! as its no-dereference marker. Append that
        // marker explicitly so a folder whose actual name ends in ! stays intact.
        sources.forEach((name, file) -> command.addAll(Arrays.asList("-b", file + ":/workspaces/" + name + "!")));
    }
    private JSONObject dispatch(JSONObject request, CancellationSignal cancel, File transfer) throws Exception {
        String operation = request.getString("op");
        if (operation.equals("roots")) return new JSONObject().put("roots", registry.status(cancel, applied))
            .put("sharedStorage", sharedStatus(context, sharedSource == null ? null : sharedSource.toString())).put("maxBytes", SafDocuments.MAX_BYTES);
        if (operation.equals("check-shared")) {
            File actual = SharedStorage.primary(context);
            if (!actual.equals(sharedSource)) throw new IOException("Shared storage mapping changed; restart host to apply it");
            return new JSONObject().put("path", SHARED_PATH);
        }
        String name = request.getString("root"); JSONObject root = registry.root(name);
        android.net.Uri tree = android.net.Uri.parse(root.getString("tree"));
        if (operation.equals("check")) {
            if (!root.getBoolean("direct") || !tree.toString().equals(applied.get(name))) throw new IOException("Folder mapping changed; restart host to apply it");
            File actual = LocalWorkspace.resolve(context, tree);
            if (!actual.equals(sources.get(name))) throw new IOException("Folder identity changed; reselect and restart host");
            return new JSONObject().put("path", "/workspaces/" + name);
        }
        SafDocuments docs = new SafDocuments(context, tree, cancel); String path = request.optString("path", "");
        switch (operation) {
            case "ls": return docs.list(path);
            case "stat": return docs.stat(path);
            case "mkdir": return docs.mkdir(path);
            case "rm": return docs.remove(path, request.optBoolean("recursive", false));
            case "rename": return docs.rename(path, request.getString("name"));
            case "get":
                try (OutputStream output = new FileOutputStream(transfer)) { return new JSONObject().put("bytes", docs.read(path, output)); }
            case "put": return docs.write(path, transfer, request.optBoolean("replace", false));
            default: throw new IOException("Unknown document operation");
        }
    }
    private void serve(LocalSocket client) {
        CancellationSignal cancel = clients.get(client); File transfer = null;
        ScheduledFuture<?> timeout = deadlines.schedule(() -> {
            cancel.cancel(); try { client.close(); } catch (IOException ignored) { }
        }, 30, TimeUnit.SECONDS);
        try (LocalSocket owned = client) {
            DataInputStream input = new DataInputStream(client.getInputStream());
            DataOutputStream output = new DataOutputStream(client.getOutputStream());
            int size = input.readInt(); if (size < 2 || size > 16384) throw new IOException("Invalid request size");
            byte[] header = new byte[size]; input.readFully(header);
            JSONObject request = new JSONObject(new String(header, StandardCharsets.UTF_8));
            transfer = File.createTempFile("saf-transfer-", ".tmp", context.getCacheDir());
            if (request.getString("op").equals("put")) {
                long bytes = request.getLong("bytes");
                if (bytes < 0 || bytes > SafDocuments.MAX_BYTES) throw new IOException("Transfer exceeds 64 MiB limit");
                try (OutputStream file = new FileOutputStream(transfer)) {
                    byte[] buffer = new byte[65536]; long remaining = bytes;
                    while (remaining > 0) {
                        cancel.throwIfCanceled(); int n = input.read(buffer, 0, (int)Math.min(buffer.length, remaining));
                        if (n < 0) throw new EOFException("Upload incomplete; external document untouched");
                        file.write(buffer, 0, n); remaining -= n;
                    }
                    // Upload must end before the provider is allowed to mutate anything.
                    if (input.read() != -1) throw new IOException("Unexpected upload bytes");
                }
            }
            JSONObject result;
            try { result = new JSONObject().put("ok", true).put("result", dispatch(request, cancel, transfer)); }
            catch (Exception error) { result = failure(error); }
            byte[] reply = result.toString().getBytes(StandardCharsets.UTF_8);
            output.writeInt(reply.length); output.write(reply); output.flush();
            if (result.getBoolean("ok") && request.getString("op").equals("get"))
                try (InputStream file = new FileInputStream(transfer)) { SafDocuments.copy(file, output, SafDocuments.MAX_BYTES, cancel); }
        } catch (Exception error) {
            // A disconnected/timed-out client sees failure, never a success response.
        } finally {
            timeout.cancel(false); cancel.cancel(); if (transfer != null) transfer.delete(); clients.remove(client);
        }
    }
    private static JSONObject failure(Exception error) throws JSONException {
        return new JSONObject().put("ok", false).put("error", error.getClass().getSimpleName()).put("message", String.valueOf(error.getMessage()));
    }
    @Override public void close() {
        closed = true;
        try { server.close(); } catch (IOException ignored) { }
        clients.forEach((client, cancel) -> { cancel.cancel(); try { client.close(); } catch (IOException ignored) { } });
        workers.shutdownNow(); deadlines.shutdownNow();
    }
}
