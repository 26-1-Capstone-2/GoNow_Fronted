package expo.modules.batteryoptimization

import android.content.Context
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BatteryOptimizationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BatteryOptimization")

    Function("isIgnoringBatteryOptimizations") {
      // 배터리 최적화 자체가 Android 6.0(API 23)에 도입된 개념 — 그 이전 기기에는
      // 이 메서드가 존재하지 않아 호출 시 크래시 위험이 있음. 제약이 없는 상태이므로
      // "이미 예외 대상"이라는 뜻으로 true 반환.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function true

      val context = appContext.reactContext ?: return@Function false
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        ?: return@Function false
      powerManager.isIgnoringBatteryOptimizations(context.packageName)
    }
  }
}
