package com.yepanywhere.mobile.web

import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.yepanywhere.mobile.YaNativeRuntime
import java.io.Closeable
import android.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

/** Installed only on the bundled app-assets origin, with a document-owned lease. */
class YaNativeTransportHost private constructor(
    private val view: WebView,
    private val runtime: YaNativeRuntime,
    private val profileId: String,
    private val switchHost: () -> Unit,
) : Closeable {
    private var document: Document? = null
    private var destroyed = false

    fun onDocumentChanged() { document?.close(); document = null }

    override fun close() {
        destroyed = true
        onDocumentChanged()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(view, OBJECT_NAME)
        }
    }

    private fun receive(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        if (destroyed) return
        try {
            if (message.type == WebMessageCompat.TYPE_STRING && message.data == "release:${document?.handle}") {
                onDocumentChanged()
                return
            }
            if (message.type == WebMessageCompat.TYPE_STRING && message.data?.startsWith("{\"type\":\"hello\"") == true) {
                require(document == null && checkNotNull(message.data).length < 1024)
                val hello = JSONObject(message.data!!)
                require(hello.getInt("protocol") == 1)
                val binary = hello.optBoolean("binary") &&
                    WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)
                Document(reply, binary).also { document = it; it.start() }
                return
            }
            val current = checkNotNull(document) { "Native source handshake required" }
            if (message.type == WebMessageCompat.TYPE_STRING) {
                val data = checkNotNull(message.data)
                if (data.startsWith("ack:")) { current.acknowledge(data); return }
                require(data.startsWith("frame:") && data.length <= 87500)
                current.receive(Base64.decode(data.substring(6), Base64.NO_WRAP))
            } else {
                require(current.binary && message.type == WebMessageCompat.TYPE_ARRAY_BUFFER)
                current.receive(message.arrayBuffer)
            }
        } catch (_: Throwable) {
            onDocumentChanged()
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                reply.postMessage("{\"type\":\"fatal\",\"error\":\"Native source bridge rejected a message\"}")
            }
        }
    }

    private inner class Document(val reply: JavaScriptReplyProxy, val binary: Boolean) : Closeable {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val handle = UUID.randomUUID().toString()
        val receiver = NativeTransportFrames.Receiver()
        val outbound = Channel<ByteArray>(32)
        val queuedBytes = AtomicInteger()
        @Volatile var session: YaWebTransportSession? = null
        @Volatile var acknowledgement: CompletableDeferred<Unit>? = null
        @Volatile var expectedAck: String? = null
        @Volatile var closed = false
        @Volatile var receiving = false
        private val lifecycleLock = Any()

        fun start() {
            scope.launch {
                try {
                    val snapshot = checkNotNull(runtime.pairedServers.snapshot(profileId))
                    val manager = runtime.connectionManager(profileId)
                    val lease = manager.acquire()
                    val acquired = YaWebTransportSession(handle, lease, scope, ::emit) {
                        view.post { if (!closed) switchHost() }
                    }
                    synchronized(lifecycleLock) {
                        if (closed) { acquired.close(); return@launch }
                        session = acquired
                    }
                    postText(JSONObject().put("type", "hello").put("protocol", 1).put("handle", handle)
                        .put("profileId", profileId).put("label", snapshot.profile.label)
                        .put("binary", binary).toString())
                    scope.launch {
                        manager.state.collect { state ->
                            emit(JSONObject().put("type", "state").put("phase", state.phase.name)
                                .put("retryAttempt", state.retryAttempt)
                                .put("error", state.errorMessage ?: JSONObject.NULL))
                        }
                    }
                    var id = 1
                    for (bytes in outbound) {
                        var offset = 0
                        while (offset < bytes.size) {
                            val chunk = bytes.copyOfRange(offset, minOf(offset + NativeTransportFrames.CHUNK_BYTES, bytes.size))
                            val frame = NativeTransportFrames.encode(NativeTransportFrames.JSON, id, offset, bytes.size, chunk)
                            acknowledgement = CompletableDeferred()
                            expectedAck = "ack:$handle:$id:${offset + chunk.size}"
                            withContext(Dispatchers.Main) {
                                if (!closed) {
                                    if (binary && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) reply.postMessage(frame)
                                    else if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                                        reply.postMessage("frame:" + Base64.encodeToString(frame, Base64.NO_WRAP))
                                    }
                                }
                            }
                            withTimeout(30_000) { checkNotNull(acknowledgement).await() }
                            offset += chunk.size
                        }
                        queuedBytes.addAndGet(-bytes.size)
                        id += 1
                    }
                } catch (_: kotlinx.coroutines.CancellationException) {
                    // The departed document receives no further replies.
                } catch (_: Throwable) { fail() }
            }
        }

        fun emit(value: JSONObject) {
            val bytes = value.toString().toByteArray(Charsets.UTF_8)
            if (bytes.size > NativeTransportFrames.MAX_MESSAGE_BYTES ||
                queuedBytes.addAndGet(bytes.size) > 64 * 1024 * 1024 || outbound.trySend(bytes).isFailure) fail()
        }

        fun acknowledge(value: String) {
            require(value == expectedAck)
            expectedAck = null
            checkNotNull(acknowledgement).complete(Unit)
        }

        fun receive(bytes: ByteArray) {
            require(!closed && !receiving)
            val frame = NativeTransportFrames.decode(bytes)
            val complete = receiver.accept(frame)
            receiving = true
            scope.launch {
                try {
                    if (complete != null) {
                        val active = checkNotNull(session)
                        if (complete.kind == NativeTransportFrames.UPLOAD) active.uploadChunk(complete.data)
                        else active.dispatch(JSONObject(complete.data.toString(Charsets.UTF_8)))
                    }
                    receiving = false
                    postText("ack:$handle:${frame.id}:${frame.offset + frame.data.size}")
                } catch (_: kotlinx.coroutines.CancellationException) {
                    // Teardown cancels the consumer, never its sibling leases.
                } catch (_: Throwable) { fail() }
            }
        }

        suspend fun postText(value: String) {
            withContext(Dispatchers.Main) {
                if (!closed && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply.postMessage(value)
            }
        }

        fun fail() {
            view.post {
                if (!closed && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    reply.postMessage("{\"type\":\"fatal\",\"error\":\"Native source bridge closed\"}")
                }
                close()
            }
        }

        override fun close() {
            synchronized(lifecycleLock) {
                if (closed) return
                closed = true
                session?.close()
                session = null
            }
            outbound.close()
            scope.cancel()
        }
    }

    companion object {
        const val OBJECT_NAME = "yaNativeTransport"
        fun install(view: WebView, config: WebClientConfig, runtime: YaNativeRuntime,
            profileId: String, switchHost: () -> Unit): YaNativeTransportHost? {
            if (!config.bundled || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return null
            val host = YaNativeTransportHost(view, runtime, profileId, switchHost)
            WebViewCompat.addWebMessageListener(view, OBJECT_NAME, setOf(config.origin)) { _, message, origin, mainFrame, reply ->
                if (mainFrame && runCatching { WebClientOrigin.parse(origin.toString()) }.getOrNull() == config.origin) {
                    host.receive(message, reply)
                }
            }
            return host
        }
    }
}
