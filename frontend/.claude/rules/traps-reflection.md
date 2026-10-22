---
paths:
  - "src/features/reflection/**"
  - "src/pages/record/share-card/**"
  - "src/pages/record/trip-summary/**"
  - "src/pages/record/daily-reflection/**"
  - "app/trips/[tripId]/records/**"
  - "src/features/share-trip-card/**"
  - "src/pages/record/travel-style/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **j06 공유 카드는 지도를 넣지 않는다**(TRIP-634 몫) — `TripSummary`/`DayHighlight`에 좌표가 없다. 네이버 지도는 네이티브 뷰라 view-shot 스냅샷에 잡힌다(캡처 제약 없음, 나중에 지도가 들어와도 이 함정은 적용 안 됨).
- **캡처 3종(`react-native-view-shot`·`expo-media-library`·`expo-sharing`)은 TRIP-1071로 실구현됐다 — `captureShareImage()`는 더 이상 없다.** `isShareCaptureArmed()`(`shareCapture.ts`)가 세 모듈 존재를 판정하고, `saveShareCardImage`/`shareShareCardImage`가 실행한다. 지도(`repo-traps.md` 지도 절)와 같은 함정 계열 — 네이티브 모듈이라 **코드만 머지하고 재빌드(`prebuild`→`run:ios`)를 안 하면 기존 dev build 엔 버튼 줄이 안 뜬다**(armed:false로 정상 낙하 — 크래시는 아니다). **jest는 이 재빌드-전 상태를 원리적으로 재현 못 한다** — jest-expo가 세 모듈을 항상 "있는 척" 프리로드해서 `isShareCaptureArmed()`가 목 없이는 실제로 항상 true다. `armed:false` 짝은 전부 `jest.mock('.../shareCapture')` 목 주입으로만 존재한다(실측, 개념 [[정적 import vs 동적 import]] TRIP-1071 절). 패키지 3종을 소스에서 직접 `await import(...)`하면 unit(`--experimental-vm-modules`) 버킷은 CJS/ESM 충돌로 죽고 integration 버킷은 동적 import 자체가 안 된다 — 그래서 이 패키지들의 정적 import는 로컬 어댑터에만 있다 — 캡처 3종은 `shareCaptureNative.ts`, `expo-sharing` 만은 설정 내보내기용 `pages/settings/settings/model/exportShareNative.ts`(TRIP-1422)가 하나 더 쥔다(어댑터 둘). 소비처는 각 어댑터만 동적 import한다(auth `makeAuthorize` 선례와 같은 모양). ⚠️ 내보내기 어댑터는 eslint 캡처 어댑터 예외 블록에 얹혀 있어 `expo-sharing` 외 캡처 3종·`expo-task-manager` 정적 import도 lint가 막지 않는다(03b 참고-1, 부팅은 안 죽고 `failed` 문구로 낙하). 새 네이티브 의존을 이 폴더에 더할 때 이 이음새를 그대로 재사용한다.
- **기록 하단 바(`RecordNavBar`)의 "입장 모프는 한 번"은 컴포넌트 인스턴스 안 ref 라서, 바가 새로 마운트되면 기억이 사라져 홈 5칸 모프가 다시 돈다(TRIP-1584)** → React 는 "같은 자리의 같은 타입"만 같은 인스턴스로 본다. ① 화면의 얼굴(대기·실패·데이터)마다 바를 다른 트리 자리에 두면 얼굴이 바뀔 때 재마운트된다 — j04 는 모든 얼굴이 `withBar` 의 같은 `<View flex-1>{얼굴}<RecordNavBar/></View>` 자리를 쓰게 고쳤고(5-b W1) `recordBarStack` 의 "얼굴이 바뀌어도 바 노드가 같은 인스턴스" 한 건이 지킨다. **j03·j01 에 새 얼굴을 더하거나 바를 얼굴 안으로 옮기면 가드가 없다**(j03·j01 은 바가 한 JSX 자리라 지금은 해당 없음). ② **j03 일차 칩은 `router.replace` 로 같은 라우트의 날짜만 바꿔 화면을 새로 마운트한다** — j03 이 `(tabs)` 바로 위에서 열렸다면(푸시 REFLECTION_DAILY·홈 카드 직행) 칩을 누를 때마다 입장 모프가 다시 돈다(03b W2, 탐침으로 재현, 심판 없음). j01·j04 를 거쳐 온 평소 경로는 아래가 다른 기록 화면이라 안 돈다. 처방 후보는 "한 번 봤나"를 화면(날짜 무관) 단위로 기억하는 것이고 아직 안 했다.
- **기록 3종 칸 이동은 일괄 `dismissTo` 도 일괄 `push` 도 아니다 — `dismissTo(href)` 는 가려는 라우트가 스택에 없으면 push 가 아니라 맨 위 화면을 바꿔치기한다** → 스택에 있으면 그 위를 걷어내고 파라미터(`[date]`·`?day=`)를 새 href 로 바꾼다(`renderRouter` 실측, 2026-10-22). 그래서 `useRecordBarNav` 는 누르는 순간 `getRoutes()` 로 "있나"를 읽어 있으면 dismissTo·없으면 push 한다(렌더 때 굳히면 낡은 스택). 일괄 dismissTo 면 j04 에서 기록 칸이 j04 를 바꿔치고 입장 모프가 다시 돈다. `recordBarStack` 이 지키지만 expo-router 가 이 의미를 바꾸면 그 테스트의 실측 전제부터 다시 잰다.
