const { withProjectBuildGradle } = require('@expo/config-plugins');

// @notifee/react-native는 안드로이드 네이티브 아티팩트(app.notifee:core)를
// node_modules/@notifee/react-native/android/libs 안에 로컬 flat-file maven 저장소
// 형태로 번들링해서 배포한다(공용 Maven 저장소에는 존재하지 않음, 별도 config plugin도
// 제공하지 않음). 이 저장소를 루트 build.gradle의 repositories에 등록해줘야 Gradle이
// app.notifee:core 의존성을 resolve할 수 있다 — 안 하면 "Could not find any matches for
// app.notifee:core:+" 에러로 빌드 실패. android/는 커밋 안 하고 매번 prebuild로 재생성되는
// 프로젝트라 이 등록을 config plugin으로 만들어 app.json에 연결해야 매번 자동 반영된다.
module.exports = function withNotifeeMavenRepo(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('withNotifeeMavenRepo: build.gradle이 groovy 형식이 아닙니다.');
    }
    const repoLine = 'maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }';
    if (!config.modResults.contents.includes(repoLine)) {
      config.modResults.contents = config.modResults.contents.replace(
        /allprojects\s*{\s*repositories\s*{/,
        (match) => `${match}\n    ${repoLine}`
      );
    }
    return config;
  });
};
