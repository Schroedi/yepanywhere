package com.yepanywhere.host;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.*;
import android.text.*;
import android.view.KeyEvent;
import android.widget.EditText;
import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.*;
import org.json.JSONObject;
import org.json.JSONArray;

/** Real sequential key dispatch during asynchronous native root refresh. */
public final class WorkspaceTypingProbe extends Instrumentation {
    @Override public void onCreate(Bundle args) { start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        File registry = new File(getTargetContext().getFilesDir(), "workspaces.json");
        byte[] previous = null; boolean existed = registry.exists();
        try {
            if (existed) previous = Files.readAllBytes(registry.toPath());
            JSONArray roots = existed ? new JSONArray(new String(previous, java.nio.charset.StandardCharsets.UTF_8)) : new JSONArray();
            // Render the supported maximum, retaining selected real roots and adding
            // unavailable synthetic registrations. No grants or external files change.
            for (int i = roots.length(); i < 16; i++) roots.put(new JSONObject()
                .put("id", "typing-" + i).put("name", "typing" + i).put("direct", false)
                .put("tree", "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FYA-Typing-Unavailable-" + i));
            Files.write(registry.toPath(), roots.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            WorkspacesActivity activity = (WorkspacesActivity)startActivitySync(new Intent(getTargetContext(), WorkspacesActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            EditText[] input = new EditText[1]; long[] sent = {0}, maximum = {0}; CountDownLatch[] ack = {new CountDownLatch(1)};
            runOnMainSync(() -> {
                input[0] = activity.findViewById(R.id.workspace_name); input[0].requestFocus(); input[0].setText("");
                input[0].addTextChangedListener(new TextWatcher() {
                    public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
                    public void onTextChanged(CharSequence s, int start, int before, int count) { maximum[0] = Math.max(maximum[0], SystemClock.uptimeMillis() - sent[0]); ack[0].countDown(); }
                    public void afterTextChanged(Editable text) { }
                });
            });
            String typed = "abcdefghijklmnop";
            for (int i = 0; i < typed.length(); i++) {
                runOnMainSync(activity::refresh);
                ack[0] = new CountDownLatch(1); sent[0] = SystemClock.uptimeMillis();
                sendKeyDownUpSync(KeyEvent.KEYCODE_A + i);
                if (!ack[0].await(100, TimeUnit.MILLISECONDS)) throw new IllegalStateException("Key acknowledgement exceeded 100 ms");
                String expected = typed.substring(0, i + 1);
                runOnMainSync(() -> { if (!input[0].getText().toString().equals(expected)) throw new IllegalStateException("Sequential typing lost a key"); });
            }
            if (maximum[0] > 100) throw new IllegalStateException("Typing latency exceeded 100 ms");
            JSONObject facts = new JSONObject().put("roots", 16).put("characters", typed.length()).put("maxAcknowledgementMs", maximum[0]);
            Files.write(new File(getTargetContext().getFilesDir(), "typing.json").toPath(), facts.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            result.putString("stream", "WORKSPACE_TYPING_PASS\n");
        } catch (Exception error) { result.putString("stream", "WORKSPACE_TYPING_FAILED " + error + "\n"); }
        finally {
            try { if (existed && previous != null) Files.write(registry.toPath(), previous); else if (!existed) Files.deleteIfExists(registry.toPath()); }
            catch (Exception error) { result.putString("stream", "WORKSPACE_TYPING_FAILED registry restore " + error + "\n"); }
        }
        finish(result.getString("stream", "").contains("WORKSPACE_TYPING_PASS") ? -1 : 1, result);
    }
}
