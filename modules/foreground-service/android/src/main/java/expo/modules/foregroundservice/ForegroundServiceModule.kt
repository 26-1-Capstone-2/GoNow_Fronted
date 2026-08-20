package expo.modules.foregroundservice

import android.content.Intent
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TAG = "ForegroundServiceModule"

class ForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForegroundService")

    Function("start") { title: String, body: String ->
      val context = appContext.reactContext ?: return@Function
      Log.d(TAG, "start() 호출")
      val intent = Intent(context, ForegroundAlarmService::class.java).apply {
        putExtra(ForegroundAlarmService.EXTRA_TITLE, title)
        putExtra(ForegroundAlarmService.EXTRA_BODY, body)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    Function("stop") {
      // Function("stop") { ... }는 인자 없는 오버로드(body: () -> Any?, 제네릭 아님)라서,
      // 값 없는 return@Function은 Unit으로 해석돼 Any?와 타입이 안 맞는다 — Unit을 명시.
      val context = appContext.reactContext ?: return@Function Unit
      Log.d(TAG, "stop() 호출")
      context.stopService(Intent(context, ForegroundAlarmService::class.java))
    }
  }
}
