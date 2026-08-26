module.exports = {
  expo: {
    name: "gonow",
    slug: "gonow",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/gonow_logo.png",
    scheme: "gonow",
    splash: {
      image: "./assets/images/gonow_logo.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
      dark: {
        image: "./assets/images/gonow_logo.png",
        resizeMode: "contain",
        backgroundColor: "#000000"
      }
    },
    userInterfaceStyle: "light",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSUserNotificationsUsageDescription: "GoNow 알람을 받기 위해 알림 권한이 필요합니다.",
        NSLocationWhenInUseUsageDescription: "위치 정보를 사용해 출발 시간을 알려드려요.",
        NSLocationAlwaysAndWhenInUseUsageDescription: "백그라운드에서도 위치 정보를 사용해 출발 시간을 알려드려요.",
        NSLocationAlwaysUsageDescription: "백그라운드에서도 위치 정보를 사용해 출발 시간을 알려드려요.",
        UIBackgroundModes: ["location", "fetch", "remote-notification"]
      }
    },
    android: {
      package: "com.hyeongwon.gonow",
      googleServicesFile: "./google-services.json",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/gonow_logo.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png"
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: [
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.VIBRATE",
        "android.permission.USE_FULL_SCREEN_INTENT",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.ACCESS_WIFI_STATE"
      ],
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme: "https",
              host: "gonow-api.uk",
              pathPrefix: "/join"
            }
          ],
          category: ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "./plugins/withNotifeeMavenRepo.js",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: "위치 정보를 사용해 출발 시간을 알려드려요.",
          locationAlwaysPermission: "백그라운드에서도 위치 정보를 사용해 출발 시간을 알려드려요.",
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true
        }
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/images/gonow_logo.png",
          imageWidth: 220,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            image: "./assets/images/gonow_logo.png",
            backgroundColor: "#000000"
          }
        }
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/android-icon-monochrome.png",
          color: "#4CAF50",
          sounds: [
            "./assets/sounds/stage1.wav",
            "./assets/sounds/stage2.wav",
            "./assets/sounds/stage3.mp3",
            "./assets/sounds/stage4.mp3",
            "./assets/sounds/arrived.wav"
          ],
          mode: "production"
        }
      ]
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true
    },
    extra: {
      router: {},
      eas: {
        projectId: "f9e1a464-f427-4bb3-ba40-7d6e2382f3f0"
      }
    },
    owner: "gonow-team",
    runtimeVersion: {
      policy: "appVersion"
    },
    updates: {
      url: "https://u.expo.dev/f9e1a464-f427-4bb3-ba40-7d6e2382f3f0",
      requestHeaders: {
        // EXPO_PUBLIC_API_BASE_URL이 설정된(로컬 서버 겨냥) 빌드는 preview와 완전히 분리된
        // local-dev 채널만 구독한다 — eas update 배포 실수가 나도 preview 채널(EC2/팀원 공유)에는
        // 물리적으로 닿지 않는다(2026-08-23, docs/local-vs-ec2-server.md 참고).
        "expo-channel-name": process.env.EXPO_PUBLIC_API_BASE_URL ? "local-dev" : "preview"
      },
      // 로컬 서버 테스트 빌드는 네이티브 자동 OTA 체크 자체를 꺼둔다 — 채널이 분리된 지금은 필수는
      // 아니지만(잘못된 채널을 받아올 일이 없음), 로컬 테스트 도중 의도치 않게 번들이 바뀌는 것
      // 자체를 막기 위해 그대로 유지한다. 이 값이 없는 일반 빌드는 원래 기본 동작(ON_LOAD) 유지.
      checkAutomatically: process.env.EXPO_PUBLIC_API_BASE_URL ? "NEVER" : "ON_LOAD"
    }
  }
};
