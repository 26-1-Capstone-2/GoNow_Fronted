package expo.modules.wifiscanstatus

import android.content.Context
import android.net.wifi.WifiManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WifiScanStatusModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WifiScanStatus")

    // isScanAlwaysAvailable은 대체 API 없이 deprecated 표시만 된 상태(공식 문서 기준
    // 여전히 유효하게 동작) — 경고만 억제.
    @Suppress("DEPRECATION")
    Function("isScanAlwaysAvailable") {
      val context = appContext.reactContext ?: return@Function false
      val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        ?: return@Function false
      wifiManager.isScanAlwaysAvailable
    }
  }
}
