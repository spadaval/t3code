package expo.modules.t3voicetranscription

import java.io.File
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class JsPcmOutputTest {
  @Test fun deliversCapturedAudioAsCapturedAndEndsOnce() = runTest {
    val chunks = ArrayDeque(listOf(ByteArray(3200) { 1 }, ByteArray(3200) { 2 }))
    val source = object : PcmCaptureSource {
      override val capacityBytes = 32000
      override fun start() = Unit
      override suspend fun read(buffer: ByteArray, blocking: Boolean): Int {
        val chunk = chunks.removeFirstOrNull() ?: return 0
        chunk.copyInto(buffer)
        return chunk.size
      }
      override fun stop() = Unit
      override fun release() = Unit
    }
    val delivered = mutableListOf<ByteArray>()
    var ends = 0
    val output = JsPcmOutput({ delivered += it }, { ends++ })
    val file = File.createTempFile("js-pcm-output-test-", ".pcm")
    try {
      val capture = LivePcmCapture(source, file, output, testScheduler.timeSource)
      capture.start(this, 0.2) {}
      capture.awaitFinished()
      output.close()
      assertEquals(listOf<Byte>(1, 2), delivered.map { it.first() })
      assertEquals(6400, delivered.sumOf { it.size })
      assertEquals(1, ends)
      // Paced delivery would have waited 200 ms of virtual time.
      assertEquals(0L, testScheduler.currentTime)
    } finally {
      file.delete()
    }
  }
}
