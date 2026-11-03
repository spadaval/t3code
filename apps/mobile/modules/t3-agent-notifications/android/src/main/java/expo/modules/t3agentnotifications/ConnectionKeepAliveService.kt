package expo.modules.t3agentnotifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the app in the foreground-service state so Android does not block its
 * network and destroy the environment sockets a few seconds after it leaves the
 * screen. The ongoing notification doubles as a glance at thread activity.
 */
class ConnectionKeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      setEnabled(this, false)
      return START_NOT_STICKY
    }
    val notification = notification(
      this,
      intent?.getStringExtra(EXTRA_TITLE) ?: "T3 Code",
      intent?.getStringExtra(EXTRA_TEXT) ?: ""
    )
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    running = true
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL_ID = "t3-connection"
    private const val NOTIFICATION_ID = 0x7433
    private const val ACTION_STOP = "expo.modules.t3agentnotifications.CONNECTION_KEEP_ALIVE_STOP"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"
    private const val PREFS = "t3-connection-keep-alive"
    private const val KEY_ENABLED = "enabled"

    @Volatile private var running = false

    fun isEnabled(context: Context): Boolean =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean(KEY_ENABLED, enabled).apply()
      if (!enabled) stop(context)
    }

    /** Starts the service or updates its notification. False when disabled or not allowed now. */
    fun show(context: Context, title: String, text: String): Boolean {
      if (!isEnabled(context)) return false
      if (running) {
        context.getSystemService(NotificationManager::class.java)
          ?.notify(NOTIFICATION_ID, notification(context, title, text))
        return true
      }
      val intent = Intent(context, ConnectionKeepAliveService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_TEXT, text)
      // Android refuses to start a foreground service from the background; the
      // app retries on its next return to the foreground.
      return try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (_: IllegalStateException) {
        false
      }
    }

    fun stop(context: Context) {
      running = false
      context.stopService(Intent(context, ConnectionKeepAliveService::class.java))
    }

    private fun notification(context: Context, title: String, text: String): Notification {
      val manager = context.getSystemService(NotificationManager::class.java)
      manager?.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Connection", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Keeps environments connected and shows what your threads are doing."
          setShowBadge(false)
        }
      )
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        PendingIntent.getActivity(
          context,
          NOTIFICATION_ID,
          it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      }
      val stop = PendingIntent.getService(
        context,
        NOTIFICATION_ID,
        Intent(context, ConnectionKeepAliveService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val icon = context.resources.getIdentifier(
        "notification_icon",
        "drawable",
        context.packageName
      )
      return NotificationCompat.Builder(context, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setSmallIcon(if (icon != 0) icon else android.R.drawable.ic_dialog_info)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setShowWhen(false)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(open)
        .addAction(0, "Turn off", stop)
        .build()
    }
  }
}
