# U4 In-trip & Plan-B — Frontend Components

> **아키텍처 정본 = `frontend/README.md`, 현재 배치의 사실 정본 = `frontend/docs/structure.md`(+ 리포).** 층 규약을 여기 옮겨 적지 않는다. 이 문서가 정하는 것은 **어느 슬라이스에 무엇이 들어가고, 무엇을 서버에서 받고, 무엇을 재판정하지 않는가**이다.
> **화면 정본**: 라이브 Figma 밴드 `i` (2026-08-09 관측 — 코드 20 + 변형). 결번 `i06`·`i11`은 **그대로 둔다**(DEC-U4-1로 불필요).
> **현 상태 (2026-08-26 TRIP-442 [기록] 갱신)**: `features/execution`·`features/planb` **실재**(TRIP-395·398·439·440·441·442로 채워짐, TRIP-173에서 빈 배럴째 삭제됐던 것을 TRIP-439가 재신설) — "디렉토리 없음"은 낡은 서술이라 소급 정정한다. `app/(tabs)/itinerary.tsx`도 더 이상 껍데기가 아니다(TRIP-468로 "내 여행" 목록 뷰 실배선). 밴드 `i` 라우트는 여전히 딥링크/프리뷰 전용이 대부분(i10·i12·i14·i19·i20·i21 — 라이브 세션 진입 배선은 각 화면 소유 후속 티켓, 아래 §1·§4 참고) — "라우트 0"이 아니라 "라이브 진입 배선 0"으로 정확히 읽는다.

---

## 0. 층 배치 — 이 유닛이 지키는 관례 (실재 선례에서 유도)

| 층 | 규약 | 선례 |
|---|---|---|
| `src/app/**` | **얇은 라우트 래퍼(5~9줄)** — 훅·마크업 0. params만 읽어 prop으로. **`@/pages/<slice>` 배럴만** import | `app/trips/[tripId]/itinerary/must-visits/index.tsx` |
| `src/pages/<slice>/` | `ui/<Name>Page.tsx` + `index.ts`. **훅 ↔ 화면 배선**. 판정 함수 호출도 여기서 1회 | `pages/trip-new-step2/`, `pages/itinerary-mustvisit/` |
| `src/features/<d>/model/` | 순수 함수 · Query 훅 · Zustand 스토어 | `features/trip/model/baseGate.ts` |
| `src/features/<d>/ui/` | props만 받는 프레젠테이션. **재판정 금지** | `features/trip/ui/TripWizardStep2Screen.tsx` |
| `src/shared/**` | 두 feature 이상이 쓰는 것 | `shared/map/KakaoMapView.tsx` · `shared/location/` |
| `src/__tests__/*Structure.test.ts` | 기계 강제 없는 계약을 부정 단언으로 잠금 | `tripBaseGateStructure.test.ts` |

### 0.1 feature 2개로 가른다

| feature | 담당 | 화면 |
|---|---|---|
| **`features/execution`** | 여행 중 현장(에픽 G) — 진행 상태·방문 체크·현재 장소·실제 경로 | `i01`~`i05` · `i08` |
| **`features/planb`** | 재계획(에픽 F) — 트리거 열람·지시 수집·재계획안·비교·확정·폴백 | `i09`·`i10` · `i12`~`i22` |

- **features 간 직접 import 금지.** `i01`(execution)에서 `i10`(planb)으로 가는 것은 **라우팅**이다. 두 feature가 함께 쓰는 지도·위치·거리 표기는 **`shared/`로 승격**한다(§5).
- U3(`features/itinerary`)와도 직접 import하지 않는다 — 일정 데이터는 `shared/api` 훅으로 공유한다.

---

## 1. 라우트 (`src/app/`)

| 파일 | 화면 | 배럴 |
|---|---|---|
| `app/(tabs)/itinerary.tsx` | 분기 — 활성 여행이 **오늘 구간 안**이면 `live`로 redirect, 아니면 U3 흐름 | `@/pages/live-itinerary` |
| `app/trips/[tripId]/live/index.tsx` | **i01·i02·i03** 여행 중 일정 (일정｜지도, 계획｜실제) | `@/pages/live-itinerary` |
| `app/trips/[tripId]/live/arrive/[slotKey].tsx` | **i04** 도착·방문 체크 | `@/pages/live-arrive` |
| `app/trips/[tripId]/live/place/[poiId].tsx` | **i05** 현재 장소 상세 | `@/pages/live-place` |
| `app/trips/[tripId]/live/location.tsx` | **i20·i21** 수동 위치 · 권한 거부 | `@/pages/live-location` |
| `app/trips/[tripId]/planb/triggers.tsx` | **i09** 감지된 변화 | `@/pages/planb-triggers` |
| `app/trips/[tripId]/planb/index.tsx` | **i10** AI에게 맡길게요(+범위 밖) | `@/pages/planb-request` |
| `app/trips/[tripId]/planb/solving.tsx` | **i12** 재계획 로딩 | `@/pages/planb-draft` |
| `app/trips/[tripId]/planb/draft.tsx` | **i13·i14·i16** 재계획안 · 후보 교체 · 대안 없음 | 〃 |
| `app/trips/[tripId]/planb/manual.tsx` | **i15·i22** 직접 수정 · error | `@/pages/planb-manual` |
| `app/trips/[tripId]/planb/rest.tsx` | **i17** 휴식 모드 | `@/pages/planb-rest` |
| `app/trips/[tripId]/planb/diff.tsx` | **i18·i19** 전후 비교 · 반영 완료 | `@/pages/planb-diff` |

- **`i07` 푸시 알림은 라우트가 아니다** — 지오펜스가 깨웠을 때의 로컬 알림. 탭하면 `live/arrive/[slotKey]` 또는 `planb/` 로 딥링크한다.
- **`i08` 인앱 트리거 칩·`i01 되돌리기 토스트`도 라우트가 아니다** — `live/index` 상주 컴포넌트/토스트.
- **`i14`는 바텀시트**라 라우트가 아니다 — `planb/draft` 안의 시트(`@gorhom/bottom-sheet`).
- ⚠️ `trips/**`는 `(tabs)` 밖이라 `Stack.Protected` guard에 안 걸린다 — **미인증 딥링크로 열린다**(structure.md 경고). 데이터 노출은 서버 401이 막는다. **알림 딥링크가 이 경로로 들어오므로 U4에서 특히 주의**한다.

## 2. `src/pages/` 슬라이스 (10)

| 슬라이스 | `ui/<Name>Page.tsx` | 배선 책임 |
|---|---|---|
| `live-itinerary` | `LiveItineraryPage` | `useLiveItinerary(tripId)` + `useActiveTriggers(tripId)` → **`resolveLiveState()` 판정 1회** → `LiveItineraryScreen`. 뷰 세그먼트·토글은 스토어 |
| `live-arrive` | `LiveArrivePage` | `useVisitCheck()` 뮤테이션(낙관적) + 다음 슬롯 조립 |
| `live-place` | `LivePlacePage` | `usePlaceDetail(poiId)` + 결측 → `"미확인"` 치환은 `model/`에서 |
| `live-location` | `LiveLocationPage` | `shared/location` 권한 상태 ↔ 수동 입력 배선. 결과를 `replan_session` 기준점으로 |
| `planb-triggers` | `PlanbTriggersPage` | `useTriggerWatchlist(tripId)` → 3항목 상태 |
| `planb-request` | `PlanbRequestPage` | RHF 폼 상태 ↔ `useStartReplan()` 뮤테이션. 서버가 `OUT_OF_SCOPE`를 주면 그대로 화면에 내린다 |
| `planb-draft` | `PlanbSolvingPage` · `PlanbDraftPage` | `useReplanSession(sessionId)` 폴링 → **`resolveReplanState()` 판정 1회**(SOLVING·DRAFT·NO_SOLUTION·FAILED) → 로딩/초안/대안 없음. 후보 시트는 `useSlotCandidates`(U3 계약 재사용) |
| `planb-manual` | `PlanbManualPage` | 수동 편집 draft(1회 시드) ↔ `PUT /trips/{tripId}/itinerary`(편집 전체교체+재검증, 비차단) — 아래 소급 기록 참조 |
| `planb-rest` | `PlanbRestPage` | 재개 시각 입력 → 재정렬 재요청 |
| `planb-diff` | `PlanbDiffPage` | `useReplanDiff(sessionId)` + `useApplyReplan()` — **확정의 유일한 호출 지점** |

> **판정은 페이지에서 1회**(`stay-search`의 `resolveStaySearchState` 선례). 화면은 재판정하지 않으며 구조 가드가 잠근다.

> **[소급 기록 — TRIP-443 (기록) 반영, 2026-08-27]** 위 `planb-manual` 행이 이름 붙인 `useValidateItinerary()`는 리포에 실존하지 않는다(`grep -rn useValidateItinerary src` = 0건, develop `openapi.yaml`에도 `validate` 전용 엔드포인트가 없다). TRIP-443 구현이 확인한 실계약은 **`PUT /trips/{tripId}/itinerary`**(`EditItineraryRequest{days:[{date,slots:[{poiId,startAt,endAt,isFixed,endsNextDay}]}]}` → `Itinerary`, 슬롯별 `hasViolation`/`violationReason` **비차단** 응답) — 편집 전체교체와 재검증이 한 호출에 묶여 있다. `PlanbManualPage`는 GET으로 받은 `days`를 로컬 draft에 1회만 시드하고, `[저장]`이 그 draft를 이 PUT으로 조립해 쏜다(별도 `validate` 훅 없음). 이름과 실계약이 갈렸을 뿐 "편집 스토어 ↔ 서버 재검증"이라는 설계 의도 자체는 유지된다. 근거: `_workspace/20260826-trip443-planb-manual/03_implementer_notes.md`(§데이터·화면 흐름) · `frontend/src/pages/planb-manual/ui/PlanbManualPage.tsx` · `backend/docs/design/openapi.yaml`(`/trips/{tripId}/itinerary` PUT).

## 3. `src/features/execution/`

### `model/`

| 파일 | 종류 | 책임 |
|---|---|---|
| `liveState.ts` | 순수 | `resolveLiveState()` — 로딩·오류·활성 트리거 유무·오늘 구간 밖 판정 |
| `slotProgress.ts` | 순수 | 슬롯 상태 사영(`완료`·`진행 중`·`예정`). **시각은 서버 값을 그대로 통과시키기만** — 재추정 함수를 두지 않는다(BR-U4-34) |
| `dwellMinutes.ts` | 순수 | `completedAt − arrivedAt` 실적 산출. **표시용이 아니라 트리거 입력용**(INV-U4-03) |
| `placeDetailView.ts` | 순수 | 결측 필드를 `"미확인"`으로(BR-U4-40). **혼잡도 필드 없음** |
| `actualDistance.ts` | 순수 | 점열 → 누적 거리. **걸음 수 산출 함수를 두지 않는다**(BR-U4-41) |
| `useLiveItinerary.ts` | 훅 | 활성 일정 조회 |
| `useVisitCheck.ts` | 훅 | 도착·완료 체크(낙관적 갱신) |
| `usePlaceDetail.ts` | 훅 | i05 |
| `useActualRoute.ts` | 훅 | 실제 경로 점열 — **앱 포그라운드 구간만**(DEC-U4-7) |
| `liveViewStore.ts` | 스토어 | UI 상태만 — `일정｜지도` 세그먼트 · `계획｜실제` 토글 · 시트 열림 |

### `ui/`

| 파일 | 화면 | 책임 |
|---|---|---|
| `ExecutionGlyphs.tsx` | — | 아이콘 |
| `LiveItineraryScreen.tsx` | i01 | 일자 칩 · 세그먼트 · 타임라인. 변형 = `기록 없음`(**U4 기본 렌더**) · `수정 알약 열림` · `변수 감지` |
| `LiveSlotCard.tsx` | i01 | 상태 배지 · **계획 시각**(`15:00 도착 예정`) · 영업시간 · 다음 구간 `도보 600m`. `[방문 완료]`, `[사진]`·`[메모]`는 **비활성**(BR-U4-38) |
| `TriggerBanner.tsx` | i01 | `WEATHER`·`DELAY`·`CLOSURE` 3변형 문구 + `[대안 보기]` |
| `TriggerChip.tsx` | i08 | 상단 상주 칩 |
| `ReplanFab.tsx` | i01 | `일정 수정 필요` — 트리거 없어도 항상 노출(BR-U4-10) |
| `LiveMapScreen.tsx` | i02·i03 | `shared/map` 소비. `실제 1.4km` + **"앱을 켜 둔 구간만 기록돼요"** 각주. 동의 없으면 실제 레이어 비활성 + 사유(BR-U4-42) |
| `ArriveScreen.tsx` | i04 | `13:32 도착 · 예정보다 2분 빠르게 왔어요`(실적) · `[방문 완료]` · 다음 일정 `15:00 · 850m` · `[다음 장소 길찾기]` |
| `PlaceDetailScreen.tsx` | i05 | 영업시간·위치·다음 일정까지 여유 · `지금 여기` |
| `UndoToast.tsx` | i01 | 확정 직후 되돌리기 토스트 |

## 4. `src/features/planb/`

### `model/`

| 파일 | 종류 | 책임 |
|---|---|---|
| `replanScope.ts` | 순수 | 칩 ↔ **ai `ReplanScope`** 매핑(`지금 이후`→`PARTIAL_SLOTS` · `오늘 전체`→`FULL_DAY`). **2종뿐**(BR-U4-11) |
| `triggerLabel.ts` | 순수 | `TriggerKind` 4종 → 문구·아이콘. **`교통`·`체류 초과` 항목 없음**(BR-U4-01) |
| `replanState.ts` | 순수 | `resolveReplanState()` — SOLVING·DRAFT·NO_SOLUTION·FAILED·OUT_OF_SCOPE |
| `replanRequest.ts` | 순수 | i10 폼 → 요청 DTO 조립(범위·사유·지시어·자유 텍스트). **자유 텍스트를 클라가 해석하지 않는다**(BR-U4-13) |
| `diffSummary.ts` | 순수 | 영향 지표 3종 조립(이동 거리 변화·방문 수·숙소 복귀 시각) + 항목 배지 분류(추가·삭제·이동·고정) |
| `slackTime.ts` | 순수 | **여유 시간 = 두 확정 시각의 차**(BR-U4-24). 도착 예정 시각 추정 함수를 두지 않는다 |
| `useTriggerWatchlist.ts` | 훅 | i09 |
| `useActiveTriggers.ts` | 훅 | i01 배너·칩용 |
| `useSuppressTrigger.ts` | 훅 | `[끄기]` → 억제 레코드 생성(BR-U4-15) |
| `useStartReplan.ts` | 훅 | 세션 생성 |
| `useReplanSession.ts` | 훅 | 폴링 |
| `useReplanDiff.ts` · `useApplyReplan.ts` | 훅 | i18 비교 · **확정 유일 지점** |
| `replanFormStore.ts` | 스토어 | i10 시트 UI 상태(칩 선택·시트 열림) |

### `ui/`

| 파일 | 화면 | 책임 |
|---|---|---|
| `PlanbGlyphs.tsx` | — | 아이콘 |
| `TriggerWatchlistScreen.tsx` | i09 | 활성 배너 + 감시 항목 **3종**(활성/정상) |
| `ReplanRequestSheet.tsx` | i10 | 범위 2칩 · 감지 배너+`[끄기]` · 왜 6 · 어떻게 7 · 자유 텍스트 · `[AI가 다시 짜기]`·`[직접 고르기]` · `· 방문한 곳과 진행 중인 일정은 그대로 둡니다` |
| `OutOfScopeNotice.tsx` | i10 변형 | `이 여행에서 바꿀 수 있는 요청이 아니에요` — **서버 판정 결과를 표시만**(BR-U4-14) |
| `ReplanSolvingScreen.tsx` | i12 | 진행 표시 · [백그라운드로] · [취소] |
| `ReplanDraftScreen.tsx` | i13 | 헤더 근거 · 지도 · 슬롯 리스트 · `[직접 수정]`·`[이대로 적용]` |
| `ReplanSlotRow.tsx` | i13 | 배지(`방문함`·`진행 중`·`변경됨`·`고정`) · `#실내 · 도보 1.3km` · `다른 후보 N >` |
| `SlotCandidateSheet.tsx` | i14 | 후보 카드 — 이유 / `지금 위치서 차량 6.4km` / **`17:00 고정까지 여유 1시간 20분`** / 배지 |
| `NoAlternativeScreen.tsx` | i16 | 사유 한 줄 + 3옵션(건너뛰기·휴식·수동) |
| `RestModeScreen.tsx` | i17 | 재개 시각 / 즉시 재개 |
| `ReplanDiffScreen.tsx` | i18 | 지표 3종 · 전(점선)/후(실선) 지도 · 항목 배지 · `[취소]`·`[확정]` |
| `CarryOverNotice.tsx` | i18 | 제외·이월 명시 + 동의(BR-U4-25) |
| `ReplanAppliedScreen.tsx` | i19 | 반영 완료 |
| `ManualEditScreen.tsx` | i15·i22 | 순서·삭제·시각 직접 입력. 숙소 고정 위반 불가(BR-U4-44). error 변형은 **누락 외부 데이터 표기** |

## 5. `src/shared/` 변경 (승격)

| 대상 | 변경 | 이유 |
|---|---|---|
| `shared/map/KakaoMapView.tsx` | **확장** — 다중 핀·폴리라인·**점선 레이어(실제 경로/변경 전)**·center 갱신 | itinerary(U3)·execution·planb 3곳이 쓴다. 지금은 미지원(실측) |
| `shared/location/` | **지오펜스 추가** — `geofence.ts`(등록·해제) · `useLocationPermission`에 **"항상 허용" 승격 경로**. `LocationPreprompt.tsx` 재사용 | 위치 권한·수집 **단일 소유**가 이 디렉토리다. execution·planb 둘 다 소비 |
| `shared/ui/StateNotice.tsx` | 재사용 | 대안 없음·오류·권한 거부 |
| `shared/api/` | `distanceLabel.ts` 승격 후보 — `도보 600m` 표기 조립 | U3 `legDistance.ts`와 같은 규칙. **두 번째 소비자가 생기는 시점에 승격**(README 승격 규칙) |
| `shared/api/generated/` | `planb`·`execution` 태그 코드젠 추가(`orval.config.ts`) | |
| `shared/storage/` | 방문 체크 오프라인 큐(기록 입력만 — README 오프라인 정책) | |

## 6. 구조 가드 (`src/__tests__/`)

| 파일 | 잠그는 계약 |
|---|---|
| `liveTimeStructure.test.ts` | `features/execution/**`에 **시각 산술이 0건**(`+`·`addMinutes`·`Date` 연산이 슬롯 시각에 닿지 않음) — BR-U4-34·PBT-U4-F1 |
| `noStepCountStructure.test.ts` | 리포 전역에 **걸음 수/보수 관련 심볼 0건**(`step`·`보`·`pedometer`) — BR-U4-41 |
| `planbTriggerKindStructure.test.ts` | `triggerLabel.ts`의 종류 집합이 **정확히 4종**이고 `교통`·`체류 초과` 문자열이 0건 — BR-U4-01 |
| `planbScopeStructure.test.ts` | `replanScope.ts`의 범위가 **정확히 2종**, `내일` 문자열 0건 — BR-U4-11 |
| `planbApplyStructure.test.ts` | `useApplyReplan` 호출처가 **`planb-diff` 슬라이스 1곳뿐** — BR-U4-28 |
| `executionDurationStructure.test.ts` | `features/{execution,planb}/ui/**`에 소요시간 단위 표기 0건 — INV-3·PBT-U4-F2 |
| `pagesLayerStructure.test.ts` ✅ | 새 `live-*`·`planb-*` 슬라이스를 재귀 스캔이 자동 편입 |

## 7. 폼 검증 (UX 사본 — 권위는 서버)

| 대상 | 규칙 |
|---|---|
| i10 자유 텍스트 | **길이 상한만** 클라가 본다. 내용 판정은 전부 서버(BR-U4-14) |
| i10 칩 | 전부 선택 사항 — 하나도 안 골라도 제출 가능(BR-U4-12) |
| i15 시각 직접 입력 | `HH:mm`. 숙소 고정 충돌은 **경고 배지**로 보이되 저장은 서버가 막는다 |
| i17 재개 시각 | 현재 시각 이후만. 서버 재검증이 최종 |

## 8. testID (규약 `{feature}-{screen}-{role}`)

```
execution-live-screen · -slot-{slotKey} · -trigger-banner · -replan-fab · -undo-toast
execution-map-plan-toggle · -actual-toggle · -actual-distance · -actual-disabled
execution-arrive-complete · -photo · -memo · -next-nav · -place-detail
execution-place-openhours · -slack · -unknown-{field}
planb-triggers-item-{kind} · -active-cta
planb-request-scope-{scope} · -reason-{key} · -directive-{key} · -freetext
planb-request-submit · -manual · -suppress · -out-of-scope
planb-solving-progress · -background · -cancel
planb-draft-slot-{slotKey} · -candidates-{slotKey} · -apply · -manual
planb-candidate-{poiId} · -candidate-slack-{poiId}
planb-empty-skip · -empty-rest · -empty-manual
planb-diff-metric-{name} · -item-{slotKey} · -confirm · -cancel · -carryover
planb-manual-violation-{slotKey} · -missing-data
live-location-manual · -permission-denied · -use-last-visit
```

> **[공백]** 제안값이다. 구현이 확정한 값이 다르면 이 절에 소급 기록한다.

> **[소급 기록 — TRIP-442 (기록) 반영, 2026-08-26]** `live-location-use-last-visit`는 이 절이 이름을 제안한 시점엔 "마지막 방문지 사용"이라는 **별도 버튼**을 뜻하는 것처럼 읽혔으나, 라이브 Figma에는 그런 독립 UI가 없다(1790:3495·1790:3549 확인 — 확인된 노드는 지도·"이 위치로 계속"·"위치 입력 건너뛰기"뿐). TRIP-442 구현은 이 testID를 **"건너뛰기" 어포던스 하나**에 매핑했다 — 사용자가 이 버튼을 누르면 클라가 3순위(마지막 방문지)·4순위(등록 숙소) 중 어느 것도 스스로 정하지 않고 `originKind:null`로 서버에 위임하며, 그 사다리 3·4순위가 이 버튼 하나로 **폴드**된다(중립 문구 "마지막 방문지나 등록 숙소 기준으로 이어져요"가 이 폴드를 사용자에게 알림). 즉 testID 이름은 유지하되 그 의미를 "버튼 하나 = 사다리 두 순위 위임"으로 재정의한다. 근거: `src/pages/live-location/ui/LiveLocationPage.tsx`(TRIP-442 03_implementer_notes §1-3) · 위 §5(business-logic-model.md) 사다리 표.

## 9. PBT (`model/` 순수 함수 · fast-check)

| ID | 대상 파일 | 성질 |
|---|---|---|
| **PBT-U4-F1** | `slotProgress.ts` | 임의 슬롯 응답에 대해 렌더용 시각 문자열 집합 ⊆ 서버 응답 시각 집합 (클라 재추정 0) |
| **PBT-U4-F2** | `slackTime.ts` · `replanRequest.ts` | 임의 입력에서 **소요시간 단위 문자열이 산출되지 않는다**. `여유 N시간 M분`은 두 확정 시각의 차일 때만 |
| **PBT-U4-F3** | `liveState.ts` · `actualDistance.ts` | 위치 동의 false인 임의 상태에서 실제 경로 레이어는 항상 비활성 + 사유 동반, 누적 거리 산출 0 |

추가로 `business-rules.md` §7의 **PBT-U4-1~5**(서버측)와 짝을 이룬다 — 클라는 위 3종만 진다.
