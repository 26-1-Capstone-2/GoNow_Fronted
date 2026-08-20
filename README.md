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

> ⚠️ 이 프로젝트는 `@notifee`, 백그라운드 위치 추적 등 커스텀 네이티브 모듈을 사용합니다.  
> **Expo Go로는 실행할 수 없습니다.** 반드시 아래 빌드 방식을 사용하세요.

### 1단계: 의존성 설치

```bash
npm install
```

### 2단계: EAS CLI 설치 및 로그인

```bash
npm install -g eas-cli
eas login
```

## 개발 중 코드 변경 반영 (Development 빌드)

코드를 수정하면서 즉시 반영되는 핫리로드 환경입니다.

**최초 1회: Development APK 빌드 후 기기에 설치**

```bash
eas build --platform android --profile development
```

**이후 매번: Metro 서버 실행 → 기기에서 자동 연결**

```bash
npx expo start
```

## 테스트용 APK 빌드 (Preview 빌드)

코드가 번들에 고정된 APK입니다. 코드 변경 시 재빌드가 필요합니다.

```bash
eas build --platform android --profile preview
```

빌드 완료 후 EAS 대시보드에서 APK를 다운로드할 수 있습니다.

## 프로젝트 구조

- `app/`: 화면 및 라우팅 (Expo Router 기반)
- `src/api/`: 서버 API 호출
- `src/screens/`: 화면 컴포넌트
- `src/services/`: 알람 서비스 등 비즈니스 로직
- `src/tasks/`: 백그라운드 위치추적/지오펜스 헤드리스 태스크
- `src/utils/`: 공통 유틸리티 (알림 채널 등)
- `assets/`: 이미지 및 정적 파일

문서(해결된 버그 히스토리 등)는 백엔드 저장소(`gonow`)의 `docs/`에서 통합 관리합니다.

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
