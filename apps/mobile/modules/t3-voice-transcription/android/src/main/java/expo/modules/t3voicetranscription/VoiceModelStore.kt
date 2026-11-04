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
 * NVIDIA Parakeet Unified EN 0.6B (English only), int8 non-streaming ONNX export by sherpa-onnx.
 * Files download one at a time into a staging directory, which is renamed into place
 * only after every file is complete, so an installed model is never partial.
 */
internal object ParakeetModel {
  const val ID = "parakeet-unified-en-0.6b-int8"
  private const val BASE_URL =
    "https://huggingface.co/csukuangfj2/sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming/resolve/8c3a10fb13408c7a7054f6898958bf1c64a8d6c7"

  val files = listOf(
    VoiceModelFile(
      "encoder.int8.onnx",
      654_040_552,
      "6716910b7a0833997fec7a410494c995d70124001a0e9b66d6370d6aced577e0",
    ),
    VoiceModelFile(
      "decoder.int8.onnx",
      7_257_753,
      "a5e223392c90e75f8144cdb5eb95af7625db389e39edef2bd1a9c872b3298fe6",
    ),
    VoiceModelFile(
      "joiner.int8.onnx",
      1_735_860,
      "869f43f7d24595c55581ad3bf249a935fb8a71389fbdaa7504b9f46f93140f8a",
    ),
    VoiceModelFile(
      "tokens.txt",
      8_952,
      "dc0b4584ab2e4ddbf888425c076c61b736e7356a015250db7d307e6f1a8188ff",
    ),
  )

  val totalBytes = files.sumOf { it.bytes }

  fun url(file: VoiceModelFile) = "$BASE_URL/${file.name}"
}

internal class VoiceModelCancelledException : IOException("Voice model download was cancelled.")

internal class VoiceModelStore(filesDir: File) {
  private val root = File(filesDir, "voice-models")
  val modelDir = File(root, ParakeetModel.ID)
  private val stagingDir = File(root, "${ParakeetModel.ID}.partial")

  fun isInstalled(): Boolean = ParakeetModel.files.all { File(modelDir, it.name).isFile }

  fun file(name: String) = File(modelDir, name)

  /** Bytes already on disk, so an interrupted download resumes where it stopped. */
  fun stagedBytes(): Long =
    ParakeetModel.files.sumOf { File(stagingDir, it.name).let { file -> if (file.isFile) file.length() else 0L } }

  /**
   * Downloads the missing files, resuming partial ones with HTTP range requests.
   * [isCancelled] is polled between chunks. Runs on the caller's thread.
   */
  fun download(isCancelled: () -> Boolean, onProgress: (Long) -> Unit) {
    if (isInstalled()) return
    stagingDir.mkdirs()
    var completedBytes = 0L
    for (file in ParakeetModel.files) {
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
    deleteRetiredModels()
  }

  fun delete() {
    modelDir.deleteRecursively()
    stagingDir.deleteRecursively()
    deleteRetiredModels()
  }

  /** Earlier models (Parakeet TDT v3 is ~650 MB) are dropped once a replacement is installed. */
  private fun deleteRetiredModels() {
    root.listFiles()?.filter { it != modelDir && it != stagingDir }?.forEach { it.deleteRecursively() }
  }

  private fun downloadFile(
    file: VoiceModelFile,
    target: File,
    completedBytes: Long,
    isCancelled: () -> Boolean,
    onProgress: (Long) -> Unit,
  ) {
    var offset = if (target.isFile) target.length() else 0L
    val connection = URL(ParakeetModel.url(file)).openConnection() as HttpURLConnection
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
