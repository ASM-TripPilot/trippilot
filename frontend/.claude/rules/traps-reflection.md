---
paths:
  - "src/features/reflection/**"
  - "src/pages/share-card/**"
  - "src/pages/trip-summary/**"
  - "src/pages/daily-reflection/**"
  - "src/app/trips/[tripId]/records/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **j06 공유 카드는 지도를 넣지 않는다**(TRIP-634 몫) — `TripSummary`/`DayHighlight`에 좌표가 없다. 네이버 지도는 네이티브 뷰라 view-shot 스냅샷에 잡힌다(캡처 제약 없음, 나중에 지도가 들어와도 이 함정은 적용 안 됨).
- **캡처 3종(`react-native-view-shot`·`expo-media-library`·`expo-sharing`)은 TRIP-1071로 실구현됐다 — `captureShareImage()`는 더 이상 없다.** `isShareCaptureArmed()`(`shareCapture.ts`)가 세 모듈 존재를 판정하고, `saveShareCardImage`/`shareShareCardImage`가 실행한다. 지도(`repo-traps.md` 지도 절)와 같은 함정 계열 — 네이티브 모듈이라 **코드만 머지하고 재빌드(`prebuild`→`run:ios`)를 안 하면 기존 dev build 엔 버튼 줄이 안 뜬다**(armed:false로 정상 낙하 — 크래시는 아니다). **jest는 이 재빌드-전 상태를 원리적으로 재현 못 한다** — jest-expo가 세 모듈을 항상 "있는 척" 프리로드해서 `isShareCaptureArmed()`가 목 없이는 실제로 항상 true다. `armed:false` 짝은 전부 `jest.mock('.../shareCapture')` 목 주입으로만 존재한다(실측, 개념 [[정적 import vs 동적 import]] TRIP-1071 절). 패키지 3종을 소스에서 직접 `await import(...)`하면 unit(`--experimental-vm-modules`) 버킷은 CJS/ESM 충돌로 죽고 integration 버킷은 동적 import 자체가 안 된다 — 그래서 정적 import는 `shareCaptureNative.ts`(로컬 어댑터) 하나뿐이고 소비처는 그 어댑터만 동적 import한다(auth `makeAuthorize` 선례와 같은 모양). 새 네이티브 의존을 이 폴더에 더할 때 이 이음새를 그대로 재사용한다.
- **INV-3 소스 스캔 가드(`reflectionStructure.test.ts` G6·`reflectionSummaryStructure.test.ts` AC-4)는 리터럴 문자열만 보고 값 인터폴레이션은 못 본다** → `DURATION_TEXT=/(소요|\d+\s*분|\d+\s*시간)/`는 소스 텍스트를 정규식으로 훑는 도구라, `{value}{unit}`처럼 숫자·단위를 변수로 이어붙인 렌더는 소스에 리터럴 `\d+분`이 없어 **미매치**한다. j05 `StatTile`이 이 성질로 BR-U5-08a가 허용하는 "평균 체류 72분"을 통과시킨다(정당한 예외). **거꾸로 부당한 소요시간(개별 방문 체류·솔버 예측)도 같은 인터폴레이션 형태로 그리면 이 두 가드는 못 잡는다** — 새 소요시간 표시를 이 폴더에 추가할 때 "리터럴이 없다"가 "허용된 예외"와 동의어가 아니다.
