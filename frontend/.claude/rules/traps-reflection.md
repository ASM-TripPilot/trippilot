---
paths:
  - "src/features/reflection/**"
  - "src/pages/share-card/**"
  - "src/pages/trip-summary/**"
  - "src/pages/daily-reflection/**"
  - "src/app/trips/[tripId]/records/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **j06 공유 카드는 지도를 넣지 않는다** — `TripSummary`/`DayHighlight`에 좌표가 없고, `captureShareImage()`는 `expo-media-library`/`expo-sharing`/`expo-file-system`·`react-native-view-shot` 미설치로 `{armed:false}` degrade 스텁이다. 네이버 지도는 네이티브 뷰라 view-shot 스냅샷에 잡힌다(캡처 제약 없음).
- **INV-3 소스 스캔 가드(`reflectionStructure.test.ts` G6·`reflectionSummaryStructure.test.ts` AC-4)는 리터럴 문자열만 보고 값 인터폴레이션은 못 본다** → `DURATION_TEXT=/(소요|\d+\s*분|\d+\s*시간)/`는 소스 텍스트를 정규식으로 훑는 도구라, `{value}{unit}`처럼 숫자·단위를 변수로 이어붙인 렌더는 소스에 리터럴 `\d+분`이 없어 **미매치**한다. j05 `StatTile`이 이 성질로 BR-U5-08a가 허용하는 "평균 체류 72분"을 통과시킨다(정당한 예외). **거꾸로 부당한 소요시간(개별 방문 체류·솔버 예측)도 같은 인터폴레이션 형태로 그리면 이 두 가드는 못 잡는다** — 새 소요시간 표시를 이 폴더에 추가할 때 "리터럴이 없다"가 "허용된 예외"와 동의어가 아니다.
