package com.yepanywhere.mobile.web

import com.yepanywhere.mobile.connection.YaSubscriptionOverflowException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class NativeOutboundQueueTest {
    private fun message(value: Int, size: Int = 1) = NativeOutboundQueue.Message(1, ByteArray(size) { value.toByte() }, 1)

    @Test fun catchesUpTwoHundredEventsWithoutLosingControlOrFailingTheBridge() = runBlocking {
        val queue = NativeOutboundQueue({})
        val producer = launch(start = CoroutineStart.UNDISPATCHED) {
            repeat(200) { queue.send(message(it), event = true) }
        }
        assertFalse(producer.isCompleted)
        queue.state(message(240))
        queue.send(message(241))
        for (expected in listOf(240, 241) + (0..199).toList()) {
            val next = queue.receive()
            assertEquals(expected, next.bytes[0].toInt() and 255)
            queue.delivered(next)
        }
        producer.join()
        queue.close()
        assertEquals(0, queue.queuedBytes)
    }

    @Test fun closingDropsQueuedAndBlockedMessagesAndReturnsTheirBudget() = runBlocking {
        val queue = NativeOutboundQueue({})
        val producer = launch(start = CoroutineStart.UNDISPATCHED) {
            repeat(200) { queue.send(message(it), event = true) }
        }
        repeat(40) { queue.state(message(250)) }
        queue.close()
        producer.join()
        assertEquals(0, queue.queuedBytes)
    }

    @Test fun eventBytePressureLeavesRoomForAControlReply() = runBlocking {
        val queue = NativeOutboundQueue({}, byteLimit = 1000)
        queue.send(message(1, 900), event = true)
        assertTrue(runCatching { queue.send(message(2, 200), event = true) }.exceptionOrNull() is YaSubscriptionOverflowException)
        queue.send(message(3, 10))
        val control = queue.receive()
        assertEquals(3, control.bytes[0].toInt())
        queue.delivered(control)
        queue.close()
        assertEquals(0, queue.queuedBytes)
    }
}
