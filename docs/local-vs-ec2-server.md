# 로컬 스프링 / EC2 스프링 전환 가이드

프론트가 어느 백엔드(로컬 스프링 vs EC2 프로덕션)를 바라볼지는 **딱 하나의 환경변수**로 결정됩니다.

```bash
# 로컬 스프링을 바라보게 하려면 파라미터를 넘긴다
EXPO_PUBLIC_API_BASE_URL=<로컬 주소> npx expo start
EXPO_PUBLIC_API_BASE_URL=<로컬 주소> npx expo run:android
EXPO_PUBLIC_API_BASE_URL=<로컬 주소> npm run android:release   # release APK 빌드(android:release가 --rerun-tasks 포함)

# 아무것도 안 넘기면 EC2(https://gonow-api.uk)가 기본값
npx expo start
npx expo run:android
npm run android:release

# 빌드된 APK를 폰에 설치
npm run android:install
```

관련 코드: `src/api/client.ts`, `src/tasks/backgroundLocationTask.ts`가 각각
`process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://gonow-api.uk'` 로 값을 결정한다.

**`<로컬 주소>` 값은 이 문서를 포함해 어떤 git 추적 파일에도 실제 값을 적지 않는다** — 이 저장소는
Public이라, 로컬 IP든 터널 주소든 커밋되는 순간 노출된다. 필요할 때마다 아래 방법으로 직접 확인해서 쓴다.
- LAN IP로 직접 테스트하는 경우: `ipconfig`(Windows)로 매번 확인 — Wi-Fi가 바뀌면 값도 바뀐다.
- cloudflared named tunnel을 쓰는 경우: `~/.cloudflared/config.yml`의 `hostname` 값 확인.

## `.env.local`을 다시 만들지 않는다

예전엔 `.env.local`에 `EXPO_PUBLIC_API_BASE_URL`을 넣어두고 자동으로 로컬을 바라보게 했었는데,
이 방식은 폐기했다. `.env.local`은 **빌드 방식과 무관하게 항상 자동으로 로드**되기 때문에,
"로컬 테스트용으로 켜뒀다가 깜빡 잊고 EC2용 release/preview 빌드를 만드는" 사고가 실제로 발생했다
(2026-08-23). 지금부터는 위처럼 필요할 때만 명령어 앞에 직접 붙이는 방식만 쓴다.

## release 빌드를 다시 만들 때 캐시 주의

`EXPO_PUBLIC_API_BASE_URL` 값만 바꿔서(소스 코드 변경 없이) release APK를 다시 빌드하면,
Gradle이 "달라진 입력이 없다"고 판단해 JS 번들을 재생성하지 않고 이전 빌드의 번들을 그대로
재사용할 수 있다(`.env` 계열 파일은 Gradle이 추적하는 입력이 아니라서). 그러면 새로 빌드했는데도
예전 서버를 계속 가리키는 것처럼 보인다.

```bash
# O — npm run android:release가 이미 --rerun-tasks를 포함하고 있어 항상 안전하다
npm run android:release

# X — clean은 쓰지 않는다. 네이티브 C++(CMake/ninja) 빌드 캐시가 깨져서 별도 에러가 난다
./gradlew clean assembleRelease
```

Metro(`expo start`)는 매번 새로 번들링하므로 이 문제가 없다. `npm run android:release`를
preview용/local-dev용으로 번갈아 실행해도(파라미터만 바꿔서) 매번 `--rerun-tasks`가 강제되므로
캐시가 꼬여서 예전 서버를 계속 가리키는 일은 이제 구조적으로 없다.

## OTA 채널을 preview / local-dev로 완전히 분리했다 (2026-08-23)

`app.config.js`의 `updates.requestHeaders["expo-channel-name"]`이 `EXPO_PUBLIC_API_BASE_URL`
유무에 따라 자동으로 `preview`(EC2, 팀 공유) 또는 `local-dev`(로컬 전용)로 갈린다. 즉 로컬
서버를 겨냥해서 빌드한 앱은 애초에 `preview` 채널을 쳐다보지도 않는다 — 실수로 로컬 값이 박힌
번들을 배포해도 팀원/EC2 테스터의 폰에는 물리적으로 닿을 수 없다.

`eas.json`에도 `local` 빌드 프로필(채널 `local-dev`)을 추가해뒀다 — 지금은 EAS 클라우드
빌드 할당량이 없어서(2026-09-01 리셋) 못 쓰지만, 나중에 `eas build --profile local`로 로컬
겨냥 빌드를 만들 때 그대로 쓸 수 있다(이때도 `EXPO_PUBLIC_API_BASE_URL=<로컬 주소> eas build
--profile local`처럼 직접 붙여서 실행 — eas.json 자체엔 로컬 값을 넣지 않는다).

## `eas update`(OTA) 배포는 스크립트로 브랜치를 자동 선택한다

`eas update`를 직접 치지 말고 아래로 실행한다 — 현재 셸의 `EXPO_PUBLIC_API_BASE_URL` 유무를
보고 `preview`/`local-dev` 브랜치를 자동으로 골라서 배포 직전에 화면에 보여준다
(`scripts/publish-update.js`).

```bash
npm run update:publish -- "커밋 메시지"
```

채널이 분리되어 있어도 **이 브랜치 이름을 사람이 직접 고르는 방식(`eas update --branch preview`를
손으로 타이핑)은 여전히 실수 여지가 있다** — 로컬 값 켜둔 채로 습관적으로 `--branch preview`를
치면 채널 분리와 무관하게 똑같이 사고 난다. 그래서 브랜치 선택 자체를 스크립트가 대신하게
만들어서 이 여지를 없앴다.

### 그래도 한번 오염되면 자동으로 못 고친다 (채널 분리 전 히스토리, 참고용)

`app/_layout.tsx`의 `checkAndApplyUpdate()`는 **지금 실행 중인 번들 자신에게
`EXPO_PUBLIC_API_BASE_URL`이 박혀있으면 업데이트 체크 자체를 스킵**하도록 되어 있다. 채널을
분리하기 전(2026-08-23 이전)에는 이 보호가 "이미 로컬 번들을 실행 중인 폰"에만 적용되고
`preview` 채널 자체가 오염되는 것도, 그 순간 아직 정상 번들을 실행 중이던 다른 폰이 오염된
채널을 그대로 받아버리는 것도 막아주지 못해서 실제로 사고가 났었다(정상 EC2 번들이 깔린 폰이
오염된 preview 채널을 순진하게 받아버림). 채널을 분리한 지금은 애초에 겹칠 채널이 없어져서
이 시나리오 자체가 구조적으로 막혔지만, 혹시라도 같은 채널 안에서 오염이 발생하면 여전히
재배포로는 못 고치고 **앱을 완전히 삭제하고 새 APK를 재설치**해야 한다(저장공간/데이터
지우기만으로는 안 지워지는 경우가 있었음 — 반드시 삭제 후 재설치).

## 서버를 바꿔서 테스트할 때 로그인은?

토큰은 서버별로 다르게 발급되므로(로컬 스프링 토큰은 EC2에서 무효, 반대도 마찬가지), 서버를
전환한 뒤에는 다시 로그인해야 한다. `app/index.tsx`가 앱 시작 시 저장된 토큰이 지금 서버 기준으로
유효한지 자동으로 검증하도록 되어 있어서(2026-08-23 추가), 유효하지 않은 토큰이 남아있어도 앱이
자동으로 로그인 화면으로 돌려보낸다 — 수동으로 앱 데이터를 지울 필요는 없다.
