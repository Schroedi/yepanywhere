package com.yepanywhere.host;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.text.InputType;
import android.widget.*;
import java.util.concurrent.*;
import org.json.*;

/** Native folder onboarding; provider queries never compete with shortcut typing. */
public final class WorkspacesActivity extends Activity {
    private EditText name;
    private TextView message;
    private LinearLayout rows;
    private WorkspaceRegistry registry;
    private String pending;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private CancellationSignal query;
    private boolean destroyed;
    private int generation;
    private boolean pendingMappings;
    private void button(LinearLayout parent, String title, Runnable action) {
        Button button = new Button(this); button.setText(title); button.setAllCaps(false);
        button.setOnClickListener(view -> action.run()); parent.addView(button);
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); registry = new WorkspaceRegistry(this);
        if (saved != null) pending = saved.getString("pending");
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(20 * getResources().getDisplayMetrics().density); content.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this); title.setText(R.string.workspace_title); title.setTextSize(24); content.addView(title);
        TextView intro = new TextView(this); intro.setText(R.string.workspace_intro); content.addView(intro);
        name = new EditText(this); name.setId(R.id.workspace_name); name.setSingleLine(true); name.setHint("Shortcut name, e.g. docs");
        name.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); content.addView(name);
        button(content, "Add folder shortcut", () -> choose(name.getText().toString(), false));
        button(content, "All-files access (optional)", () -> new AlertDialog.Builder(this).setTitle("Allow broad storage access?")
            .setMessage("This lets the app read, modify and delete files throughout accessible shared storage, including Downloads, Documents and photos. It is broader than your selected folders. PRoot does not restrict that authority. SAF tools do not require this permission.")
            .setNegativeButton("Cancel", null).setPositiveButton("Open settings", (dialog, which) -> startActivity(new Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName())))).show());
        button(content, "Apply mappings / restart host", () -> new AlertDialog.Builder(this).setTitle("Apply folder mappings?")
            .setMessage("This restarts the local host and interrupts any active agent turns. Saved sessions stay on disk. Newly enabled, renamed or removed paths take effect on restart. You can cancel and finish current work first.")
            .setNegativeButton("Cancel", null).setPositiveButton("Restart host", (dialog, which) -> {
                stopService(new Intent(this, HostService.class));
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (!destroyed) startForegroundService(new Intent(this, HostService.class));
                    refresh();
                }, 500);
            }).show());
        message = new TextView(this); message.setTextIsSelectable(true); content.addView(message);
        rows = new LinearLayout(this); rows.setOrientation(LinearLayout.VERTICAL); content.addView(rows);
        ScrollView scroll = new ScrollView(this); scroll.addView(content);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        }); setContentView(scroll);
    }
    private void choose(String selected, boolean repair) {
        try {
            WorkspaceRegistry.name(selected);
            if (!repair) {
                JSONArray roots = registry.roots();
                for (int i = 0; i < roots.length(); i++) if (selected.equals(roots.getJSONObject(i).getString("name")))
                    throw new java.io.IOException("Shortcut name already exists; use Reselect or Rename");
            }
            pending = selected;
        }
        catch (Exception error) { message.setText(error.getMessage()); return; }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        // Initial location is only a picker hint; the actual result is always required.
        String initial = getIntent().getStringExtra("initialTree");
        if (initial != null) picker.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(initial));
        startActivityForResult(picker, 10);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != 10 || result != RESULT_OK || data == null || data.getData() == null) { pending = null; return; }
        String selected = pending; pending = null; Uri tree = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags != (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) { message.setText(R.string.workspace_rw_required); return; }
        mutate(() -> {
            getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try { registry.select(selected, tree); }
            catch (Exception error) {
                // Do not leave a new orphan grant after rejected duplicate/invalid selections.
                boolean used = false; JSONArray roots = registry.roots();
                for (int i = 0; i < roots.length(); i++) if (tree.toString().equals(roots.getJSONObject(i).getString("tree"))) used = true;
                if (!used) getContentResolver().releasePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                throw error;
            }
        });
    }
    private interface Mutation { void run() throws Exception; }
    private void mutate(Mutation mutation) {
        worker.execute(() -> {
            try { mutation.run(); runOnUiThread(() -> { message.setText(R.string.workspace_saved); refresh(); }); }
            catch (Exception error) { runOnUiThread(() -> message.setText(String.valueOf(error.getMessage()))); }
        });
    }
    private void rename(String old) {
        EditText edit = new EditText(this); edit.setSingleLine(); edit.setText(old);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Rename shortcut")
            .setMessage("Changing the name changes its /workspaces path after restart.").setView(edit)
            .setNegativeButton("Cancel", null).setPositiveButton("Save", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try { WorkspaceRegistry.name(edit.getText().toString()); }
            catch (Exception error) { edit.setError(error.getMessage()); return; }
            mutate(() -> registry.change(old, edit.getText().toString(), null)); dialog.dismiss();
        })); dialog.show();
    }
    void refresh() {
        if (destroyed) return;
        int current = ++generation;
        if (query != null) query.cancel();
        CancellationSignal signal = new CancellationSignal(); query = signal;
        ScheduledFuture<?> deadline = timer.schedule(signal::cancel, 15, TimeUnit.SECONDS);
        worker.execute(() -> {
            try {
                JSONArray status = registry.status(signal, HostService.running ? HostService.appliedWorkspaces : null);
                runOnUiThread(() -> {
                    if (destroyed || current != generation) return;
                    rows.removeAllViews();
                    java.util.Map<String, String> desired = new java.util.HashMap<>();
                    for (int i = 0; i < status.length(); i++) try {
                        JSONObject root = status.getJSONObject(i);
                        if (root.getBoolean("directAvailable")) desired.put(root.getString("name"), root.getString("tree"));
                    } catch (Exception error) { message.setText(error.getMessage()); }
                    boolean changed = HostService.running && !desired.equals(HostService.appliedWorkspaces);
                    if (changed) message.setText(R.string.workspace_pending);
                    else if (pendingMappings) message.setText(R.string.workspace_saved);
                    pendingMappings = changed;
                    if (status.length() == 0 && !changed) message.setText(R.string.workspace_empty);
                    for (int i = 0; i < status.length(); i++) try { row(status.getJSONObject(i)); }
                    catch (Exception error) { message.setText(error.getMessage()); }
                });
            } catch (Exception error) { runOnUiThread(() -> { if (!destroyed && current == generation) message.setText(String.valueOf(error.getMessage())); }); }
            finally { deadline.cancel(false); }
        });
    }
    private void row(JSONObject root) throws Exception {
        String alias = root.getString("name");
        TextView title = new TextView(this); title.setText(getString(R.string.workspace_row, alias, root.getString("path"))); title.setTextSize(19); rows.addView(title);
        TextView health = new TextView(this); health.setText(getString(R.string.workspace_health, root.getBoolean("safAvailable") ? getString(R.string.workspace_saf_available) : root.optString("safReason"),
            root.getBoolean("mapped") ? getString(R.string.workspace_mapped) : root.getBoolean("directAvailable") ? getString(R.string.workspace_ready) : root.optString("directReason"),
            root.getJSONArray("overlaps").length() > 0 ? getString(R.string.workspace_overlap, root.getJSONArray("overlaps")) : "")); rows.addView(health);
        CheckBox direct = new CheckBox(this); direct.setText(getString(R.string.workspace_direct, alias)); direct.setChecked(root.getBoolean("direct"));
        direct.setOnCheckedChangeListener((button, checked) -> mutate(() -> registry.change(alias, alias, checked))); rows.addView(direct);
        button(rows, "Reselect " + alias, () -> choose(alias, true));
        button(rows, "Rename " + alias, () -> rename(alias));
        button(rows, "Remove " + alias, () -> new AlertDialog.Builder(this).setTitle("Remove shortcut " + alias + "?")
            .setMessage("Files will stay in the selected folder. This removes its registration and releases unused folder permission. Restart to apply direct mapping changes.")
            .setNegativeButton("Cancel", null).setPositiveButton("Remove shortcut", (dialog, which) -> mutate(() -> registry.remove(alias))).show());
    }
    @Override public void onResume() { super.onResume(); refresh(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); out.putString("pending", pending); }
    @Override public void onDestroy() { destroyed = true; if (query != null) query.cancel(); worker.shutdownNow(); timer.shutdownNow(); super.onDestroy(); }
}
