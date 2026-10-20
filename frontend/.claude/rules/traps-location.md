---
paths:
  - "src/shared/location/**"
  - "src/__tests__/locationAutomationBuildConfig.test.ts"
  - "app.config.ts"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## U10 위치 자동화 빌드 설정

- **`src/__tests__/locationAutomationBuildConfig.test.ts`의 OFF3는 로컬 `frontend/ios/`가 플래그 ON으로 prebuild된 것이면 red다(CI·새 클론은 `ios/`가 없어 green)** → `expo config --type introspect`가 디스크의 `ios/Info.plist`를 바탕으로 해석하므로, `TRIPPILOT_LOCATION_AUTOMATION=1 expo prebuild -p ios`가 남긴 `UIBackgroundModes=[location]`이 OFF 해석에도 샌다(`Received: ["location"]`). 코드를 파기 전에 `ls ios`부터 보고, `ios/`를 옆으로 옮겨 재실행해 7/7이면 환경 원인이다(지우지 말고 옮겨 되돌린다). 변경 집합과 접점 없는 node 버킷 단일 red는 이 원인을 먼저 의심한다(실측 1건, TRIP-1474 04 n=1).
