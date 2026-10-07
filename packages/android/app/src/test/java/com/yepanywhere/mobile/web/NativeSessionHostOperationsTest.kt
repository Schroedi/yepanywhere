package com.yepanywhere.mobile.web

import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.connection.YaConnectionState
import com.yepanywhere.mobile.connection.YaResumeCredential
import com.yepanywhere.mobile.profiles.YaPairedServerProfile
import com.yepanywhere.mobile.profiles.YaPairedServerSnapshot
import com.yepanywhere.mobile.profiles.YaServerRoute
import com.yepanywhere.mobile.profiles.YaStoredResumeCredential
import java.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeSessionHostOperationsTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val relay = YaServerRoute.relay("wss://relay.example/ws", "laptop")
    private val direct = YaServerRoute.direct("wss://laptop.example/api/ws")
    private val profile = YaPairedServerProfile.create("Laptop", "laptop", relay)
        .copy(routes = listOf(relay, direct))
    private val key = ByteArray(32) { it.toByte() }

    @After
    fun tearDown() {
        scope.cancel()
    }

    @Test
    fun credentialCarriesTheSessionAndNativeRouteOrder() = runBlocking {
        val source = FakeSource(snapshot("session-1"))
        val result = invoke(operations(source), "session.credential")

        val credential = (result as NativeHostOperationResult.Success).result
        assertEquals(profile.id, credential.getString("profileId"))
        assertEquals("Laptop", credential.getString("label"))
        assertEquals("laptop", credential.getString("username"))
        assertEquals("session-1", credential.getString("sessionId"))
        assertEquals(Base64.getEncoder().encodeToString(key), credential.getString("sessionKey"))
        assertEquals(3, credential.getInt("resumeProtocolVersion"))
        val routes = credential.getJSONArray("routes")
        // The preferred relay route comes first, as native resume tries it.
        assertEquals("relay", routes.getJSONObject(0).getString("kind"))
        assertEquals("laptop", routes.getJSONObject(0).getString("relayUsername"))
        assertEquals("direct", routes.getJSONObject(1).getString("kind"))
        assertEquals("wss://laptop.example/api/ws", routes.getJSONObject(1).getString("wsUrl"))
    }

    @Test
    fun credentialWaitsWhileNativeIsResuming() = runBlocking {
        val source = FakeSource(snapshot(null), YaConnectionPhase.CONNECTING)
        val pending = scope.async { invoke(operations(source), "session.credential") }
        delay(30)
        source.snapshot = snapshot("session-2")
        source.state.value = YaConnectionState(YaConnectionPhase.CONNECTED)

        val result = withTimeout(2_000) { pending.await() } as NativeHostOperationResult.Success
        assertEquals("session-2", result.result.getString("sessionId"))
    }

    @Test
    fun missingCredentialOpensNativeSignInInsteadOfAnswering() = runBlocking {
        val source = FakeSource(snapshot(null), YaConnectionPhase.IDLE)
        var signIns = 0
        val result = invokeOrNull(operations(source) { signIns += 1 }, "session.credential")

        assertNull(result)
        assertEquals(1, signIns)
    }

    @Test
    fun reauthenticateReturnsANewerSessionWithoutSigningIn() = runBlocking {
        val source = FakeSource(snapshot("session-2"))
        var signIns = 0
        val result = invoke(
            operations(source) { signIns += 1 },
            "session.reauthenticate",
            JSONObject().put("rejectedSessionId", "session-1"),
        ) as NativeHostOperationResult.Success

        assertEquals("session-2", result.result.getString("sessionId"))
        assertEquals(0, source.verifications)
        assertEquals(0, signIns)
    }

    @Test
    fun reauthenticateOpensSignInWhenNativeResumeIsAlsoRejected() = runBlocking {
        val source = FakeSource(snapshot("session-1"))
        source.verifyResult = YaConnectionPhase.REAUTHENTICATION_REQUIRED
        var signIns = 0
        val result = invokeOrNull(
            operations(source) { signIns += 1 },
            "session.reauthenticate",
            JSONObject().put("rejectedSessionId", "session-1"),
        )

        assertNull(result)
        assertEquals(1, source.verifications)
        assertEquals(1, signIns)
    }

    @Test
    fun reauthenticateReportsUnavailableWhenNativeCannotReachTheServer() = runBlocking {
        val source = FakeSource(snapshot("session-1"))
        source.verifyResult = YaConnectionPhase.FAILED
        val result = invoke(
            operations(source),
            "session.reauthenticate",
            JSONObject().put("rejectedSessionId", "session-1"),
        )

        assertEquals("unavailable", (result as NativeHostOperationResult.Error).code)
    }

    @Test
    fun invalidParamsAreRejected() = runBlocking {
        val operations = operations(FakeSource(snapshot("session-1")))
        assertEquals(
            "invalid_params",
            (invoke(operations, "session.credential", JSONObject().put("x", 1)) as NativeHostOperationResult.Error).code,
        )
        assertEquals(
            "invalid_params",
            (invoke(operations, "session.reauthenticate") as NativeHostOperationResult.Error).code,
        )
    }

    @Test
    fun switchOpensHostManagement() = runBlocking {
        var signIns = 0
        val result = invoke(operations(FakeSource(snapshot("session-1"))) { signIns += 1 }, "host.switch")

        assertTrue(result is NativeHostOperationResult.Success)
        assertEquals(1, signIns)
    }

    @Test
    fun compositeRoutesByFeatureAndRejectsDuplicates() = runBlocking {
        val session = operations(FakeSource(snapshot("session-1")))
        val composite = CompositeNativeHostOperations(listOf(session))
        assertEquals(session.features, composite.features)
        assertEquals(
            "unknown_method",
            (invoke(composite, "notifications.status") as NativeHostOperationResult.Error).code,
        )
        val duplicate = runCatching { CompositeNativeHostOperations(listOf(session, session)) }
        assertTrue(duplicate.isFailure)
    }

    private fun operations(source: FakeSource, showSignIn: () -> Unit = {}) = NativeSessionHostOperations(
        scope = scope,
        profileId = profile.id,
        source = source,
        showSignIn = showSignIn,
        pollIntervalMs = 5,
        credentialWaitMs = 1_000,
        encodeKey = { Base64.getEncoder().encodeToString(it) },
    )

    private suspend fun invoke(
        operations: NativeHostOperations,
        method: String,
        params: JSONObject = JSONObject(),
    ): NativeHostOperationResult = checkNotNull(invokeOrNull(operations, method, params, waitMs = 2_000))

    private suspend fun invokeOrNull(
        operations: NativeHostOperations,
        method: String,
        params: JSONObject = JSONObject(),
        waitMs: Long = 200,
    ): NativeHostOperationResult? {
        val completion = CompletableDeferred<NativeHostOperationResult>()
        operations.invoke(method, params) { completion.complete(it) }
        return withTimeoutOrNull(waitMs) { completion.await() }
    }

    private fun snapshot(sessionId: String?) = YaPairedServerSnapshot(
        profile,
        sessionId?.let {
            YaStoredResumeCredential(YaResumeCredential("laptop", it, key, 3), 1_000, null)
        },
    )

    private class FakeSource(
        @Volatile var snapshot: YaPairedServerSnapshot,
        phase: YaConnectionPhase = YaConnectionPhase.CONNECTED,
    ) : NativeSessionSource {
        val state = MutableStateFlow(YaConnectionState(phase))
        var verifyResult: YaConnectionPhase? = YaConnectionPhase.CONNECTED
        var verifications = 0
        override suspend fun snapshot() = snapshot
        override val connectionState: StateFlow<YaConnectionState> = state
        override suspend fun verifyResume(): YaConnectionPhase? {
            verifications += 1
            return verifyResult
        }
    }
}
