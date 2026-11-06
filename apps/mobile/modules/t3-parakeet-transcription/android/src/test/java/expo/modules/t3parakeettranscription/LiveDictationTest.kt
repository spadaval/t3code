package expo.modules.t3parakeettranscription

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveDictationTest {
  private class ArraySource(private val samples: ShortArray) : LiveAudioSource {
    val drained = CountDownLatch(1)
    private var position = 0
    override fun start() = Unit
    override fun read(into: ShortArray): Int {
      if (position >= samples.size) {
        drained.countDown()
        Thread.sleep(1)
        return 0
      }
      val count = minOf(into.size, samples.size - position)
      samples.copyInto(into, 0, position, position + count)
      position += count
      return count
    }
    override fun stop() = Unit
  }

  private val random = Random(7)
  private fun floor(seconds: Double) = ShortArray((seconds * LIVE_SAMPLE_RATE).toInt()) { random.nextInt(-100, 100).toShort() }
  private fun tone(seconds: Double, amplitude: Double) = ShortArray((seconds * LIVE_SAMPLE_RATE).toInt()) {
    (amplitude * 32767 * sin(2 * PI * 200 * it / LIVE_SAMPLE_RATE)).toInt().toShort()
  }
  private fun speech(seconds: Double) = tone(seconds, 0.3)
  // Above the room but under the speech threshold, like a trailing "there?" said softly.
  private fun softWord(seconds: Double) = tone(seconds, 0.008)

  private fun captured(vararg parts: ShortArray): LiveDictation {
    val source = ArraySource(parts.reduce { a, b -> a + b })
    val session = LiveDictation(source, File.createTempFile("live", ".wav").apply { deleteOnExit() })
    session.start()
    assertTrue(source.drained.await(5, TimeUnit.SECONDS))
    session.stop()
    return session
  }

  private fun seconds(sample: Int) = sample.toDouble() / LIVE_SAMPLE_RATE

  @Test
  fun finalPhraseKeepsASoftLastWord() {
    val session = captured(floor(1.0), speech(2.0), softWord(0.6), floor(0.3))
    while (session.nextPhrase(false) != null) Unit
    val phrase = session.nextPhrase(true)!!
    assertEquals(3.9, seconds(phrase[1]), 0.05)
  }

  @Test
  fun pauseCutKeepsASoftWordBeforeThePause() {
    val session = captured(floor(0.3), speech(8.5), softWord(0.3), floor(0.6), speech(1.0))
    val phrase = session.nextPhrase(false)!!
    assertTrue("cut at ${seconds(phrase[1])}s drops the soft word", seconds(phrase[1]) >= 9.1)
  }
}
