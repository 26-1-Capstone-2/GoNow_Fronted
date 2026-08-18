package expo.modules.foregroundservice

import android.annotation.TargetApi
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.os.Build
import android.os.IBinder
import android.util.Log

// GPS 위치 구독(FusedLocationProviderClient)과 완전히 무관한 순수 알림 표시/유지 전용
// Foreground Service. expo-location의 LocationTaskService(node_modules/expo-location/android/
// src/main/java/expo/modules/location/services/LocationTaskService.kt)를 참고해서 알림
// 표시/유지 로직만 복제했다 — 위치 콜백을 전혀 참조하지 않는다는 점이 핵심.
class ForegroundAlarmService : Service() {
  override fun onBind(intent: Intent): IBinder? = null

  @TargetApi(26)
  override fun onStartCommand(intent: Intent, flags: Int, startId: Int): Int {
    val title = intent.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val body = intent.getStringExtra(EXTRA_BODY) ?: DEFAULT_BODY
    Log.d(TAG, "onStartCommand — title:$title")

    val notification = buildNotification(title, body)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: SecurityException) {
      // 위치 권한이 없는 상태에서 location 타입 FGS를 시작하면 SecurityException이 던져진다
      // (2026-08-13 신규 설치 기기 실측 — JS 쪽(startAlarmForegroundService)에서 이미 권한을
      // 확인하도록 방어했지만, 혹시 그 확인을 우회하는 경로가 생기더라도 여기서 앱 전체가
      // 죽는 것만은 막는다 — 이 서비스만 조용히 중단).
      Log.e(TAG, "startForeground 실패(위치 권한 없음) — 서비스 중단", e)
      stopSelf()
      return START_NOT_STICKY
    }
    // GPS 구독과 얽혀 있는 LocationTaskService와 달리 이 서비스는 알림 표시 외 기능이 없어서,
    // OS가 재기동시켜도 "이 알림이 아직 유효한지" 재검증할 계기가 없다 — 좀비 알림 위험을
    // 피하기 위해 START_NOT_STICKY를 쓴다. 대신 이 앱은 syncForegroundService()류 재조정
    // 호출(포그라운드 전환, 알람 시작/종료 등)을 여러 지점에서 반복하므로 자연 치유된다.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    Log.d(TAG, "onDestroy")
    stopForeground(true)
    super.onDestroy()
  }

  // "스와이프해도 알람이 있으면 FGS 유지"라는 기존 정책과 일치시키기 위해 onTaskRemoved는
  // 오버라이드하지 않는다(no-op — 기본 동작이 서비스를 안 죽임).

  @TargetApi(26)
  private fun buildNotification(title: String, body: String): Notification {
    prepareChannel()
    val builder = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setSmallIcon(applicationInfo.icon)
      .setColorized(true)
      .setColor(Color.parseColor(NOTIFICATION_COLOR))
      // 안드로이드 13(API 33)부터는 FGS 알림도 기본적으로 스와이프로 지울 수 있게 정책이
      // 바뀌었다 — setOngoing(true)로 12 이하와 동일하게 스와이프 불가 상태를 명시적으로
      // 복원한다. 서비스 자체는 알림을 지워도 안 죽지만(13+부터 알림/서비스 생명주기가
      // 분리됨), "알람이 존재하면 FGS가 항상 보인다"는 이 앱의 설계 의도(CLAUDE.md FGS
      // 정책)와 제조사 배터리 최적화가 상시 알림 없는 백그라운드 프로세스를 더 적극적으로
      // 정리하는 경향을 감안해 명시적으로 켜둔다.
      // 주의: 안드로이드 14(API 34)부터는 구글이 정책을 한 번 더 바꿔서 setOngoing(true)를
      // 걸어도 사용자가 여전히 스와이프로 지울 수 있다(실기기 Android 15/API 35로 검증
      // 완료 — 재설치해도 그대로 지워짐, 앱/OS 버그 아니라 의도된 플랫폼 동작). 12
      // 이하에서만 유효한 방어 코드이고 14+에서는 사실상 no-op이지만, 하위 버전엔 여전히
      // 의미가 있고 14+에서 해가 되지도 않으므로 그대로 둔다 — 14+ 스와이프까지 막는 방법은
      // 현재 안드로이드 표준 알림 API로는 존재하지 않는다.
      .setOngoing(true)

    packageManager.getLaunchIntentForPackage(packageName)?.let {
      it.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
      val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      val contentIntent = PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag)
      builder.setContentIntent(contentIntent)
    }

    return builder.build()
  }

  @TargetApi(26)
  private fun prepareChannel() {
    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (notificationManager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "GoNow 알람", NotificationManager.IMPORTANCE_LOW)
    channel.description = "GoNow 알람이 존재하는 동안 유지되는 상시 알림"
    notificationManager.createNotificationChannel(channel)
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    private const val DEFAULT_TITLE = "GoNow 알람 실행 중"
    private const val DEFAULT_BODY = "출발 시간을 모니터링하고 있어요."
    private const val CHANNEL_ID = "gonow-alarm-fgs"
    private const val NOTIFICATION_ID = 927341
    private const val NOTIFICATION_COLOR = "#4CAF50" // 기존 알림 색상과 통일
    private const val TAG = "ForegroundAlarmService"
  }
}
