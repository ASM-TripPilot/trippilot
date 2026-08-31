---
paths:
  - "src/features/record/**"
---
# `src/features/record/` — j01 방문 기록 default (TRIP-565 신설)

**이 폴더는 이번 사이클(TRIP-565)에서 처음 생겼다.** `features/execution`과 목적이 겹쳐 보이지만(둘 다 `visit_check` 실적을 다룸) 페이지 shape가 다르다 — execution의 `deriveVisitProgress`는 poi 단위 **집계**(i01 실행 카드용), 이쪽은 per-record 4상태다. 그래서 재사용하지 않고 신규 구현했다(01b Q2, YAGNI — 3번째 소비자가 나올 때까지 shared 승격 보류).

**경계**: `features/record`는 **다른 `features/*`를 import할 수 없다**(특히 `execution` — 이름이 같은 `useVisitCheck`가 있어 혼동하기 쉽다). `eslint.config.js`의 `FEATURES` 배열엔 `record`가 없어 여전히 기계 강제 밖 — `recordsStructure.test.ts`의 G2(소스 재귀 스캔, `settingsBoundary.test.ts`·`notificationStructure.test.ts` 동형)가 이 경계의 유일한 그물이다(개념 [[기능 간 조합은 pages 층 전담 (기계 강제 없음)]]).

| 파일 | 역할 |
|---|---|
| `model/visitStatus.ts` | **신규.** `deriveVisitStatus({arrivedAt, completedAt, skippedAt}) → 'UPCOMING'\|'IN_PROGRESS'\|'COMPLETED'\|'SKIPPED'`. 서버·클라 어디에도 `status` 컬럼/필드를 두지 않고 세 timestamp의 유무만으로 매번 계산(INV-U5-01) — 입력 타입에 `status` 자리 자체가 없어 "저장된 상태를 실수로 읽는" 경로가 구조적으로 봉쇄된다. 우선순위 `skipped > completed > arrived > upcoming`은 execution의 `deriveVisitProgress`와 규칙은 같되 shape(집계 vs per-record)가 달라 재사용하지 않았다. 개념 [[per-record 상태 파생 (세 timestamp에서 우선순위로 계산)]]. |
| `model/visitStatus.test.ts` | PBT(fast-check) + 진리표 + INV 잠금(가짜 `status` 필드를 섞어도 무시됨을 확인). **02b test-fix 1건**: `fc.date({min,max})`가 fast-check v4.9.0에서 Invalid Date를 생성해 `.toISOString()`이 구현 호출 전에 throw하는 심판 결함(~25% flaky) — `noInvalidDate: true` 한 줄로 수정, 뮤테이션 실측(우선순위 swap → 2 failed)으로 커버리지 불변 확인(개념 [[뮤테이션 테스팅]] TRIP-565 절). |
| `model/useVisitCheck.ts` | **신규.** `arrive`/`complete`/`skip` 3종 낙관 갱신 + 레코드(visitCheckId) 단위 롤백(통짜 스냅숏 복원 아님, execution 선례 동형, W-2 회귀 방지). 판별 유니온 `VisitCheckOutcome`(`{kind:'completed'}\|{kind:'failed',reason}` 등)으로 실패를 조용히 삼키지 않는다(INV-4, 개념 [[판별 유니온]]). **`settleRollback()`**(:54-55, `await new Promise(r => setTimeout(r,0))`) — react-query v5 `notifyManager`의 배치 통지가 매크로태스크로 밀려 롤백 직후 관찰자 스냅숏이 stale COMPLETED를 보이는 것을 한 틱 양보해 브리지(개념 [[낙관적 갱신과 롤백 (optimistic update)]] TRIP-565 절, code-critic 참고-1 — 실효 소비자는 테스트뿐, 프로덕션 `TripRecordsPage`는 `void`로 fire-and-forget이라 무해하지만 5-c 후보로 test-infra 이관 미룸). arrive는 complete/skip과 달리 **무효화 대신 응답 레코드로 낙관 레코드를 교체**한다(재조회가 즉석 삽입을 덮어 AC-5가 깨지는 것을 피함, `useVisitCheck.ts` 내부 주석 명시). |
| `model/useVisitCheck.integration.test.tsx` | msw + 실 QueryClient. AC-1(plan 미접촉)·AC-2(409 롤백·불변)·AC-5(즉석 2건 append)·skip·★W-2(동시 두 도착 중 하나 실패해도 다른 낙관 생존). ⚠️ AC-1의 "plan 미접촉" 단언(`/itinerary` 히트 0건)은 이 셋업에서 항상 참(페이지 미마운트, 호출 경로 자체가 없음) — BR-U5-01의 진짜 보장은 구조적(G2 소스 스캔이 execution import 0을 보조), 03b 참고-3. |
| `model/useTripRecords.ts` | **신규.** `useGetTripsTripIdVisitsDaysDay` 얇은 래퍼(로직 0, `useLiveItinerary.ts` 선례) — 동작 테스트 없음, 구조 가드가 존재만 확인. |
| `ui/RecordGlyphs.tsx` | **신규.** 체크서클·즉석추가 등 벡터. `*Glyphs.tsx` 관례(raw hex 스캔 제외, features 간 import 금지라 execution/auth 글리프 재사용 불가 — 벡터만 Figma 실 에셋에서 옮겨 미러 신설). |
| `ui/VisitRecordCard.tsx` | **신규.** `deriveVisitStatus(card)`로 내부 파생(status를 prop으로 안 받음). **★fill 함정 방어**: 완료↔미완료를 fill 색만 바꾸지 않고 상태별 **서로 다른 testID**(`record-visit-check-{done\|active\|upcoming\|skipped}-{id}`)로 렌더 — 완료 발화 Pressable은 IN_PROGRESS에만 존재해 UPCOMING press가 **구조적으로** 0회(`fireEvent.press`는 `disabled`를 안 막는다는 함정을 disabled가 아니라 "핸들러 부재"로 회피, 개념 [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]] TRIP-565 절). 건너뜀 컨트롤(`record-visit-skip-{id}`)은 j01 default 프레임에 시각 정본이 없어 헤더 우측에 자율 배치(01b 맹점3, 6-b/후속에서 위치가 바뀔 수 있음). raw-hex 무가드(03b 참고-5, 현재 0 hits이나 신규 심판 공백 — 후속 티켓 후보). |
| `ui/VisitRecordCard.test.tsx` | AC-1(UI 반)·AC-3(upcoming 완료 불가)·★fill 함정 잠금(4상태 it.each present/absent 짝)·skip UI. |
| `ui/SpontaneousVisitButton.tsx` | **신규.** testID `record-trip-spontaneous-add`. |
| `ui/SpontaneousVisitButton.test.tsx` | AC-5 UI 반. |
| `ui/TripRecordsScreen.tsx` | **신규.** 무상태 프레젠테이션 — appbar·일자 탭·지도 히어로(`KakaoMapView viewOnly`)·카드 목록·즉석 추가·탭바·저장 FAB. 지도는 250px 고정 블록, 즉석 추가 버튼·카드는 지도 아래 flow 형제(**KakaoMapView 위 인터랙티브는 형제 노드로** — WebView가 자기 위 absolute 오버레이의 터치를 흡수하는 함정, repo-traps 지도 절). `itineraryMapSurfaceStructure.test.ts`의 `LOCKED_CALLERS`에 opt-in 등재(viewOnly/connectPins 심판을 확장, 커버리지 약화 아님 — 개념 [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]]). |

## 관련

- 페이지 배선: `frontend/.claude/rules/layer-pages.md`(`trip-records` 행).
- 개념: [[per-record 상태 파생 (세 timestamp에서 우선순위로 계산)]] · [[낙관적 갱신과 롤백 (optimistic update)]] · [[판별 유니온]] · [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]] · [[뮤테이션 테스팅]] · [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]] · [[기능 간 조합은 pages 층 전담 (기계 강제 없음)]].
- 개발로그: [[2026-08-31 20260831-trip565-visit-records]].
