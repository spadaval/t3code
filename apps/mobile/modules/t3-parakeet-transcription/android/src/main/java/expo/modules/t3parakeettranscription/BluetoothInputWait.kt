package expo.modules.t3parakeettranscription

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper

// Android reports the link 700-900 ms after the request, a few hundred ms before audio arrives.
private const val SETTLE_MS = 400L
private const val TIMEOUT_MS = 2500L
private const val BEEP_MS = 120

/**
 * Waits for the Bluetooth call link to carry audio, then beeps through it and reports back
 * once the beep has finished, so recording starts live and without the beep in the audio.
 */
internal class BluetoothInputWait(private val context: Context) {
  private val handler = Handler(Looper.getMainLooper())
  private val audioManager = context.getSystemService(AudioManager::class.java)
  private var onDone: ((Boolean) -> Unit)? = null
  private var listener: Any? = null
  private val cue = Runnable { playCue() }
  private val complete = Runnable { finish(true) }

  fun start(done: (Boolean) -> Unit) {
    handler.post {
      finish(false)
      onDone = done
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && isBluetooth(audioManager.communicationDevice)) {
        handler.postDelayed(cue, SETTLE_MS)
        return@post
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val changed = AudioManager.OnCommunicationDeviceChangedListener { device ->
          if (isBluetooth(device)) {
            handler.removeCallbacks(cue)
            handler.postDelayed(cue, SETTLE_MS)
          }
        }
        audioManager.addOnCommunicationDeviceChangedListener(context.mainExecutor, changed)
        listener = changed
      }
      handler.postDelayed(cue, TIMEOUT_MS)
    }
  }

  fun cancel() {
    handler.post { finish(false) }
  }

  private fun playCue() {
    removeListener()
    try {
      val tone = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 80)
      tone.startTone(ToneGenerator.TONE_PROP_BEEP, BEEP_MS)
      handler.postDelayed({ tone.release() }, BEEP_MS + 200L)
    } catch (_: RuntimeException) {
      // A missing beep must not stop the recording.
    }
    handler.postDelayed(complete, BEEP_MS + 60L)
  }

  private fun finish(ready: Boolean) {
    handler.removeCallbacks(cue)
    handler.removeCallbacks(complete)
    removeListener()
    onDone?.invoke(ready)
    onDone = null
  }

  private fun isBluetooth(device: AudioDeviceInfo?) =
    device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || device?.type == AudioDeviceInfo.TYPE_BLE_HEADSET

  private fun removeListener() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (listener as? AudioManager.OnCommunicationDeviceChangedListener)?.let {
        audioManager.removeOnCommunicationDeviceChangedListener(it)
      }
    }
    listener = null
  }
}
