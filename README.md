# GoNow

GoNow는 목적지와 도착 희망 시각만 입력하면 실시간 이동 상황을 반영해 "지금 몇 시에 출발해야 하는지"를 자동으로 계산해주는 위치 기반 스마트 알람 서비스입니다. 개인 일정뿐 아니라 그룹 약속, 막차 기준 귀가까지 하나의 앱에서 관리할 수 있습니다.

이 저장소는 GoNow의 **React Native(Expo) 프론트엔드**이자, 프로젝트 전체를 대표하는 저장소입니다.

## 관련 저장소

GoNow는 3개의 저장소로 구성되어 있습니다.

| 저장소 | 역할 |
| --- | --- |
| **GoNow_Fronted** (현재 저장소) | 모바일 앱 (React Native / Expo) |
| [gonow-spring](https://github.com/26-1-Capstone-2/gonow-spring) | 백엔드 REST API 서버 (Spring Boot) — DB 저장, 인증, 상태 관리 |
| [CounterClockEngine2](https://github.com/26-1-Capstone-2/CounterClockEngine2) | 계산 서버 (Flask) — 지도 API 호출 및 ETA/출발 알람 시각 계산 |

세 서버는 `앱 → Spring(저장) → Flask(계산) → Spring(결과 저장) → 앱` 순서로 통신합니다. 좌표 계산이 필요한 요청은 항상 Spring이 Flask를 중계하며, 앱은 Flask와 직접 통신하지 않습니다.

## 주요 기능

- **위치 기반 스마트 알람**: 실시간 이동 상황을 반영해 출발 시각을 자동 계산
- **다단계 알람**: 여유 → 주의 → 위험 → 임계 4단계로 긴급도에 따라 소리/진동 강도 조절
- **잠금화면 전체화면 알람**: 임계 단계는 잠금화면 위에도 전체화면으로 표시
- **알람 3종 통합**: 개인 / 그룹 / 귀가(막차·데드라인) 알람을 하나의 앱에서 관리
- **그룹 도착 현황 공유**: 그룹원의 도착 예정/완료 시각을 실시간 공유
- **카카오맵 길찾기 연동**: 푸시 알림과 알람 카드에서 원탭으로 경로 안내 실행
- **캘린더**: 개인/그룹/귀가 알람을 월별 캘린더에서 색상으로 구분해 확인
- **적응형 GPS 폴링**: 상황(지오펜스/폴링)에 따라 위치 확인 빈도를 조절해 배터리 소모 최소화

## 시작하기

> ⚠️ 이 프로젝트는 `@notifee`, 백그라운드 위치 추적 등 커스텀 네이티브 모듈을 사용합니다.
> **Expo Go로는 실행할 수 없습니다.** 반드시 아래 빌드 방식을 사용하세요.

### 사전 준비

- Node.js
- EAS CLI (`npm install -g eas-cli` 후 `eas login`)
- Firebase 설정 파일 `google-services.json` (프로젝트 루트에 위치)

### 설치

```bash
npm install
```

`postinstall`로 `patch-package`가 자동 실행되어 `patches/` 폴더의 네이티브 모듈 패치가 적용됩니다.

### 환경 변수

기본값은 EC2 프로덕션 서버(`https://gonow-api.uk`)를 바라봅니다. 로컬 백엔드 서버로 테스트하려면 `.env`에 아래 값을 설정하세요.

| 변수 | 설명 |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | 로컬 개발 서버 주소. 비워두면 프로덕션 서버를 사용 |

### 개발 (Development 빌드 — 핫리로드)

```bash
# 최초 1회: Development APK 빌드 후 기기에 설치
eas build --platform android --profile development

# 이후 매번: Metro 서버 실행 → 기기에서 자동 연결
npx expo start
```

### 테스트용 APK 빌드 (Preview 빌드)

```bash
eas build --platform android --profile preview
```

빌드 완료 후 EAS 대시보드에서 APK를 다운로드할 수 있습니다. 로컬 환경에서 직접 빌드하려면 `npm run android:release`(Gradle `assembleRelease`)로도 가능하며, 결과물은 `npm run android:install`로 USB 연결된 기기에 바로 설치할 수 있습니다.

### OTA 업데이트 배포

```bash
npm run update:publish -- "업데이트 메시지"
```

네이티브 변경 없이 JS 번들만 수정했을 때, 이미 설치된 앱에 즉시 반영합니다.

## 주요 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm start` | Expo 개발 서버 실행 |
| `npm run android` | Android 네이티브 빌드 후 실행 |
| `npm run lint` | ESLint 검사 |
| `npm run android:release` | 로컬에서 Android 릴리즈 APK 빌드 |
| `npm run android:install` | 빌드된 APK를 USB 연결 기기에 설치 |
| `npm run update:publish` | EAS Update로 OTA 배포 |

## 프로젝트 구조

```
app/            화면 및 라우팅 (Expo Router 기반)
src/
  api/          서버 API 호출
  screens/      화면 컴포넌트
  services/     알람 서비스 등 비즈니스 로직
  tasks/        백그라운드 위치추적/지오펜스 헤드리스 태스크
  utils/        공통 유틸리티 (알림 채널 등)
  store/        Zustand 전역 상태
modules/        커스텀 네이티브 모듈 (포그라운드 서비스, 배터리 최적화 확인 등)
assets/         이미지 및 정적 파일
```

## 기술 스택

- **언어/프레임워크**: TypeScript, React Native 0.81, Expo SDK 54 (Expo Router)
- **상태 관리**: Zustand
- **위치/백그라운드**: expo-location, expo-task-manager, 커스텀 네이티브 모듈(`modules/`)
- **알림**: Notifee, expo-notifications, Firebase Cloud Messaging
- **UI**: @gorhom/bottom-sheet, react-native-calendars, react-native-reanimated
- **저장소**: expo-secure-store(Refresh Token), AsyncStorage
- **배포**: EAS Build / EAS Update
