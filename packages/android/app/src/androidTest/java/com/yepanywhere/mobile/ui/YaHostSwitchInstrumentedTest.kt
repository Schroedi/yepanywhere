package com.yepanywhere.mobile.ui

import android.content.Intent
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.yepanywhere.mobile.MainActivity
import com.yepanywhere.mobile.R
import com.yepanywhere.mobile.YepAnywhereApplication
import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.profiles.YaServerRoute
import com.yepanywhere.mobile.web.WebClientActivity
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Owns one profile and no sibling lease: ordinary switching must fully stop it. */
@RunWith(AndroidJUnit4::class)
class YaHostSwitchInstrumentedTest {
    @Test fun switchDuringResumeDoesNotSignOutAndReopensWithoutPassword() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val ws = args.getString("yaProbeWsUrl")
        val username = args.getString("yaProbeUsername")
        val password = args.getString("yaProbePassword")
        assumeTrue("Disposable probe arguments absent", ws != null && username != null && password != null)
        val app = instrumentation.targetContext.applicationContext as YepAnywhereApplication
        val runtime = app.nativeRuntime
        val previous = runBlocking { runtime.pairedServers.selectedProfileId.first() }
        val profile = runBlocking { runtime.pairing.pair("Host switch probe", checkNotNull(username), checkNotNull(password), YaServerRoute.direct(checkNotNull(ws))) }
        val manager = runtime.connectionManager(profile.id)
        val http = OkHttpClient()
        val base = checkNotNull(ws).replace("ws://", "http://").substringBefore("/api/ws")
        fun control(path: String, post: Boolean = true): JSONObject {
            val request = Request.Builder().url("$base/__probe/$path")
            if (post) request.post(ByteArray(0).toRequestBody())
            return http.newCall(request.build()).execute().use {
                assertTrue(it.isSuccessful)
                JSONObject(checkNotNull(it.body).string())
            }
        }
        val device = UiDevice.getInstance(instrumentation)
        val main = ActivityScenario.launch<MainActivity>(Intent(app, MainActivity::class.java).putExtra(MainActivity.SHOW_HOSTS, true))
        try {
            repeat(2) { attempt ->
                assertTrue(device.wait(Until.hasObject(By.text("Host switch probe")), 5_000))
                // This run owns its profile but preserves any pre-existing phone profiles.
                hostCard(device).findObject(By.text("Open full app")).click()
                waitFor { evaluate("document.body.textContent.includes('preview-project')") == "true" }
                runBlocking { withTimeout(10_000) { manager.state.first { it.phase == YaConnectionPhase.CONNECTED } } }
                if (attempt == 1) {
                    control("resume-hold?enabled=true")
                    control("disconnect")
                    waitFor { control("resume-hold", false).getInt("heldResumes") > 0 }
                    assertNull(runBlocking { runtime.pairedServers.snapshot(profile.id)?.resumeCredential })
                }
                evaluate("if (!document.querySelector('.sidebar-switch-host')) document.querySelector('.sidebar-toggle')?.click(); true")
                waitFor { evaluate("!!document.querySelector('.sidebar-switch-host')") == "true" }
                evaluate("document.querySelector('.sidebar-switch-host').click(); true")
                assertTrue(device.wait(Until.hasObject(By.text("Servers")), 5_000))
                runBlocking { withTimeout(10_000) {
                    manager.state.first { it.phase == YaConnectionPhase.IDLE }
                    while (runtime.pairedServers.snapshot(profile.id)?.resumeCredential?.isEligibleAt(System.currentTimeMillis()) != true) delay(25)
                } }
                control("resume-hold?enabled=false")
                instrumentation.waitForIdleSync()
                waitFor { hostCard(device).hasObject(By.text("Idle")) }
                assertFalse("Valid saved credential must not leave a sign-in warning after Switch Host", hostCard(device).hasObject(By.text("Sign-in required")))
                assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "host-switch-$attempt.png")))
            }
            hostCard(device).findObject(By.text("Open full app")).click()
            waitFor { evaluate("document.body.textContent.includes('preview-project')") == "true" }
            assertEquals(YaConnectionPhase.CONNECTED, manager.state.value.phase)
        } finally {
            control("resume-hold?enabled=false")
            instrumentation.runOnMainSync {
                ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<WebClientActivity>().forEach { it.finish() }
            }
            main.close()
            runBlocking {
                withTimeout(10_000) { manager.state.first { it.phase == YaConnectionPhase.IDLE } }
                runtime.pairedServers.forget(profile.id)
                if (previous != null && runtime.pairedServers.snapshot(previous) != null) runtime.pairedServers.select(previous)
            }
            http.connectionPool.evictAll()
            http.dispatcher.executorService.shutdown()
        }
    }

    private fun hostCard(device: UiDevice): UiObject2 {
        var node: UiObject2? = device.findObject(By.text("Host switch probe"))
        while (node != null) {
            if (node.hasObject(By.text("Open full app"))) return node
            node = node.parent
        }
        error("Fixture host card is unavailable")
    }

    private fun waitFor(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (System.nanoTime() < deadline) { if (condition()) return; Thread.sleep(50) }
        error("Host switch condition did not settle")
    }
    private fun evaluate(script: String): String {
        val result = AtomicReference("false")
        val done = CountDownLatch(1)
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<WebClientActivity>().singleOrNull()
            if (activity == null) done.countDown()
            else activity.findViewById<WebView>(R.id.web_client).evaluateJavascript(script) { result.set(it); done.countDown() }
        }
        assertTrue("WebView callback timed out", done.await(5, TimeUnit.SECONDS))
        return result.get()
    }
}
