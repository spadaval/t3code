package expo.modules.t3voicetranscription

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** One downloadable model file, pinned to a Hugging Face revision and checked by SHA-256. */
internal data class VoiceModelFile(val name: String, val bytes: Long, val sha256: String?)

/**
 * NVIDIA Parakeet TDT 0.6B v3 (25 European languages), int8 ONNX export by sherpa-onnx.
 * Files download one at a time into a staging directory, which is renamed into place
 * only after every file is complete, so an installed model is never partial.
 */
internal object ParakeetV3 {
  const val ID = "parakeet-tdt-0.6b-v3-int8"
  private const val BASE_URL =
    "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78"

  val files = listOf(
    VoiceModelFile(
      "encoder.int8.onnx",
      652_184_281,
      "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
    ),
    VoiceModelFile(
      "decoder.int8.onnx",
      11_845_275,
      "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
    ),
    VoiceModelFile(
      "joiner.int8.onnx",
      6_355_277,
      "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
    ),
    VoiceModelFile("tokens.txt", 93_939, null),
  )

  val totalBytes = files.sumOf { it.bytes }

  fun url(file: VoiceModelFile) = "$BASE_URL/${file.name}"
}

internal class VoiceModelCancelledException : IOException("Voice model download was cancelled.")

internal class VoiceModelStore(filesDir: File) {
  private val root = File(filesDir, "voice-models")
  val modelDir = File(root, ParakeetV3.ID)
  private val stagingDir = File(root, "${ParakeetV3.ID}.partial")

  fun isInstalled(): Boolean = ParakeetV3.files.all { File(modelDir, it.name).isFile }

  fun file(name: String) = File(modelDir, name)

  /** Bytes already on disk, so an interrupted download resumes where it stopped. */
  fun stagedBytes(): Long =
    ParakeetV3.files.sumOf { File(stagingDir, it.name).let { file -> if (file.isFile) file.length() else 0L } }

  /**
   * Downloads the missing files, resuming partial ones with HTTP range requests.
   * [isCancelled] is polled between chunks. Runs on the caller's thread.
   */
  fun download(isCancelled: () -> Boolean, onProgress: (Long) -> Unit) {
    if (isInstalled()) return
    stagingDir.mkdirs()
    var completedBytes = 0L
    for (file in ParakeetV3.files) {
      val target = File(stagingDir, file.name)
      if (!target.isFile || target.length() < file.bytes) {
        downloadFile(file, target, completedBytes, isCancelled, onProgress)
      }
      if (target.length() != file.bytes) {
        target.delete()
        throw IOException("${file.name} has an unexpected size.")
      }
      if (file.sha256 != null && sha256(target) != file.sha256) {
        target.delete()
        throw IOException("${file.name} failed its checksum.")
      }
      completedBytes += file.bytes
      onProgress(completedBytes)
    }
    modelDir.deleteRecursively()
    if (!stagingDir.renameTo(modelDir)) throw IOException("Could not install the voice model.")
  }

  fun delete() {
    modelDir.deleteRecursively()
    stagingDir.deleteRecursively()
  }

  private fun downloadFile(
    file: VoiceModelFile,
    target: File,
    completedBytes: Long,
    isCancelled: () -> Boolean,
    onProgress: (Long) -> Unit,
  ) {
    var offset = if (target.isFile) target.length() else 0L
    val connection = URL(ParakeetV3.url(file)).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      if (offset > 0) connection.setRequestProperty("Range", "bytes=$offset-")
      val status = connection.responseCode
      if (status == HttpURLConnection.HTTP_OK) {
        offset = 0
      } else if (status != HttpURLConnection.HTTP_PARTIAL) {
        throw IOException("Download of ${file.name} failed with HTTP $status.")
      }
      connection.inputStream.use { input ->
        FileOutputStream(target, offset > 0).use { output ->
          val buffer = ByteArray(256 * 1024)
          var written = offset
          var lastReported = 0L
          while (true) {
            if (isCancelled()) throw VoiceModelCancelledException()
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            written += read
            // Report about every 4 MB so progress events stay cheap.
            if (written - lastReported >= 4L * 1024 * 1024) {
              lastReported = written
              onProgress(completedBytes + written)
            }
          }
        }
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(1024 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
