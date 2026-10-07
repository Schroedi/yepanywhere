package com.yepanywhere.mobile.web

import android.content.Intent
import android.os.SystemClock
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.yepanywhere.mobile.MainActivity
import com.yepanywhere.mobile.R
import com.yepanywhere.mobile.YepAnywhereApplication
import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.connection.YaServerConnectionManager
import com.yepanywhere.mobile.profiles.YaServerRoute
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The bundled web app rides out native connection churn without showing server
 * errors the server never sent (gaps/android-native-unavailable-fake-503.md).
 * Scenarios that use the probe server's direct-socket controls run on the
 * direct route only.
 */
@RunWith(AndroidJUnit4::class)
class YaNativeReconnectInstrumentedTest {
    @get:org.junit.Rule
    val launcherAnrRecovery = com.yepanywhere.mobile.LauncherAnrRecoveryRule()

    @Test
    fun requestsMadeWhileNativeReconnectsShowNoSyntheticServerErrors() = withLoadedSession("held-resume", directOnly = true) { session ->
        session.probe("/__probe/resume-hold?enabled=true")
        session.probe("/__probe/disconnect")
        session.awaitNativeLeftConnected()
        // Ordinary demand while native reconnects: leave and reopen the session.
        session.navigate("/projects")
        Thread.sleep(2_000)
        session.navigate(session.sessionPath)
        Thread.sleep(3_000)
        session.probe("/__probe/resume-hold?enabled=false")
        session.assertRecoveredWithoutSyntheticErrors()
    }

    @Test
    fun requestsInFlightWhenNativeDisconnectsShowNoSyntheticServerErrors() = withLoadedSession("in-flight", directOnly = true) { session ->
        // Keep the page's requests pending at the server, then drop native's socket.
        session.probe("/__probe/api-delay?ms=3000")
        session.navigate("/projects")
        Thread.sleep(500)
        session.probe("/__probe/disconnect")
        session.awaitNativeLeftConnected()
        session.probe("/__probe/api-delay?ms=0")
        Thread.sleep(3_000)
        session.navigate(session.sessionPath)
        session.assertRecoveredWithoutSyntheticErrors()
    }

    @Test
    fun manyConcurrentRequestsOnASlowRouteShowNoSyntheticServerErrors() = withLoadedSession("slow-route", directOnly = true) { session ->
        // A slow route keeps the page's requests pending, so opening pages
        // stacks them on native's single session, as after a fresh relay login.
        session.probe("/__probe/api-delay?ms=3000")
        session.navigate("/projects")
        Thread.sleep(300)
        session.navigate(session.sessionPath)
        Thread.sleep(300)
        session.navigate("/projects")
        Thread.sleep(300)
        session.navigate(session.sessionPath)
        Thread.sleep(8_000)
        session.probe("/__probe/api-delay?ms=0")
        session.assertRecoveredWithoutSyntheticErrors()
    }

    @Test
    fun openingTheFirstSessionAfterAFreshLoginShowsNoSyntheticServerErrors() = withLoadedSession("fresh-login", recordFromLaunch = true) { session ->
        // The setup already paired, opened Projects and then the session the
        // moment the page loaded, recording from document start.
        Thread.sleep(10_000)
        session.assertRecoveredWithoutSyntheticErrors()
    }

    private class LoadedSession(
        val scenario: ActivityScenario<MainActivity>,
        val manager: YaServerConnectionManager,
        val sessionPath: String,
        val phases: List<String>,
        private val http: OkHttpClient,
        private val base: String,
        private val test: YaNativeReconnectInstrumentedTest,
    ) {
        fun probe(path: String) = http.newCall(Request.Builder().url("$base$path").post(ByteArray(0).toRequestBody()).build()).execute().use {
            assertTrue("Probe $path failed: ${it.code}", it.isSuccessful)
        }

        fun navigate(path: String) = test.navigate(scenario, path)

        fun awaitNativeLeftConnected() {
            runBlocking { withTimeout(10_000) { manager.state.first { it.phase != YaConnectionPhase.CONNECTED } } }
        }

        fun assertRecoveredWithoutSyntheticErrors() {
            test.await(scenario, "document.body.textContent.includes('Preview message 50') && !document.querySelector('[data-connection-status]')")
            val errors = test.evaluate(scenario, "JSON.stringify(window.__syntheticErrors)")
            assertEquals("Page showed errors the server never sent; native phases=$phases", "\"[]\"", errors)
        }
    }

    private fun withLoadedSession(
        name: String,
        directOnly: Boolean = false,
        recordFromLaunch: Boolean = false,
        body: (LoadedSession) -> Unit,
    ) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val ws = args.getString("yaProbeWsUrl")
        val username = args.getString("yaProbeUsername")
        val password = args.getString("yaProbePassword")
        assumeTrue("Disposable probe arguments absent in config-free CI", ws != null && username != null && password != null)
        val relayWs = args.getString("yaProbeRelayWsUrl")
        assumeTrue("Direct-route scenario", !directOnly || relayWs == null)
        val application = instrumentation.targetContext.applicationContext as YepAnywhereApplication
        val runtime = application.nativeRuntime
        val previous = runBlocking { runtime.pairedServers.selectedProfileId.first() }
        val profile = runBlocking { withTimeout(15_000) {
            withContext(Dispatchers.Main) {
                runtime.pairing.pair("Reconnect probe ${java.util.UUID.randomUUID().toString().take(8)}",
                    checkNotNull(username), checkNotNull(password),
                    if (relayWs == null) YaServerRoute.direct(checkNotNull(ws)) else YaServerRoute.relay(relayWs, checkNotNull(username)))
            }
        } }
        val manager = runtime.connectionManager(profile.id)
        val started = SystemClock.elapsedRealtime()
        val phases = Collections.synchronizedList(mutableListOf<String>())
        val watcher = CoroutineScope(Dispatchers.Default)
        watcher.launch { manager.state.collect { phases += "${SystemClock.elapsedRealtime() - started}ms ${it.phase} attempt=${it.retryAttempt} ${it.errorMessage ?: ""}".trim() } }
        val preferences = application.getSharedPreferences("native-tabs", android.content.Context.MODE_PRIVATE)
        val previousTabs = preferences.getString("state", null)
        preferences.edit().remove("state").commit()
        runBlocking { runtime.pairedServers.select(profile.id) }
        val base = checkNotNull(ws).replace("ws://", "http://").replace("wss://", "https://").substringBefore("/api/ws")
        val http = OkHttpClient()
        val scenario = ActivityScenario.launch<MainActivity>(
            Intent(application, MainActivity::class.java).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER))
        var session: LoadedSession? = null
        try {
            if (recordFromLaunch) {
                await(scenario, "document.readyState === 'complete'")
                recordSyntheticErrors(scenario)
            }
            await(scenario, "document.body.textContent.includes('preview-project')")
            val lookup = runBlocking { manager.acquire() }
            val projects = try {
                runBlocking { lookup.request("GET", "/projects").body } as org.json.JSONObject
            } finally {
                runBlocking { lookup.releaseAndAwait() }
            }
            val projectId = projects.getJSONArray("projects").getJSONObject(0).getString("id")
            val sessionPath = "/projects/$projectId/sessions/android-preview-session"
            navigate(scenario, sessionPath)
            await(scenario, "document.body.textContent.includes('Preview message 50')")
            if (!recordFromLaunch) recordSyntheticErrors(scenario)
            session = LoadedSession(scenario, manager, sessionPath, phases, http, base, this)
            body(session)
        } catch (error: Throwable) {
            com.yepanywhere.mobile.UiFailureCapture.save("native-reconnect-$name", "phases=$phases; manager=${manager.state.value}")
            throw error
        } finally {
            runCatching { session?.probe("/__probe/resume-hold?enabled=false") }
            runCatching { session?.probe("/__probe/api-delay?ms=0") }
            watcher.cancel()
            scenario.close()
            preferences.edit().apply { if (previousTabs == null) remove("state") else putString("state", previousTabs) }.commit()
            http.connectionPool.evictAll()
            http.dispatcher.executorService.shutdown()
            runBlocking {
                runtime.pairedServers.forget(profile.id)
                if (previous != null && runtime.pairedServers.snapshot(previous) != null) runtime.pairedServers.select(previous)
            }
        }
    }

    /**
     * Records every synthetic native error the page shows or logs from here on.
     * Real server errors, such as the fixture's unavailable notification
     * service, are not matched.
     */
    private fun recordSyntheticErrors(scenario: ActivityScenario<MainActivity>) {
        evaluate(scenario, """
            (() => {
              window.__syntheticErrors = [];
              const pattern = /Native connection unavailable/;
              const note = (source, text) => {
                const match = String(text).match(/[^\n]{0,80}Native connection unavailable[^\n]{0,80}/);
                if (match) window.__syntheticErrors.push({at: Math.round(performance.now()), source, text: match[0]});
              };
              new MutationObserver(() => {
                const text = document.body.textContent;
                if (pattern.test(text)) note('dom', text);
              }).observe(document.body, {subtree: true, childList: true, characterData: true});
              for (const level of ['error', 'warn']) {
                const original = console[level].bind(console);
                console[level] = (...values) => { note('console.' + level, values.map(String).join(' ')); original(...values); };
              }
              return true;
            })()
        """.trimIndent())
    }

    /** Client-side route change, so the document and its recorder survive. */
    private fun navigate(scenario: ActivityScenario<MainActivity>, path: String) {
        evaluate(scenario, "history.pushState({}, '', '$path'); dispatchEvent(new PopStateEvent('popstate')); true")
    }

    // Matches YaNativeWebAppInstrumentedTest: 30 s is ~3x the slowest observed
    // document readiness on the emulator testbed.
    private fun await(scenario: ActivityScenario<MainActivity>, script: String, timeoutSeconds: Long = 30) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
        var actual = ""
        while (System.nanoTime() < deadline) {
            var ready = false
            scenario.onActivity { activity ->
                ready = activity.nativeTransportDiagnostics() != null && activity.findViewById<WebView>(R.id.web_client)?.progress == 100
            }
            if (!ready) { Thread.sleep(100); continue }
            actual = evaluate(scenario, script)
            if (actual == "true") return
            Thread.sleep(100)
        }
        val page = evaluate(scenario, "JSON.stringify({path: location.pathname, body: document.body.textContent.slice(0, 1200), errors: window.__syntheticErrors})")
        throw AssertionError("Expected $script; got $actual; page=$page")
    }

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        val result = AtomicReference<String>()
        val done = CountDownLatch(1)
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.web_client).evaluateJavascript(script) { result.set(it); done.countDown() }
        }
        assertTrue("JavaScript callback timed out", done.await(5, TimeUnit.SECONDS))
        return result.get()
    }
}
