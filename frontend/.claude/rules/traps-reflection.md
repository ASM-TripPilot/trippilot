---
paths:
  - "src/features/reflection/**"
  - "src/pages/share-card/**"
  - "src/pages/trip-summary/**"
  - "src/pages/daily-reflection/**"
  - "src/app/trips/[tripId]/records/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **`react-native-view-shot`으로 `KakaoMapView`(WebView) 캡처 불가** → 온디바이스 카드/이미지 캡처에 라이브 지도를 얹으면 캡처 결과에서 지도 부분이 빈다(RN 알려진 한계 — WebView 콘텐츠는 네이티브 스냅샷에 안 잡힌다). j06 공유 카드(TRIP-574)가 이 함정을 **지도 히어로를 애초에 안 넣는 것**으로 회피했다 — 카드는 워터마크·동선 순서 목록·통계로만 조립되고, `captureShareImage()`는 `expo-media-library`/`expo-sharing`/`expo-file-system` 미설치로 `{armed:false}` degrade 스텁이라 아직 실 캡처 자체가 없다(Blocker A 후속). **다음에 캡처 기능을 실체화할 때(view-shot 설치 후) 카드·화면에 `KakaoMapView`를 얹으면 이 함정이 재발한다** — 지도가 필요하면 raster 스냅샷(별도 이미지 API)으로 대체해야 한다. `repo-traps.md`의 "`KakaoMapView`(WebView) 위 absolute 오버레이는 터치를 먹는다"와 같은 WebView 함정 계열(증상은 다르지만 원인 모두 WebView가 RN 네이티브 파이프라인 밖에 있다는 것).
