package com.yepanywhere.mobile.web

import android.util.Base64
import com.yepanywhere.mobile.YaNativeRuntime
import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.connection.YaConnectionState
import com.yepanywhere.mobile.profiles.YaPairedServerSnapshot
import com.yepanywhere.mobile.profiles.YaServerRoute
import com.yepanywhere.mobile.profiles.YaServerRouteKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

/** The native profile state the WebView credential operations read. */
interface NativeSessionSource {
    suspend fun snapshot(): YaPairedServerSnapshot?
    val connectionState: StateFlow<YaConnectionState>

    /**
     * Run native's own resume for the profile and report where it settled:
     * CONNECTED, REAUTHENTICATION_REQUIRED, REVOKED, FAILED, or null on timeout.
     */
    suspend fun verifyResume(): YaConnectionPhase?
}

class RuntimeNativeSessionSource(
    private val runtime: YaNativeRuntime,
    private val profileId: String,
) : NativeSessionSource {
    private val manager get() = runtime.connectionManager(profileId)

    override suspend fun snapshot(): YaPairedServerSnapshot? = runtime.pairedServers.snapshot(profileId)

    override val connectionState: StateFlow<YaConnectionState> get() = manager.state

    override suspend fun verifyResume(): YaConnectionPhase? {
        val lease = manager.acquire()
        try {
            return withTimeoutOrNull(VERIFY_TIMEOUT_MS) {
                manager.state.first { it.phase in SETTLED_PHASES }.phase
            }
        } finally {
            lease.releaseAndAwait()
        }
    }

    private companion object {
        const val VERIFY_TIMEOUT_MS = 30_000L
        val SETTLED_PHASES = setOf(
            YaConnectionPhase.CONNECTED,
            YaConnectionPhase.REAUTHENTICATION_REQUIRED,
            YaConnectionPhase.REVOKED,
            YaConnectionPhase.FAILED,
        )
    }
}

/**
 * Hands the bundled document its profile's resume credential so it connects
 * through the ordinary web transport (topics/mobile-server-pairing.md
 * § Decided replacement). Install only for signed bundled code bound to one
 * profile: the channel also exists for hosted-`latest`, so the caller's
 * bundled check is the gate, not the channel.
 *
 * The document is never asked for a password. When native has no usable
 * credential it opens native host management, where the profile offers
 * sign-in, and leaves the request pending; the document is replaced when the
 * user returns.
 */
class NativeSessionHostOperations(
    private val scope: CoroutineScope,
    private val profileId: String,
    private val source: NativeSessionSource,
    private val showSignIn: () -> Unit,
    private val pollIntervalMs: Long = 200,
    private val credentialWaitMs: Long = 25_000,
    private val encodeKey: (ByteArray) -> String = { Base64.encodeToString(it, Base64.NO_WRAP) },
) : NativeHostOperations {
    override val features = listOf(CREDENTIAL_METHOD, REAUTHENTICATE_METHOD, SWITCH_METHOD)

    override fun invoke(
        method: String,
        params: JSONObject,
        complete: (NativeHostOperationResult) -> Unit,
    ) {
        when (method) {
            CREDENTIAL_METHOD -> {
                if (params.length() != 0) return complete(invalidParams("$method takes no params"))
                launchOperation(complete) { credential() }
            }
            REAUTHENTICATE_METHOD -> {
                val rejected = params.opt("rejectedSessionId") as? String
                if (params.length() != 1 || rejected.isNullOrEmpty()) {
                    return complete(invalidParams("$method takes rejectedSessionId"))
                }
                launchOperation(complete) { reauthenticate(rejected) }
            }
            SWITCH_METHOD -> {
                if (params.length() != 0) return complete(invalidParams("$method takes no params"))
                showSignIn()
                complete(NativeHostOperationResult.Success(JSONObject()))
            }
            else -> complete(NativeHostOperationResult.Error("unknown_method", "Method is not supported"))
        }
    }

    private fun launchOperation(
        complete: (NativeHostOperationResult) -> Unit,
        operation: suspend () -> NativeHostOperationResult?,
    ) {
        scope.launch {
            val result = try {
                operation()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                NativeHostOperationResult.Error("unavailable", "Native session is unavailable")
            }
            // Null means native sign-in is showing; the document is replaced.
            if (result != null) complete(result)
        }
    }

    private suspend fun credential(): NativeHostOperationResult? {
        val snapshot = settledSnapshot()
            ?: return NativeHostOperationResult.Error("unavailable", "Native session is still resuming")
        if (snapshot.resumeCredential == null || snapshot.profile.securityClient?.revoked == true) {
            showSignIn()
            return null
        }
        return NativeHostOperationResult.Success(credentialJson(snapshot))
    }

    private suspend fun reauthenticate(rejectedSessionId: String): NativeHostOperationResult? {
        val current = settledSnapshot()
        val stored = current?.resumeCredential?.credential
        if (stored != null && stored.sessionId != rejectedSessionId) {
            // Native or another document already holds a newer session.
            return NativeHostOperationResult.Success(credentialJson(current))
        }
        // Native's own resume decides whether the session is really gone.
        return when (source.verifyResume()) {
            YaConnectionPhase.CONNECTED -> credential()
            YaConnectionPhase.REAUTHENTICATION_REQUIRED, YaConnectionPhase.REVOKED -> {
                showSignIn()
                null
            }
            else -> NativeHostOperationResult.Error("unavailable", "Native connection is unavailable")
        }
    }

    /**
     * Native clears the stored credential while a resume is in flight and
     * writes it back once the proof completes, so wait out a transient phase.
     */
    private suspend fun settledSnapshot(): YaPairedServerSnapshot? {
        return withTimeoutOrNull(credentialWaitMs) {
            var snapshot = checkNotNull(source.snapshot()) { "Unknown profile" }
            while (
                snapshot.resumeCredential == null &&
                source.connectionState.value.phase in TRANSIENT_PHASES
            ) {
                delay(pollIntervalMs)
                snapshot = checkNotNull(source.snapshot()) { "Unknown profile" }
            }
            snapshot
        }
    }

    private fun credentialJson(snapshot: YaPairedServerSnapshot): JSONObject {
        val profile = snapshot.profile
        val credential = checkNotNull(snapshot.resumeCredential).credential
        val key = credential.copyBaseKey()
        val encodedKey = try {
            encodeKey(key)
        } finally {
            key.fill(0)
        }
        // The same order native resume tries: preferred, then direct, then relay.
        val routes = profile.routes.sortedWith(
            compareByDescending<YaServerRoute> { it.id == profile.preferredRouteId }
                .thenBy { it.kind != YaServerRouteKind.DIRECT },
        )
        return JSONObject()
            .put("profileId", profileId)
            .put("label", profile.label)
            .put("username", credential.username)
            .put("sessionId", credential.sessionId)
            .put("sessionKey", encodedKey)
            .put("resumeProtocolVersion", credential.resumeProtocolVersion)
            .put(
                "routes",
                JSONArray(
                    routes.map { route ->
                        when (route.kind) {
                            YaServerRouteKind.RELAY -> JSONObject()
                                .put("kind", "relay")
                                .put("wsUrl", route.websocketUrl)
                                .put("relayUsername", checkNotNull(route.relayTarget))
                            YaServerRouteKind.DIRECT -> JSONObject()
                                .put("kind", "direct")
                                .put("wsUrl", route.websocketUrl)
                        }
                    },
                ),
            )
    }

    private fun invalidParams(message: String) = NativeHostOperationResult.Error("invalid_params", message)

    companion object {
        const val CREDENTIAL_METHOD = "session.credential"
        const val REAUTHENTICATE_METHOD = "session.reauthenticate"
        const val SWITCH_METHOD = "host.switch"
        private val TRANSIENT_PHASES = setOf(YaConnectionPhase.CONNECTING, YaConnectionPhase.RETRYING)
    }
}

/** Routes each method to the operations that advertise it. */
class CompositeNativeHostOperations(
    private val operations: List<NativeHostOperations>,
) : NativeHostOperations {
    override val features = operations.flatMap { it.features }

    init {
        require(features.toSet().size == features.size) { "Native host features must be unique" }
    }

    override fun invoke(
        method: String,
        params: JSONObject,
        complete: (NativeHostOperationResult) -> Unit,
    ) {
        val owner = operations.firstOrNull { method in it.features }
            ?: return complete(NativeHostOperationResult.Error("unknown_method", "Method is not supported"))
        owner.invoke(method, params, complete)
    }
}
