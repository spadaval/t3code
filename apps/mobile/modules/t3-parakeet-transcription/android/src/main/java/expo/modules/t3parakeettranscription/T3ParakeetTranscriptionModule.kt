package expo.modules.t3parakeettranscription

import android.net.Uri
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
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private const val STATE_EVENT = "onModelStateChange"
// The loaded model holds about 1 GB, which makes the app an early target for
// Android's low-memory killer. Release it once dictation has been idle a while.
private const val IDLE_RELEASE_SECONDS = 120L
private const val DECODING_METHOD = "greedy_search"

class T3ParakeetTranscriptionModule : Module() {
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

  override fun definition() = ModuleDefinition {
    Name("T3ParakeetTranscription")
    Events(STATE_EVENT)

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
          val clip = if (transcriptionCancelled.get()) null else saveClip(
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
          promise.resolve(mapOf("text" to text.toString(), "clip" to clip))
        } catch (error: Throwable) {
          scheduleIdleRelease()
          promise.reject(CodedException("TranscriptionFailed", error.message ?: "Transcription failed.", error))
        }
      }
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

    Function("setClipCompareEnabled") { enabled: Boolean ->
      clips.compareEnabled = enabled
      clips.state()
    }

    AsyncFunction("annotateClip") { clipAudioPath: String, key: String, detailsJson: String ->
      try {
        clips.annotate(clipAudioPath, key, JSONObject(detailsJson))
      } catch (_: Exception) {
        // Debug capture must never fail a dictation.
      }
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
      inferenceExecutor.execute { releaseRecognizer() }
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
  private fun saveClip(path: String, audio: DecodedAudio, transcript: String, details: JSONObject): String? {
    return try {
      clips.save(
        path,
        details
          .put("transcript", transcript)
          .put("model", ParakeetModel.ID)
          .put("decodingMethod", DECODING_METHOD)
          .put("audioSeconds", audio.samples.size.toDouble() / audio.sampleRate),
      )
    } catch (_: Exception) {
      null
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
