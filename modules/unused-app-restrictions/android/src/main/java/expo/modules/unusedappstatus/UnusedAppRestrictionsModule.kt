package expo.modules.unusedappstatus

import android.content.Intent
import androidx.core.content.IntentCompat
import androidx.core.content.PackageManagerCompat
import androidx.core.content.UnusedAppRestrictionsConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class UnusedAppRestrictionsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("UnusedAppRestrictions")

    // "사용하지 않는 앱 권한 삭제"가 이 앱에 적용 중인지 확인. API_30/API_30_BACKPORT/API_31
    // 셋 다 "제한 적용 중"을 의미(OS 버전·Play 서비스 백포트 여부에 따라 갈릴 뿐 의미는 같음).
    // FEATURE_NOT_AVAILABLE/ERROR는 이 기능 자체가 없는 기기 — 제약 없음으로 간주.
    AsyncFunction("isRestrictionEnabled") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      val status = PackageManagerCompat.getUnusedAppRestrictionsStatus(context).get()
      status == UnusedAppRestrictionsConstants.API_30_BACKPORT ||
        status == UnusedAppRestrictionsConstants.API_30 ||
        status == UnusedAppRestrictionsConstants.API_31
    }

    // "사용하지 않는 앱 관리" 화면(gonow 전용, 전체 목록에서 안 찾아도 바로 이동)으로 진입.
    // 배터리 최적화 예외 요청 인텐트와 달리 이 인텐트는 별도 매니페스트 권한이 필요 없고
    // 구글이 공식적으로 안내하는 패턴이라 스토어 심사 리스크도 없음.
    Function("openSettings") {
      // 인자 없는 Function 오버로드는 () -> Any? 타입이라, 값 없는 return@Function은
      // Unit으로 해석돼 타입이 안 맞는다 — Unit을 명시(foreground-service 모듈과 동일 패턴).
      val context = appContext.reactContext ?: return@Function Unit
      val intent = IntentCompat.createManageUnusedAppRestrictionsIntent(context, context.packageName)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }
}
