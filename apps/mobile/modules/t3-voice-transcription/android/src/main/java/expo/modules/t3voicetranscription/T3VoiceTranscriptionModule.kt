package expo.modules.t3voicetranscription

import android.content.pm.ApplicationInfo
import android.net.Uri
import android.util.Log
import android.os.SystemClock
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private const val STATE_EVENT = "onModelStateChange"
private const val LIVE_EVENT = "onLiveTranscript"
private const val LIVE_TAG = "T3LiveDictation"
// Debuggable builds dictate this file instead of the mic when it exists, for emulators.
private const val TEST_INPUT_NAME = "voice-test-input.wav"
// The loaded model holds about 1 GB, which makes the app an early target for
// Android's low-memory killer. Release it once dictation has been idle a while.
private const val IDLE_RELEASE_SECONDS = 120L
private const val DECODING_METHOD = "greedy_search"

class T3VoiceTranscriptionModule : Module() {
  private val store by lazy {
    VoiceModelStore(appContext.reactContext?.filesDir ?: throw IllegalStateException("No context."))
  }
  private val clips by lazy {
    VoiceClipStore(appContext.reactContext ?: throw IllegalStateException("No context."))
  }

  private val bluetoothWait by lazy {
    BluetoothInputWait(appContext.reactContext ?: throw IllegalStateException("No context."))
  }

  // Downloads and inference each get one thread: neither may run twice at once,
  // and a download must not hold up transcription of an installed model.
  private val downloadExecutor = Executors.newSingleThreadExecutor()
  private val inferenceExecutor = Executors.newSingleThreadScheduledExecutor()

  @Volatile private var downloading = false
  @Volatile private var receivedBytes = 0L
  @Volatile private var downloadError: String? = null
  private val downloadCancelled = AtomicBoolean(false)
  private val transcriptionCancelled = AtomicBoolean(false)

  // Only touched on the inference thread.
  private var recognizer: OfflineRecognizer? = null
  private var idleRelease: ScheduledFuture<*>? = null
  @Volatile private var live: LiveDictation? = null
  private var liveStep: ScheduledFuture<*>? = null

  override fun definition() = ModuleDefinition {
    Name("T3VoiceTranscription")
    Events(STATE_EVENT, LIVE_EVENT)

    Function("getModelState") { modelState() }

    Function("downloadModel") { startDownload() }

    Function("cancelDownload") { downloadCancelled.set(true) }

    AsyncFunction("deleteModel") { promise: Promise ->
      downloadCancelled.set(true)
      // Inference first, so a loaded recognizer never outlives its files.
      inferenceExecutor.execute {
        releaseRecognizer()
        downloadExecutor.execute {
          store.delete()
          receivedBytes = 0
          downloadError = null
          emitState()
          promise.resolve(null)
        }
      }
    }

    /** Starts loading the model so it is ready by the time the recording stops. */
    AsyncFunction("prepare") { promise: Promise ->
      if (!store.isInstalled()) {
        promise.reject(CodedException("ModelMissing", "The voice model is not downloaded.", null))
        return@AsyncFunction
      }
      transcriptionCancelled.set(false)
      inferenceExecutor.execute {
        try {
          loadedRecognizer()
        } catch (_: Throwable) {
          // Reported by the transcription that needs it.
        }
      }
      promise.resolve(null)
    }

    AsyncFunction("transcribe") { uri: String, draftOwnerKey: String, draftText: String, requestedAtMs: Double, promise: Promise ->
      transcriptionCancelled.set(false)
      inferenceExecutor.execute {
        try {
          val path = Uri.parse(uri).path ?: uri
          val startedAt = SystemClock.elapsedRealtime()
          val audio = decodeAudio(path)
          val decodedAt = SystemClock.elapsedRealtime()
          val model = loadedRecognizer()
          val loadedAt = SystemClock.elapsedRealtime()
          val text = StringBuilder()
          for (piece in splitAtPauses(audio)) {
            if (transcriptionCancelled.get()) break
            val stream = model.createStream()
            try {
              stream.acceptWaveform(piece, audio.sampleRate)
              model.decode(stream)
              val pieceText = model.getResult(stream).text.trim()
              if (pieceText.isNotEmpty()) {
                if (text.isNotEmpty()) text.append(' ')
                text.append(pieceText)
              }
            } finally {
              stream.release()
            }
          }
          scheduleIdleRelease()
          if (!transcriptionCancelled.get()) {
            saveClip(
              path,
              audio,
              text.toString(),
              JSONObject()
                .put("draftOwnerKey", draftOwnerKey)
                .put("draftTextBefore", draftText)
                .put("requestedAtMs", requestedAtMs.toLong())
                .put("decodeMs", decodedAt - startedAt)
                .put("modelLoadMs", loadedAt - decodedAt)
                .put("inferenceMs", SystemClock.elapsedRealtime() - loadedAt),
            )
          }
          promise.resolve(text.toString())
        } catch (error: Throwable) {
          scheduleIdleRelease()
          promise.reject(CodedException("TranscriptionFailed", error.message ?: "Transcription failed.", error))
        }
      }
    }

    /** Starts capturing; phrases are transcribed while the user speaks. Resolves with the take's URI. */
    AsyncFunction("startLiveDictation") { promise: Promise ->
      inferenceExecutor.execute {
        try {
          discardLive()
          val context = appContext.reactContext ?: throw IllegalStateException("No context.")
          val testInput = File(context.getExternalFilesDir(null), TEST_INPUT_NAME)
          val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
          val source = if (debuggable && testInput.exists()) WavFileSource(testInput) else MicrophoneSource()
          val session = LiveDictation(source, File(context.cacheDir, "live-dictation-${System.currentTimeMillis()}.wav"))
          loadedRecognizer()
          session.start()
          live = session
          scheduleLiveStep(session, 200)
          promise.resolve(Uri.fromFile(session.wavFile).toString())
        } catch (error: Throwable) {
          promise.reject(CodedException("LiveDictationFailed", error.message ?: "Could not start recording.", error))
        }
      }
    }

    Function("getLiveDictationStatus") {
      val session = live
      mapOf(
        "isRecording" to (session?.capturing == true),
        "durationMillis" to (session?.durationMillis ?: 0L).toDouble(),
        "metering" to (session?.lastDb ?: -160f).toDouble(),
        "error" to session?.failed,
      )
    }

    /** Stops capture. Phrases already heard keep transcribing until finishLiveDictation. */
    AsyncFunction("stopLiveDictation") { promise: Promise ->
      val session = live
      Thread {
        session?.stop()
        promise.resolve(null)
      }.start()
    }

    AsyncFunction("finishLiveDictation") { draftOwnerKey: String, draftText: String, requestedAtMs: Double, promise: Promise ->
      val stoppedAt = SystemClock.elapsedRealtime()
      inferenceExecutor.execute {
        val session = live
        if (session == null) {
          promise.reject(CodedException("LiveDictationMissing", "No live dictation is running.", null))
          return@execute
        }
        try {
          liveStep?.cancel(false)
          liveStep = null
          session.stop()
          val model = loadedRecognizer()
          while (true) {
            val phrase = session.nextPhrase(false) ?: break
            commitPhrase(session, model, phrase)
          }
          session.nextPhrase(true)?.let { commitPhrase(session, model, it) }
          session.pending = ""
          emitLive(session)
          val text = session.committed.joinToString(" ")
          val finishMs = SystemClock.elapsedRealtime() - stoppedAt
          Log.i(LIVE_TAG, "finish ${finishMs}ms commits=${session.commits} (${session.commitMs}ms) previews=${session.previews} (${session.previewMs}ms) audio=${session.durationMillis}ms")
          live = null
          scheduleIdleRelease()
          val audio = session.allAudio()
          saveClip(
            session.wavFile.absolutePath,
            audio,
            text,
            JSONObject()
              .put("mode", "live")
              .put("draftOwnerKey", draftOwnerKey)
              .put("draftTextBefore", draftText)
              .put("requestedAtMs", requestedAtMs.toLong())
              .put("finishMs", finishMs)
              .put("commits", session.commits)
              .put("commitMs", session.commitMs)
              .put("previews", session.previews)
              .put("previewMs", session.previewMs),
          )
          promise.resolve(text)
        } catch (error: Throwable) {
          live = null
          scheduleIdleRelease()
          promise.reject(CodedException("TranscriptionFailed", error.message ?: "Transcription failed.", error))
        }
      }
    }

    Function("cancelLiveDictation") {
      inferenceExecutor.execute { discardLive() }
    }

    AsyncFunction("waitForBluetoothInput") { promise: Promise ->
      bluetoothWait.start { ready -> promise.resolve(ready) }
    }

    Function("cancelBluetoothInputWait") { bluetoothWait.cancel() }

    Function("getClipState") { clips.state() }

    Function("setClipCaptureEnabled") { enabled: Boolean ->
      clips.enabled = enabled
      clips.state()
    }

    AsyncFunction("deleteClips") { promise: Promise ->
      inferenceExecutor.execute {
        clips.deleteAll()
        promise.resolve(null)
      }
    }

    /** Stops after the piece being decoded. The pending transcription resolves early. */
    Function("cancelTranscription") { transcriptionCancelled.set(true) }

    OnDestroy {
      downloadCancelled.set(true)
      bluetoothWait.cancel()
      inferenceExecutor.execute {
        discardLive()
        releaseRecognizer()
      }
      inferenceExecutor.shutdown()
      downloadExecutor.shutdown()
    }
  }

  private fun modelState(): Map<String, Any?> = mapOf(
    "status" to when {
      downloading -> "downloading"
      store.isInstalled() -> "installed"
      else -> "missing"
    },
    "receivedBytes" to receivedBytes.toDouble(),
    "totalBytes" to ParakeetModel.totalBytes.toDouble(),
    "error" to downloadError,
  )

  private fun emitState() = sendEvent(STATE_EVENT, modelState())

  private fun startDownload() {
    if (downloading || store.isInstalled()) return
    downloading = true
    downloadError = null
    downloadCancelled.set(false)
    receivedBytes = store.stagedBytes()
    emitState()
    downloadExecutor.execute {
      try {
        store.download({ downloadCancelled.get() }) { bytes ->
          receivedBytes = bytes
          emitState()
        }
      } catch (_: VoiceModelCancelledException) {
        // Staged bytes stay on disk so the next download resumes.
      } catch (error: Exception) {
        downloadError = error.message ?: "The voice model could not be downloaded."
      } finally {
        downloading = false
        emitState()
      }
    }
  }

  // Debug capture must never cost the user their transcript.
  private fun saveClip(path: String, audio: DecodedAudio, transcript: String, details: JSONObject) {
    try {
      clips.save(
        path,
        details
          .put("transcript", transcript)
          .put("model", ParakeetModel.ID)
          .put("decodingMethod", DECODING_METHOD)
          .put("audioSeconds", audio.samples.size.toDouble() / audio.sampleRate),
      )
    } catch (_: Exception) {
    }
  }

  private fun loadedRecognizer(): OfflineRecognizer {
    idleRelease?.cancel(false)
    idleRelease = null
    recognizer?.let { return it }
    val config = OfflineRecognizerConfig(
      // Bluetooth headsets gate pauses to exact zeros, which skews Parakeet's features enough
      // to drop whole sentences. 3e-5 is Kaldi's default dither on [-1, 1] samples.
      featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80, dither = 0.00003f),
      modelConfig = OfflineModelConfig(
        transducer = OfflineTransducerModelConfig(
          encoder = store.file("encoder.int8.onnx").absolutePath,
          decoder = store.file("decoder.int8.onnx").absolutePath,
          joiner = store.file("joiner.int8.onnx").absolutePath,
        ),
        tokens = store.file("tokens.txt").absolutePath,
        modelType = "nemo_transducer",
        numThreads = 4,
        debug = false,
      ),
      decodingMethod = DECODING_METHOD,
    )
    return OfflineRecognizer(config = config).also { recognizer = it }
  }

  private fun scheduleLiveStep(session: LiveDictation, delayMs: Long) {
    liveStep = inferenceExecutor.schedule({ runLiveStep(session) }, delayMs, TimeUnit.MILLISECONDS)
  }

  /** Commits a finished phrase if there is one, else previews the open phrase. Paces itself to the decode cost. */
  private fun runLiveStep(session: LiveDictation) {
    if (live !== session || !session.capturing) return
    var delay = 150L
    try {
      val model = loadedRecognizer()
      val phrase = session.nextPhrase(false)
      if (phrase != null) {
        commitPhrase(session, model, phrase)
        session.pending = ""
        emitLive(session)
      } else {
        val open = session.openPhrase()
        if (open != null) {
          val startedAt = SystemClock.elapsedRealtime()
          session.pending = continuePhrase(session.committed.lastOrNull(), decodePhrase(model, session.snapshot(open[0], open[1])))
          val took = SystemClock.elapsedRealtime() - startedAt
          session.previews += 1
          session.previewMs += took
          Log.d(LIVE_TAG, "preview ${(open[1] - open[0]) * 1000L / LIVE_SAMPLE_RATE}ms audio in ${took}ms")
          emitLive(session)
          // Never spend more than about half the time decoding previews.
          delay = maxOf(300L, took)
        }
      }
    } catch (error: Throwable) {
      Log.w(LIVE_TAG, "live step failed", error)
    }
    if (live === session && session.capturing) scheduleLiveStep(session, delay)
  }

  private fun commitPhrase(session: LiveDictation, model: OfflineRecognizer, phrase: IntArray) {
    if (!session.hasSpeech(phrase[0], phrase[1])) return
    val startedAt = SystemClock.elapsedRealtime()
    val text = decodePhrase(model, session.snapshot(phrase[0], phrase[1]))
    val took = SystemClock.elapsedRealtime() - startedAt
    session.commits += 1
    session.commitMs += took
    Log.d(LIVE_TAG, "commit ${(phrase[1] - phrase[0]) * 1000L / LIVE_SAMPLE_RATE}ms audio in ${took}ms: $text")
    if (text.isNotEmpty()) session.committed += continuePhrase(session.committed.lastOrNull(), text)
  }

  private fun decodePhrase(model: OfflineRecognizer, samples: FloatArray): String {
    val stream = model.createStream()
    try {
      stream.acceptWaveform(samples, LIVE_SAMPLE_RATE)
      model.decode(stream)
      return model.getResult(stream).text.trim()
    } finally {
      stream.release()
    }
  }

  private fun emitLive(session: LiveDictation) {
    sendEvent(LIVE_EVENT, mapOf("committed" to session.committed.joinToString(" "), "pending" to session.pending))
  }

  private fun discardLive() {
    liveStep?.cancel(false)
    liveStep = null
    val session = live ?: return
    live = null
    session.stop()
    session.wavFile.delete()
    scheduleIdleRelease()
  }

  private fun scheduleIdleRelease() {
    idleRelease?.cancel(false)
    idleRelease = inferenceExecutor.schedule({ releaseRecognizer() }, IDLE_RELEASE_SECONDS, TimeUnit.SECONDS)
  }

  private fun releaseRecognizer() {
    idleRelease?.cancel(false)
    idleRelease = null
    recognizer?.release()
    recognizer = null
  }
}
