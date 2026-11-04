package expo.modules.t3parakeettranscription

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Optional debug capture: keeps each dictation's audio with its transcript and timings.
 * App-specific external storage, so `adb pull` works on non-debuggable builds and
 * uninstalling the app removes everything.
 */
internal class VoiceClipStore(context: Context) {
  private val preferences = context.getSharedPreferences("t3-voice-clips", Context.MODE_PRIVATE)
  private val directory = File(context.getExternalFilesDir(null) ?: context.filesDir, "voice-clips")

  var enabled: Boolean
    get() = preferences.getBoolean("enabled", false)
    set(value) {
      preferences.edit().putBoolean("enabled", value).apply()
    }

  fun state(): Map<String, Any> {
    val files = directory.listFiles().orEmpty()
    return mapOf(
      "enabled" to enabled,
      "count" to files.count { it.extension == "json" },
      "bytes" to files.sumOf { it.length() }.toDouble(),
      "directory" to directory.absolutePath,
    )
  }

  fun save(audioPath: String, details: JSONObject) {
    if (!enabled) return
    directory.mkdirs()
    val now = Date()
    val name = SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss-SSS", Locale.US).format(now)
    val audio = File(audioPath)
    audio.copyTo(File(directory, "$name.${audio.extension}"), overwrite = true)
    details.put("recordedAt", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(now))
    File(directory, "$name.json").writeText(details.toString(2))
  }

  fun deleteAll() {
    directory.deleteRecursively()
  }
}
