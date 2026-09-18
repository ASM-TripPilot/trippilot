---
paths:
  - "src/features/reflection/**"
  - "src/pages/share-card/**"
  - "src/pages/trip-summary/**"
  - "src/pages/daily-reflection/**"
  - "src/app/trips/[tripId]/records/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **view-shot 의 WebView 캡처 불가 함정은 네이버 네이티브 전환(TRIP-861)으로 해소됨 — j06 지도 히어로 재개가 후속 후보** → 옛 카카오 WebView 시절엔 `react-native-view-shot` 이 WebView 콘텐츠를 네이티브 스냅샷에 못 담아, 지도를 카드에 얹으면 그 부분이 비었다. 네이버 지도는 네이티브 뷰라 스냅샷에 잡히므로 이 제약은 사라졌다. 단 j06 공유 카드(TRIP-574)는 아직 지도를 안 넣는다 — 이유가 **캡처 불가에서 좌표 계약 부재로 바뀌었다**(`TripSummary`/`DayHighlight` 에 lat/lng 없음). 그리고 `captureShareImage()` 는 `expo-media-library`/`expo-sharing`/`expo-file-system`·`react-native-view-shot` 미설치로 여전히 `{armed:false}` degrade 스텁이다(Blocker A). **좌표 계약 확장 + view-shot 설치가 되면 이제는 라이브 네이티브 지도를 히어로로 재개할 수 있다**(옛 raster-스냅샷 우회 불필요) — 신규 티켓 후보.
- **INV-3 소스 스캔 가드(`reflectionStructure.test.ts` G6·`reflectionSummaryStructure.test.ts` AC-4)는 리터럴 문자열만 보고 값 인터폴레이션은 못 본다** → `DURATION_TEXT=/(소요|\d+\s*분|\d+\s*시간)/`는 소스 텍스트를 정규식으로 훑는 도구라, `{value}{unit}`처럼 숫자·단위를 변수로 이어붙인 렌더는 소스에 리터럴 `\d+분`이 없어 **미매치**한다. j05(TRIP-573)의 `StatTile`이 이 성질을 이용해 BR-U5-08a가 허용하는 "평균 체류 72분"을 화이트리스트 추가 없이 통과시켰다(실검증 완료 — 정당한 예외, 위반 아님). **거꾸로 말하면 앞으로 부당한 소요시간(개별 방문 체류·솔버 예측)도 같은 인터폴레이션 형태로 그리면 이 두 가드는 못 잡는다** — 사각지대이지 지금 위반은 아니다. 새 소요시간 표시를 이 폴더에 추가할 때는 "리터럴이 없다"가 "허용된 예외"와 동의어가 아님을 기억할 것(신규 가드 신설 여부는 판단 필요, 04 리포트·개발로그 참고).
