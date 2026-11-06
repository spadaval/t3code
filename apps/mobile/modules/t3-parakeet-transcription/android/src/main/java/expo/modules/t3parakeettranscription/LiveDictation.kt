package expo.modules.t3parakeettranscription

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.log10
import kotlin.math.max

internal const val LIVE_SAMPLE_RATE = 16000
private const val WINDOW_SAMPLES = LIVE_SAMPLE_RATE * 30 / 1000
private const val READ_SAMPLES = LIVE_SAMPLE_RATE / 10
private const val MAX_SECONDS = 5 * 60

/** Mic, or on debuggable builds a WAV fed at real-time pace so emulators can dictate. */
internal interface LiveAudioSource {
  fun start()
  /** Blocks until samples arrive; returns the count read, or a negative value on failure. */
  fun read(into: ShortArray): Int
  fun stop()
}

@SuppressLint("MissingPermission")
internal class MicrophoneSource : LiveAudioSource {
  private val record = AudioRecord(
    MediaRecorder.AudioSource.VOICE_RECOGNITION,
    LIVE_SAMPLE_RATE,
    AudioFormat.CHANNEL_IN_MONO,
    AudioFormat.ENCODING_PCM_16BIT,
    max(AudioRecord.getMinBufferSize(LIVE_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), READ_SAMPLES * 4),
  )

  override fun start() {
    if (record.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("The microphone is unavailable.")
    record.startRecording()
  }

  override fun read(into: ShortArray) = record.read(into, 0, into.size)

  override fun stop() {
    try {
      record.stop()
    } catch (_: IllegalStateException) {
    }
    record.release()
  }
}

internal class WavFileSource(file: File) : LiveAudioSource {
  private val samples: ShortArray = readPcm16Wav(file)
  private var position = 0
  private var startedAt = 0L

  override fun start() {
    startedAt = SystemClock.elapsedRealtime()
  }

  override fun read(into: ShortArray): Int {
    val due = ((SystemClock.elapsedRealtime() - startedAt) * LIVE_SAMPLE_RATE / 1000).toInt()
    val fed = position
    if (due < fed + into.size) Thread.sleep(((fed + into.size - due) * 1000L / LIVE_SAMPLE_RATE).coerceAtLeast(1))
    for (index in into.indices) into[index] = if (fed + index < samples.size) samples[fed + index] else 0
    position += into.size
    return into.size
  }

  override fun stop() {}
}

private fun readPcm16Wav(file: File): ShortArray {
  val bytes = file.readBytes()
  val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
  var offset = 12
  while (offset + 8 <= bytes.size) {
    val id = String(bytes, offset, 4, Charsets.US_ASCII)
    val size = buffer.getInt(offset + 4)
    if (id == "data") {
      val count = minOf(size, bytes.size - offset - 8) / 2
      return ShortArray(count) { buffer.getShort(offset + 8 + it * 2) }
    }
    offset += 8 + size + (size and 1)
  }
  throw IllegalArgumentException("${file.name} has no PCM data.")
}

/**
 * One live dictation: captures 16 kHz mono, cuts it into phrases at pauses, and lets the
 * inference thread commit finished phrases and preview the open one.
 * Capture runs on its own thread; everything else runs on the inference thread.
 */
internal class LiveDictation(private val source: LiveAudioSource, val wavFile: File) {
  private val lock = Object()
  private var samples = FloatArray(LIVE_SAMPLE_RATE * 30)
  private var length = 0
  private val windowDb = ArrayList<Float>()
  @Volatile var lastDb = -160f
    private set
  @Volatile var failed: String? = null
    private set
  @Volatile var capturing = false
    private set
  private var captureThread: Thread? = null
  val startedAt = SystemClock.elapsedRealtime()

  // Inference thread only.
  private var phraseStart = 0
  private var previewedLength = 0
  val committed = ArrayList<String>()
  var pending = ""
  var previews = 0
  var previewMs = 0L
  var commits = 0
  var commitMs = 0L

  fun start() {
    source.start()
    capturing = true
    captureThread = Thread({ captureLoop() }, "t3-live-dictation").also { it.start() }
  }

  val durationMillis: Long
    get() = synchronized(lock) { length * 1000L / LIVE_SAMPLE_RATE }

  private fun captureLoop() {
    val chunk = ShortArray(READ_SAMPLES)
    try {
      while (capturing) {
        val read = source.read(chunk)
        if (read < 0) throw IllegalStateException("Microphone read failed ($read).")
        if (read == 0) continue
        synchronized(lock) {
          if (length + read > LIVE_SAMPLE_RATE * MAX_SECONDS) {
            capturing = false
            return@synchronized
          }
          if (length + read > samples.size) samples = samples.copyOf(max(samples.size * 2, length + read))
          for (index in 0 until read) samples[length + index] = chunk[index] / 32768f
          length += read
          while ((windowDb.size + 1) * WINDOW_SAMPLES <= length) {
            val from = windowDb.size * WINDOW_SAMPLES
            var energy = 0.0
            for (index in from until from + WINDOW_SAMPLES) energy += samples[index] * samples[index]
            val db = (10 * log10(energy / WINDOW_SAMPLES + 1e-12)).toFloat()
            windowDb += db
            lastDb = db
          }
        }
      }
    } catch (error: Throwable) {
      failed = error.message ?: "Recording failed."
    } finally {
      source.stop()
    }
  }

  private var stopped = false

  /** Stops capture and writes the take for debug capture. */
  @Synchronized
  fun stop() {
    if (stopped) return
    stopped = true
    capturing = false
    captureThread?.join(2000)
    captureThread = null
    try {
      writeWav()
    } catch (_: Exception) {
    }
  }

  fun snapshot(from: Int, to: Int): FloatArray = synchronized(lock) { samples.copyOfRange(from, to) }

  fun allAudio(): DecodedAudio = synchronized(lock) { DecodedAudio(samples.copyOf(length), LIVE_SAMPLE_RATE) }

  /**
   * The next phrase to commit as [start, end), cutting at a pause of at least [pauseMs] after
   * speech, or at the quietest point once a phrase runs long. Null when the open phrase continues.
   */
  fun nextPhrase(final: Boolean): IntArray? {
    val (windows, end) = synchronized(lock) { ArrayList(windowDb) to length }
    if (phraseStart >= end) return null
    if (final) {
      // Runs to the end: a soft last word ("there?") sits under the speech threshold.
      val start = phraseStart
      phraseStart = end
      return intArrayOf(start, end)
    }
    val firstWindow = phraseStart / WINDOW_SAMPLES
    if (windows.size <= firstWindow) return null
    val threshold = speechThreshold(windows)
    var speechWindows = 0
    var silentRun = 0
    for (index in firstWindow until windows.size) {
      if (windows[index] >= threshold) {
        speechWindows += 1
        silentRun = 0
      } else {
        silentRun += 1
        // Short phrases lose context and transcribe worse, so a pause only ends one past MIN_PHRASE_MS.
        if (speechWindows * 30 >= 300 && silentRun * 30 >= PAUSE_MS && (index - firstWindow) * 30 >= MIN_PHRASE_MS) {
          // Cut after the whole pause: a soft word before it reads as silence, and the model needs the gap.
          val cut = (index + 1) * WINDOW_SAMPLES
          return intArrayOf(phraseStart, cut).also { phraseStart = cut; previewedLength = 0 }
        }
      }
    }
    val openWindows = windows.size - firstWindow
    // Leading silence never needs decoding.
    if (speechWindows == 0 && openWindows * 30 > 1500) {
      phraseStart = (windows.size - 300 / 30) * WINDOW_SAMPLES
      return null
    }
    if (openWindows * 30 >= MAX_PHRASE_MS) {
      var quietest = windows.size - 1
      for (index in firstWindow + openWindows * 2 / 3 until windows.size) {
        if (windows[index] < windows[quietest]) quietest = index
      }
      val cut = (quietest + 1) * WINDOW_SAMPLES
      return intArrayOf(phraseStart, cut).also { phraseStart = cut; previewedLength = 0 }
    }
    return null
  }

  /** The open phrase worth previewing: it holds speech and grew since the last preview. */
  fun openPhrase(): IntArray? {
    val (windows, end) = synchronized(lock) { ArrayList(windowDb) to length }
    if (end - max(phraseStart, previewedLength) < LIVE_SAMPLE_RATE * MIN_NEW_AUDIO_MS / 1000) return null
    val threshold = speechThreshold(windows)
    val firstWindow = phraseStart / WINDOW_SAMPLES
    if ((firstWindow until windows.size).none { windows[it] >= threshold }) return null
    previewedLength = end
    return intArrayOf(phraseStart, end)
  }

  fun hasSpeech(start: Int, end: Int): Boolean {
    val windows = synchronized(lock) { ArrayList(windowDb) }
    val threshold = speechThreshold(windows)
    return (start / WINDOW_SAMPLES until minOf(end / WINDOW_SAMPLES, windows.size)).any { windows[it] >= threshold }
  }

  private fun speechThreshold(windows: List<Float>): Float {
    // The noise floor is a low percentile of the last few seconds, so it follows the room.
    val recent = windows.takeLast(5000 / 30).sorted()
    val floor = if (recent.isEmpty()) -90f else recent[recent.size / 10]
    return max(floor + 12f, -55f)
  }

  private fun writeWav() {
    val (pcm, count) = synchronized(lock) { samples to length }
    RandomAccessFile(wavFile, "rw").use { out ->
      out.setLength(0)
      val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      header.put("RIFF".toByteArray()).putInt(36 + count * 2).put("WAVE".toByteArray())
      header.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
        .putInt(LIVE_SAMPLE_RATE).putInt(LIVE_SAMPLE_RATE * 2).putShort(2).putShort(16)
      header.put("data".toByteArray()).putInt(count * 2)
      out.write(header.array())
      val body = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
      for (index in 0 until count) body.putShort((pcm[index].coerceIn(-1f, 1f) * 32767).toInt().toShort())
      out.write(body.array())
    }
  }

  companion object {
    const val PAUSE_MS = 450
    const val MIN_PHRASE_MS = 8_000
    const val MAX_PHRASE_MS = 20_000
    const val MIN_NEW_AUDIO_MS = 350
  }
}

/**
 * Parakeet capitalizes the start of every phrase it decodes, but a pause often falls mid-sentence.
 * Lowercases that first word unless it is "I", an acronym, or follows a sentence end; a proper noun
 * there loses its capital, which reads better than a stray one in every other sentence.
 */
internal fun continuePhrase(previous: String?, text: String): String {
  if (previous == null || previous.lastOrNull() in SENTENCE_ENDS) return text
  val first = text.substringBefore(' ')
  if (first.length < 2 || first == "I" || first.startsWith("I'") || first[1].isUpperCase()) return text
  return text.replaceFirstChar { it.lowercaseChar() }
}

private val SENTENCE_ENDS = setOf('.', '!', '?', ':')
