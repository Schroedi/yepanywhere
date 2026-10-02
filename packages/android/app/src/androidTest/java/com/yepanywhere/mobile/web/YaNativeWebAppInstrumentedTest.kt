package com.yepanywhere.mobile.web

import android.content.Intent
import android.webkit.WebView
import android.view.KeyCharacterMap
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.yepanywhere.mobile.R
import com.yepanywhere.mobile.YepAnywhereApplication
import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.profiles.YaServerRoute
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Real native SRP/resume and the shipped bundled web app against an isolated server. */
@RunWith(AndroidJUnit4::class)
class YaNativeWebAppInstrumentedTest {
    @Test
    fun fullWebAppUsesNativeSessionAndReleasesOnlyItsLease() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val ws = args.getString("yaProbeWsUrl")
        val username = args.getString("yaProbeUsername")
        val password = args.getString("yaProbePassword")
        val relayWs = args.getString("yaProbeRelayWsUrl")
        val uploadBytes = args.getString("yaProbeUploadBytes")?.toInt() ?: 1024 * 1024
        require(uploadBytes in 1..(100 * 1024 * 1024))
        assumeTrue("Disposable probe arguments absent in config-free CI", ws != null && username != null && password != null)
        val application = instrumentation.targetContext.applicationContext as YepAnywhereApplication
        val runtime = application.nativeRuntime
        val previous = runBlocking { runtime.pairedServers.selectedProfileId.first() }
        val profile = runBlocking { withTimeout(15_000) {
            runtime.pairing.pair("WebView probe", checkNotNull(username), checkNotNull(password),
                if (relayWs == null) YaServerRoute.direct(checkNotNull(ws)) else YaServerRoute.relay(relayWs, checkNotNull(username)))
        } }
        val manager = runtime.connectionManager(profile.id)
        val sibling = runBlocking { manager.acquire() }
        val intent = Intent(application, WebClientActivity::class.java).putExtra(WebClientActivity.PROFILE_ID, profile.id)
        val scenario = ActivityScenario.launch<WebClientActivity>(intent)
        val http = OkHttpClient()
        try {
            await(scenario, "document.body.textContent.includes('preview-project')")
            assertEquals("\"/projects\"", evaluate(scenario, "location.pathname"))
            assertEquals("false", evaluate(scenario, "location.href.includes('password') || location.pathname.includes('/login')"))
            val projects = runBlocking { sibling.request("GET", "/projects").body } as org.json.JSONObject
            val projectId = projects.getJSONArray("projects").getJSONObject(0).getString("id")
            evaluate(scenario, "location.href = '/projects/$projectId/sessions/android-preview-session'; true")
            await(scenario, "document.body.textContent.includes('Preview message 50') && !!document.querySelector('textarea[data-composer-input]')")
            val base = checkNotNull(ws).replace("ws://", "http://").replace("wss://", "https://").substringBefore("/api/ws")
            http.newCall(Request.Builder().url("$base/__probe/append").post(ByteArray(0).toRequestBody()).build()).execute().use { assertTrue(it.isSuccessful) }
            await(scenario, "document.body.textContent.includes('Live preview response')")

            // A same-origin child frame cannot act as the trusted main frame.
            evaluate(scenario, """
                (() => { const child = document.createElement('iframe'); child.hidden = true;
                  child.srcdoc = '<script>window.yaNativeTransport?.postMessage("invalid-child-command")<\/script>';
                  document.body.appendChild(child); return true; })()
            """.trimIndent())

            // Exercise the normal attachment editor, including credited binary upload.
            evaluate(scenario, """
                (() => { const input = document.querySelector('input[type=file]');
                  const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array($uploadBytes)], 'native-upload.bin'));
                  input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true})); return true; })()
            """.trimIndent())
            await(scenario, "document.querySelector('.attachment-list')?.textContent.includes('native-upload.bin') === true")
            scenario.onActivity { activity -> activity.findViewById<WebView>(R.id.web_client).requestFocus() }
            evaluate(scenario, """
                window.nativeTypingLatencies = [];
                window.nativeTypingInputLatencies = [];
                window.nativeTypingLongTasks = [];
                if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
                  window.nativeTypingObserver = new PerformanceObserver(list => {
                    window.nativeTypingLongTasks.push(...list.getEntries().map(entry => ({start:entry.startTime, duration:entry.duration})));
                  });
                  window.nativeTypingObserver.observe({entryTypes:['longtask']});
                }
                const composer = document.querySelector('textarea[data-composer-input]');
                // Deliver the fixture's exact hardware characters independently of
                // a physical phone's personal keyboard capitalization preference.
                composer.blur(); composer.setAttribute('autocapitalize', 'off'); composer.focus();
                window.nativeTypingBaseline = composer.value;
                composer.addEventListener('keydown', () => {
                  const started = performance.now();
                  composer.addEventListener('input', () => {
                    window.nativeTypingInputLatencies.push(performance.now() - started);
                    requestAnimationFrame(() => window.nativeTypingLatencies.push(performance.now() - started));
                  }, {once:true});
                }); true;
            """.trimIndent())
            val text = "native typing while uploading"
            val events = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD).getEvents(text.toCharArray())
            for (event in checkNotNull(events)) { instrumentation.sendKeySync(event); Thread.sleep(20) }
            await(scenario, "document.querySelector('textarea[data-composer-input]').value === window.nativeTypingBaseline + '$text'")
            await(scenario, "window.nativeTypingLatencies.length === ${text.length}")
            val latency = evaluate(scenario, "Math.max(...window.nativeTypingLatencies)").toDouble()
            val timing = evaluate(scenario, "window.nativeTypingObserver?.disconnect(); JSON.stringify({samples:window.nativeTypingLatencies,inputSamples:window.nativeTypingInputLatencies,longTasks:window.nativeTypingLongTasks,observerTypes:PerformanceObserver.supportedEntryTypes})")
            assertTrue("Input acknowledgement exceeded 100 ms: $latency; uploadBytes=$uploadBytes; timing=$timing", latency <= 100)
            assertEquals(200, runBlocking { sibling.request("GET", "/version").status })
            // API 35 emulator: whole 100 MiB proof 27 s; Pixel: 16 s.
            // 120 s allows ~4x the slowest run, including a 30 s failed focus
            // observation. This opt-in device probe has no CI timing baseline.
            await(scenario, "document.querySelector('.attachment-list')?.textContent.includes('native-upload.bin') === true && !document.querySelector('.attachment-list')?.textContent.includes('%')", 120)
            scenario.onActivity { activity -> android.util.Log.i("YaNativeWebProof", "uploadBytes=$uploadBytes typingMaxMs=$latency metrics=${activity.nativeTransportDiagnostics()}") }

            scenario.moveToState(Lifecycle.State.CREATED)
            assertEquals(200, runBlocking { sibling.request("GET", "/version").status })
            scenario.moveToState(Lifecycle.State.RESUMED)
            await(scenario, "document.body.textContent.includes('Preview message 50')")
            scenario.recreate()
            await(scenario, "location.pathname.endsWith('/sessions/android-preview-session') && document.body.textContent.includes('Preview message 50')")
            assertEquals(200, runBlocking { sibling.request("GET", "/version").status })
            evaluate(scenario, "if (!document.querySelector('.sidebar-switch-host')) document.querySelector('.sidebar-toggle')?.click(); true")
            await(scenario, "!!document.querySelector('.sidebar-switch-host')")
            evaluate(scenario, "document.querySelector('.sidebar-switch-host').click(); true")
            val device = UiDevice.getInstance(instrumentation)
            assertTrue("Switch Host did not open native management", device.wait(Until.hasObject(By.text("Servers")), 5_000))
            assertTrue(device.wait(Until.hasObject(By.text("WebView probe")), 5_000))
            scenario.close()
            assertEquals(200, runBlocking { sibling.request("GET", "/version").status })
        } finally {
            scenario.close()
            http.connectionPool.evictAll()
            http.dispatcher.executorService.shutdown()
            runBlocking {
                sibling.releaseAndAwait()
                withTimeout(5_000) { manager.state.first { it.phase == YaConnectionPhase.IDLE } }
                runtime.pairedServers.forget(profile.id)
                if (previous != null && runtime.pairedServers.snapshot(previous) != null) runtime.pairedServers.select(previous)
            }
        }
    }

    // Initial direct 1 MiB emulator proof completed in 9.1 s; 30 s gives ~3x
    // that full-run maximum for ordinary document readiness on this testbed.
    private fun await(scenario: ActivityScenario<WebClientActivity>, script: String, timeoutSeconds: Long = 30) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
        var actual = ""
        while (System.nanoTime() < deadline) {
            // Reload can discard an evaluateJavascript callback sent to the
            // departing renderer. Wait for the replacement native handshake.
            var ready = false
            scenario.onActivity { activity ->
                ready = activity.nativeTransportDiagnostics() != null && activity.findViewById<WebView>(R.id.web_client).progress == 100
            }
            if (!ready) { Thread.sleep(100); continue }
            actual = evaluate(scenario, script)
            if (actual == "true") return
            Thread.sleep(100)
        }
        val body = evaluate(scenario, "JSON.stringify({body: document.body.textContent.slice(0, 1800), value: document.querySelector('textarea[data-composer-input]')?.value, active: document.activeElement?.outerHTML.slice(0,200), latencies: window.nativeTypingLatencies})")
        throw AssertionError("Expected $script; got $actual; page=$body")
    }

    private fun evaluate(scenario: ActivityScenario<WebClientActivity>, script: String): String {
        val result = AtomicReference<String>()
        val done = CountDownLatch(1)
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.web_client).evaluateJavascript(script) { result.set(it); done.countDown() }
        }
        assertTrue("JavaScript callback timed out", done.await(5, TimeUnit.SECONDS))
        return result.get()
    }
}
