package com.yepanywhere.mobile.connection

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.ya_mobile_core.NativeSourceLeaseInterface
import uniffi.ya_mobile_core.NativeSecurityBinding
import uniffi.ya_mobile_core.CoreException

class YaRustTransportTest {
    @Test fun subscriptionSetupFailuresKeepTheirNativeCodes() = runBlocking {
        val failures = listOf(
            CoreException.Unavailable() to "CONNECTION_UNAVAILABLE",
            CoreException.Overflow() to "OVERFLOW",
            CoreException.InvalidMessage() to "INVALID_MESSAGE",
        )
        for ((failure, code) in failures) {
            val session = FakeSession().also { it.failure = failure }
            val transport = YaRustMessageTransport(session, true) {}
            try {
                transport.send(JSONObject().put("type", "subscribe").put("subscriptionId", "failed").put("channel", "activity"))
                val reply = withTimeout(2_000) { transport.receive() }
                assertEquals("subscriptionError", reply.getString("type"))
                assertEquals(code, reply.getString("errorCode"))
                assertFalse(reply.has("status"))
                assertFalse(session.closed)
            } finally { transport.closeAndAwait() }
        }
    }

    @Test fun realHttpFailureRetainsStatusHeadersAndBody() = runBlocking {
        val session = FakeSession().also {
            it.response = """{"status":503,"headers":{"Retry-After":"30"},"body":{"error":"maintenance"}}"""
        }
        val transport = YaRustMessageTransport(session, true) {}
        try {
            transport.send(JSONObject().put("type", "request").put("id", "server")
                .put("method", "GET").put("path", "/maintenance"))
            val reply = withTimeout(2_000) { transport.receive() }
            assertEquals("response", reply.getString("type"))
            assertEquals(503, reply.getInt("status"))
            assertEquals("30", reply.getJSONObject("headers").getString("Retry-After"))
            assertEquals("maintenance", reply.getJSONObject("body").getString("error"))
        } finally { transport.closeAndAwait() }
    }

    @Test fun nativeFailureIsAnOperationErrorInsteadOfAnHttpResponse() = runBlocking {
        val failures = listOf(
            CoreException.Unavailable() to "CONNECTION_UNAVAILABLE",
            CoreException.Closed() to "CONNECTION_UNAVAILABLE",
            CoreException.Timeout() to "TIMEOUT",
            CoreException.Overflow() to "OVERFLOW",
            CoreException.InvalidMessage() to "INVALID_MESSAGE",
            CoreException.ReauthenticationRequired() to "REAUTHENTICATION_REQUIRED",
        )
        for ((failure, code) in failures) {
            val session = FakeSession().also { it.failure = failure }
            val transport = YaRustMessageTransport(session, true) {}
            try {
                transport.send(JSONObject().put("type", "request").put("id", "failed")
                    .put("method", "GET").put("path", "/failed"))
                val reply = withTimeout(2_000) { transport.receive() }
                assertEquals("requestError", reply.getString("type"))
                assertEquals("failed", reply.getString("id"))
                assertEquals(code, reply.getString("code"))
                assertFalse(reply.has("status"))
                assertFalse(session.closed)
            } finally { transport.closeAndAwait() }
        }
    }

    @Test fun cancellingCallerReleasesItsRustFutureAndPreservesPeer() = runBlocking {
        val session = FakeSession()
        val transport = YaRustMessageTransport(session, true) {}
        try {
            transport.send(JSONObject().put("type", "request").put("id", "held").put("method", "GET").put("path", "/held"))
            withTimeout(5_000) { session.started.await() }
            transport.cancelRequest("held")
            withTimeout(5_000) { session.cancelled.await() }
            assertFalse(session.closed)
            assertEquals(200, transport.directRequest("GET", "/peer", null).status)
        } finally { transport.closeAndAwait() }
        assertTrue(session.closed)
    }
    @Test fun closingSourceWakesActiveAndQueuedUploadWriters() = runBlocking {
        val session = FakeSession().also { it.holdUploads = true }
        val transport = YaRustMessageTransport(session, true) {}
        val id = java.util.UUID.randomUUID().toString()
        val first = async { runCatching { transport.sendUploadChunk(id, 0, byteArrayOf(1)) } }
        withTimeout(5_000) { session.uploadStarted.await() }
        val queued = async(start = CoroutineStart.UNDISPATCHED) { runCatching { transport.sendUploadChunk(id, 1, byteArrayOf(2)) } }
        transport.closeAndAwait()
        withTimeout(5_000) {
            assertTrue(first.await().isFailure)
            assertTrue(queued.await().isFailure)
        }
    }
    private class FakeSession : NativeSourceLeaseInterface {
        val started = CompletableDeferred<Unit>()
        val cancelled = CompletableDeferred<Unit>()
        private val events = Channel<String>()
        var closed = false
        var holdUploads = false
        var failure: CoreException? = null
        var response = "{\"status\":200,\"headers\":{},\"body\":{}}"
        val uploadStarted = CompletableDeferred<Unit>()
        override fun release() { closed = true }
        override fun routeId() = "fixture-route"
        override fun credentialData() = YaRustCredential.encode(YaResumeCredential("fixture-owner", "fixture-session", ByteArray(32), 3))
        override fun securityBinding() = NativeSecurityBinding("fixture-session", "fixture-nonce")
        override suspend fun nextEvent() = events.receive()
        override suspend fun uploadChunk(payload: ByteArray) {
            if (holdUploads) { uploadStarted.complete(Unit); awaitCancellation() }
        }
        override suspend fun dispatch(method: String, params: String): String {
            failure?.let { throw it }
            if (JSONObject(params).optString("path") == "/held") {
                started.complete(Unit)
                try { awaitCancellation() } finally { cancelled.complete(Unit) }
            }
            return response
        }
    }
}
