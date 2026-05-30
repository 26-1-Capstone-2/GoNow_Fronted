# GoNow Frontend

GoNow 앱의 프론트엔드 프로젝트입니다.  
이 프로젝트는 Expo 기반으로 개발되었습니다.

## 기술 스택

- React Native (Expo)
- TypeScript
- Expo Router
- Notifee (알림)
- EAS Build

## 실행 방법

1. 의존성을 설치합니다.

```bash
npm install
```

2. 앱을 실행합니다.

```bash
npx expo start
```

## 실행 옵션

앱 실행 후 아래 방법 중 하나를 선택해 확인할 수 있습니다.

- Expo Go 앱으로 QR 코드 스캔
- Android Emulator
- iOS Simulator (Mac 환경)

## APK 빌드

EAS Build를 사용합니다. 빌드 전 `eas-cli`가 설치되어 있어야 합니다.

```bash
npm install -g eas-cli
eas login
```

개발/테스트용 APK 빌드:

```bash
eas build -p android --profile preview
```

빌드 완료 후 EAS 대시보드에서 APK를 다운로드할 수 있습니다.

## 프로젝트 구조

- `app/`: 화면 및 라우팅 (Expo Router 기반)
- `src/api/`: 서버 API 호출
- `src/screens/`: 화면 컴포넌트
- `src/services/`: 알람 서비스 등 비즈니스 로직
- `src/utils/`: 공통 유틸리티 (알림 채널 등)
- `assets/`: 이미지 및 정적 파일

## 주요 기능

- 위치 기반 알람 (출발 시간 계산)
- 다단계 알람 (1~4단계, 긴급도에 따라 진동/소리 강도 조절)
- 방해금지 모드 무시 (긴급 알람)
- 잠금화면 전체화면 알람
- 그룹 알람 및 귀가 알람

## 환경 설정

`google-services.json` 파일이 프로젝트 루트에 있어야 합니다. (Firebase 설정)

## 개발 환경

- Node.js
- Expo
