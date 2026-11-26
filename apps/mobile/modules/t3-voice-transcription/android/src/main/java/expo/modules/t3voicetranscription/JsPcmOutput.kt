package expo.modules.t3voicetranscription

import java.util.concurrent.atomic.AtomicBoolean

/** Hands captured PCM to JavaScript, which streams it to the environment while recording. */
internal class JsPcmOutput(
  private val onPcm: (ByteArray) -> Unit,
  private val onEnd: () -> Unit
) : PcmOutput {
  private val ended = AtomicBoolean()
  override val paced = false
  override suspend fun write(buffer: ByteArray, count: Int) {
    if (!ended.get()) onPcm(if (count == buffer.size) buffer else buffer.copyOf(count))
  }
  // JavaScript waits for this before finishing the stream, so the last words are sent.
  override fun finish() {
    if (ended.compareAndSet(false, true)) onEnd()
  }
  override fun verifyConsumed() = Unit
  override fun close() = finish()
}
