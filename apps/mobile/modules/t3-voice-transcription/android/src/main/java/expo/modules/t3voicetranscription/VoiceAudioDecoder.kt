package expo.modules.t3voicetranscription

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.IOException
import java.nio.ByteOrder

internal class DecodedAudio(val samples: FloatArray, val sampleRate: Int)

/**
 * Decodes a recording (expo-audio writes AAC in an MP4 container on Android) to mono
 * float PCM at its native rate. sherpa-onnx resamples to the model's 16 kHz itself.
 */
internal fun decodeAudio(path: String): DecodedAudio {
  val extractor = MediaExtractor()
  try {
    extractor.setDataSource(path)
    val track = (0 until extractor.trackCount).firstOrNull {
      extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
    } ?: throw IOException("The recording has no audio track.")
    extractor.selectTrack(track)
    val inputFormat = extractor.getTrackFormat(track)
    val codec = MediaCodec.createDecoderByType(inputFormat.getString(MediaFormat.KEY_MIME)!!)
    try {
      codec.configure(inputFormat, null, null, 0)
      codec.start()
      return drain(extractor, codec, inputFormat)
    } finally {
      codec.release()
    }
  } finally {
    extractor.release()
  }
}

private fun drain(extractor: MediaExtractor, codec: MediaCodec, inputFormat: MediaFormat): DecodedAudio {
  var sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
  var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
  var pcmFloat = false
  var output = FloatArray(sampleRate * 30)
  var length = 0
  val info = MediaCodec.BufferInfo()
  var inputDone = false
  while (true) {
    // Keep the codec's input queue full and only block on output when it is, so frames
    // decode back to back instead of one codec round trip per frame.
    var queued = false
    if (!inputDone) {
      val inputIndex = codec.dequeueInputBuffer(0)
      if (inputIndex >= 0) {
        queued = true
        val buffer = codec.getInputBuffer(inputIndex)!!
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) {
          codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
          inputDone = true
        } else {
          codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
          extractor.advance()
        }
      }
    }
    val outputIndex = codec.dequeueOutputBuffer(info, if (queued) 0 else 10_000)
    if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
      val format = codec.outputFormat
      sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      pcmFloat = format.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
        format.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
    } else if (outputIndex >= 0) {
      val buffer = codec.getOutputBuffer(outputIndex)!!.order(ByteOrder.nativeOrder())
      buffer.position(info.offset)
      buffer.limit(info.offset + info.size)
      val frames = info.size / ((if (pcmFloat) 4 else 2) * channels)
      if (length + frames > output.size) output = output.copyOf(maxOf(output.size * 2, length + frames))
      // Downmix by averaging channels.
      if (pcmFloat) {
        val floats = buffer.asFloatBuffer()
        for (frame in 0 until frames) {
          var sum = 0f
          for (channel in 0 until channels) sum += floats.get()
          output[length++] = sum / channels
        }
      } else {
        val shorts = buffer.asShortBuffer()
        for (frame in 0 until frames) {
          var sum = 0f
          for (channel in 0 until channels) sum += shorts.get()
          output[length++] = sum / (channels * 32768f)
        }
      }
      codec.releaseOutputBuffer(outputIndex, false)
      if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
    }
  }
  return DecodedAudio(output.copyOf(length), sampleRate)
}

/**
 * Splits long audio into pieces of at most [maxSeconds], cutting at the quietest
 * 50 ms window in each piece's last third so words are rarely split. Parakeet's
 * attention memory grows with the square of the input length, so a five minute
 * recording in one pass would exhaust a phone's memory.
 */
internal fun splitAtPauses(audio: DecodedAudio, maxSeconds: Int = 30): List<FloatArray> {
  val samples = audio.samples
  val maxLength = audio.sampleRate * maxSeconds
  if (samples.size <= maxLength) return listOf(samples)
  val window = audio.sampleRate / 20
  val pieces = mutableListOf<FloatArray>()
  var start = 0
  while (samples.size - start > maxLength) {
    var cut = start + maxLength
    var quietest = Float.MAX_VALUE
    var position = start + maxLength * 2 / 3
    while (position + window <= start + maxLength) {
      var energy = 0f
      for (index in position until position + window) energy += samples[index] * samples[index]
      if (energy < quietest) {
        quietest = energy
        cut = position + window / 2
      }
      position += window
    }
    pieces += samples.copyOfRange(start, cut)
    start = cut
  }
  pieces += samples.copyOfRange(start, samples.size)
  return pieces
}
