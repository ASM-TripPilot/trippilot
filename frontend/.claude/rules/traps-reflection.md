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
- **INV-3 소스 스캔 가드(`reflectionStructure.test.ts` G6·`reflectionSummaryStructure.test.ts` AC-4)는 리터럴 문자열만 보고 값 인터폴레이션은 못 본다** → `DURATION_TEXT=/(소요|\d+\s*분|\d+\s*시간)/`는 소스 텍스트를 정규식으로 훑는 도구라, `{value}{unit}`처럼 숫자·단위를 변수로 이어붙인 렌더는 소스에 리터럴 `\d+분`이 없어 **미매치**한다. j05(TRIP-573)의 `StatTile`이 이 성질을 이용해 BR-U5-08a가 허용하는 "평균 체류 72분"을 화이트리스트 추가 없이 통과시켰다(실검증 완료 — 정당한 예외, 위반 아님). **거꾸로 말하면 앞으로 부당한 소요시간(개별 방문 체류·솔버 예측)도 같은 인터폴레이션 형태로 그리면 이 두 가드는 못 잡는다** — 사각지대이지 지금 위반은 아니다. 새 소요시간 표시를 이 폴더에 추가할 때는 "리터럴이 없다"가 "허용된 예외"와 동의어가 아님을 기억할 것(신규 가드 신설 여부는 판단 필요, 04 리포트·개발로그 참고).
