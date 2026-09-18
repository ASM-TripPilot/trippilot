# U3 AI Itinerary Generation — Frontend Components

> **아키텍처 정본 = `frontend/README.md`, 현재 배치의 사실 정본 = `frontend/docs/structure.md`(+ 리포).** 층 규약을 여기 옮겨 적지 않는다 — 사본은 갈라진다. 이 문서가 정하는 것은 **어느 슬라이스에 무엇이 들어가고, 무엇을 서버에서 받고, 무엇을 재판정하지 않는가**이다.
> **화면 정본**: 라이브 Figma 밴드 h. `h25`(시간표)·`h26`(지도)가 완성 일정 정본이고 `h29~h33`은 상태·변형의 **동작·문구만** 취한다(DEC-U3-6).
> **⚠️ 2026-08-09 개정**: 초판은 `app/` 라우트 + 평면 컴포넌트 표로만 적혀 있어 리포의 실제 층 배치(`app` → `pages` → `features/{model,ui}` → `shared`)와 어긋났다. **실재 관례 기준으로 재작성**하고, TRIP-295·296으로 **이미 구현된 것**을 반영했다.

---

## 0. 층 배치 — 이 유닛이 지키는 관례 (실재 선례에서 유도)

| 층 | 규약 | 선례 |
|---|---|---|
| `src/app/**` | **얇은 라우트 래퍼(5~9줄)** — 훅·마크업 0. `useLocalSearchParams`로 params만 읽어 prop으로 내린다. import는 **`@/pages/<slice>` 배럴만**(딥 임포트 금지) | `app/trips/[tripId]/itinerary/must-visits/index.tsx` |
| `src/pages/<slice>/` | `ui/<Name>Page.tsx` + `index.ts` 배럴. **훅 ↔ 화면 배선**이 여기 산다. 서버 훅 호출·판정 함수 호출·prop 조립 | `pages/itinerary-mustvisit/`, `pages/trip-new-step2/` |
| `src/features/itinerary/model/` | **순수 함수 · TanStack Query 훅 · Zustand 스토어.** 판정은 여기 한 곳에서만 | `features/trip/model/baseGate.ts`, `useTripBases.ts`, `tripWizardStore.ts` |
| `src/features/itinerary/ui/` | **props만 받는 프레젠테이션**. 화면 `*Screen.tsx` · 시트 `*Sheet.tsx` · 아이콘 `ItineraryGlyphs.tsx`. **재판정 금지** | `features/trip/ui/TripWizardStep2Screen.tsx` |
| `src/shared/**` | 두 feature 이상이 쓰는 것. 지도(`shared/map`)·상태 안내(`shared/ui/StateNotice`)·API(`shared/api`) | `shared/map/KakaoMapView.tsx` |
| `src/__tests__/<name>Structure.test.ts` | **구조 가드** — "화면이 재판정하지 않는다" 같은 기계 강제 없는 계약을 부정 단언으로 잠근다 | `itineraryMustVisitStructure.test.ts` |

- **features 간 직접 import 금지.** 화면 이동은 라우팅으로, 데이터 공유는 `shared/api` 훅으로.
- 테스트는 소스 옆(co-located). 전역 가드만 `src/__tests__/`.

## 0.1 이미 구현된 것 (2026-08-09 실측)

| 파일 | 티켓 | 상태 |
|---|---|---|
| `features/itinerary/model/timeBandLabel.ts` · `slotKey.ts` | TRIP-295 | ✅ BR-U3-07 시간대 라벨 · BR-U2-04 slotKey 규약의 순수 함수 |
| `features/itinerary/model/mustVisitList.ts` · `mustVisitTimeForm.ts` | TRIP-296 | ✅ h05·h07 |
| `features/itinerary/ui/MustVisitPickerScreen.tsx` · `MustVisitTimeScreen.tsx` · `ItineraryGlyphs.tsx` | TRIP-296 | ✅ |
| `pages/itinerary-mustvisit/{index.ts, ui/MustVisitListPage.tsx, ui/MustVisitTimePage.tsx}` | TRIP-296 | ✅ |
| `app/trips/[tripId]/itinerary/must-visits/{index,[poiId]}.tsx` | TRIP-296 | ✅ |
| `shared/api/isAlreadyRegistered.ts` | TRIP-296 | ✅ 409 판정 공용 승격 |
| `__tests__/itineraryMustVisitStructure.test.ts` | TRIP-296 | ✅ |
| `app/(tabs)/itinerary.tsx` | — | **껍데기** — 아래 §1이 채운다 |

---

## 1. 라우트 (`src/app/`)

| 파일 | 화면 | 배럴 |
|---|---|---|
| `app/(tabs)/itinerary.tsx` | 탭 진입 — 활성 여행 일정으로 리다이렉트 / 없으면 빈 상태 + [여행 만들기] | `@/pages/itinerary-plan` |
| `app/trips/[tripId]/itinerary/method.tsx` | **h04** 시작 방법 | `@/pages/itinerary-method` |
| `app/trips/[tripId]/itinerary/must-visits/index.tsx` ✅ | **h05** | `@/pages/itinerary-mustvisit` |
| `app/trips/[tripId]/itinerary/must-visits/[poiId].tsx` ✅ | **h07** | 〃 |
| `app/trips/[tripId]/itinerary/generating.tsx` | **h09·h10** | `@/pages/itinerary-generating` |
| `app/trips/[tripId]/itinerary/draft.tsx` | **h11·h12·h35** | `@/pages/itinerary-draft` |
| `app/trips/[tripId]/itinerary/copick/index.tsx` | **h13** 컨셉 | `@/pages/itinerary-copick` |
| `app/trips/[tripId]/itinerary/copick/[slotKey].tsx` | **h14·h15·h18** | 〃 |
| `app/trips/[tripId]/itinerary/manual/index.tsx` | **h19** | `@/pages/itinerary-manual` |
| `app/trips/[tripId]/itinerary/manual/add.tsx` | **h20·h21** | 〃 |
| `app/trips/[tripId]/itinerary/index.tsx` | **h25·h26** (+h23·h29~h34 상태) | `@/pages/itinerary-plan` |
| `app/trips/[tripId]/itinerary/edit.tsx` | **h24** | `@/pages/itinerary-edit` |
| `app/trips/[tripId]/itinerary/history.tsx` | **h36** | `@/pages/itinerary-history` |
| `app/trips/[tripId]/itinerary/stay-suggest.tsx` | **h27** | `@/pages/itinerary-stay-suggest` |
| `app/trips/[tripId]/itinerary/reorder.tsx` | **h28** | `@/pages/itinerary-reorder` |

- **h23 핀 상세·h12 슬롯 교체는 라우트가 아니다** — 각각 지도 뷰·추천안 화면의 바텀시트.
- **h34 확정 읽기전용은 별도 라우트가 아니다** — `index`가 `status=CONFIRMED`일 때의 상태.
- ⚠️ `trips/**`는 `(tabs)` 밖이라 `SplashGate`의 `Stack.Protected` guard에 안 걸린다 — **미인증 딥링크로 열린다**(`stays/`·`trips/new/**` 선례, structure.md 경고). U3가 새로 만드는 라우트도 같은 조건이며, 데이터 노출은 서버 401이 막는다.
- **[구현 결정 · TRIP-354, 2026-08-14] h25·h26은 세그먼트가 아니라 단일 화면 상태다.** "화면" 칸의 h25·h26 병기는 예전엔 시간표/지도 두 세그먼트(토글로 전환)를 뜻했으나 그 토글을 폐기했다 — 아래 §2·§4의 소급 기록 참고.

## 2. `src/pages/` 슬라이스

| 슬라이스 | `ui/<Name>Page.tsx` | 배선 책임 |
|---|---|---|
| `itinerary-method` | `MethodPage` | `useItineraryGate()` → 선행 조건 판정 결과를 prop으로. 방식 선택 → 라우팅 |
| `itinerary-mustvisit` ✅ | `MustVisitListPage` · `MustVisitTimePage` | U1 API·규칙 인용(DEC-U3-7) |
| `itinerary-generating` | `GeneratingPage` | `useGenerationSession(tripId)` 폴링 → `DAY1_READY`면 부분 결과로 전환, 완료 시 `draft`로 replace |
| `itinerary-draft` | `DraftPage` | `useItineraryDraft()` + `resolveDraftState()` **판정 1회** → `DraftScreen`. 시트 열림은 로컬 상태 |
| `itinerary-copick` | `ConceptPage` · `SlotCandidatePage` | `useSlotCandidates(slotKey, radiusM, concept)` |
| `itinerary-manual` | `ManualPlanPage` · `PlaceAddPage` | 추가마다 `useValidateItinerary()` |
| `itinerary-plan` | `ItineraryPlanPage` | `useItinerary(tripId)` + `resolvePlanState()` **판정 1회**(로딩·오류·확정·지도 실패) → `TimelineScreen` 단일(지도 세그먼트/`MapScreen` 폐기 — [구현 결정 · TRIP-354, 2026-08-14] 아래 §4 참고) |
| `itinerary-edit` | `ItineraryEditPage` | 편집 스토어 ↔ PUT 저장(재검증은 PUT에 접힘 — [구현 결정 · TRIP-302, 2026-08-12]) |
| `itinerary-history` | `HistoryPage` | `useRevisions(tripId)` · 되돌리기 뮤테이션 |
| `itinerary-stay-suggest` | `StaySuggestPage` | `useStaySuggestion(itineraryId)` |
| `itinerary-reorder` | `ReorderComparePage` | 재생성 호출 + 전·후 비교 데이터 조립 |

> **판정은 페이지에서 1회.** `stay-search` 선례(`resolveStaySearchState`)를 따른다 — 화면(`ui/`)이 같은 판정을 다시 하지 않으며, 그 사실을 구조 가드가 잠근다.

## 3. `src/features/itinerary/model/` — 순수 함수 · 훅 · 스토어

| 파일 | 종류 | 책임 |
|---|---|---|
| `timeBandLabel.ts` ✅ | 순수 | 시간대 라벨(`오전·활동`) — BR-U3-07 |
| `slotKey.ts` ✅ | 순수 | `"{date}#{poiId}"` 조립·파싱 — BR-U2-04 |
| `mustVisitList.ts` ✅ · `mustVisitTimeForm.ts` ✅ | 순수 | h05·h07 |
| `generationGate.ts` | 순수 | BR-U3-01·02 — 숙소 0 / 지오코딩 실패 판정. **차단 사유 문자열까지 여기서** |
| `draftState.ts` | 순수 | `resolveDraftState()` — 폴백 배너 3신호(`isFallback`·`solveMode=MINIMAL`·`candidatesLevel=LOW`) 중 **심각도 최상위 1개만** 고르는 것 포함(BR-U3-11) |

> **[구현 결정 · TRIP-298, 2026-08-11] 파일·함수 이름 소급 기록 — 정본 공백.** 이 절이 가정하는 `draftState.ts`/`resolveDraftState()`는 실제로 `src/features/itinerary/model/draftView.ts`/`resolveDraftView()`로 구현됐다(TRIP-297). 판정 대상(`view`, 즉 화면이 어느 얼굴을 그릴지)에 이름을 맞춘 것이지, 이 절의 나머지 서술(폴백 배너 신호·판정 위치)이 틀렸다는 뜻은 아니다. TRIP-297·TRIP-298 선례와 같은 소급 기록 방식 — **요구사항 근거가 아니라 구현 결정의 기록**이다.
| `planState.ts` | 순수 | `resolvePlanState()` — 로딩·오류·`CONFIRMED` 읽기전용·지도 실패 폴백 |
| `legDistance.ts` | 순수 | 구간 표기 조립(`도보 950m`) + **총 이동거리 합산**. **소요시간 산출 함수를 두지 않는다**(INV-3) |
| `routeDiff.ts` | 순수 | h28 전·후 diff 분류(추가·삭제·이동) + 개선 없음 판정 |
| `openHoursWarning.ts` | 순수 | 서버가 준 영업시간·휴관 값의 **표시 형태만** 결정. 휴관 여부를 클라가 계산하지 않는다(BR-U3-09) |

> **[구현 결정 · TRIP-354, 2026-08-14] 휴관칩 트리거 = `openingHoursKnown === false` — CONFIRMED(h34)에서 구조적으로 안 뜬다.** 실제 트리거는 `slot.openingHoursKnown === false`(별도 `openHoursWarning.ts` 호출이 아니라 `TimelineScreen.tsx`가 이 값을 직접 읽음). 계약상 `openingHoursKnown`은 **CONFIRMED에서 항상 null**이라 h34(확정 읽기전용)에서는 휴관칩이 절대 뜨지 않는다 — PLANNED(h25, 아직 확정 전)에서 `openingHoursKnown===false`일 때만 뜬다. 다음 사이클이 h34 픽스처로 휴관칩 표시 AC를 세우면 영영 안 떠서 잘못된 green이 나온다는 것을 요구사항 근거가 아니라 이 사이클의 구현 확인으로 남긴다.
| `useItinerary.ts` | 훅 | `GET /trips/{tripId}/itinerary` |
| `useGenerationSession.ts` | 훅 | 생성 세션 폴링(day1 우선) |
| `useSlotCandidates.ts` | 훅 | `proposeSlotCandidates`(DEC-U3-5) |
| `useConfirmItinerary.ts` | 훅 | `POST /trips/{tripId}/itinerary/confirm` |
| `useRevisions.ts` | 훅 | h36 이력·되돌리기 |
| `itineraryEditStore.ts` | 스토어 | **UI 상태만** — 뷰 세그먼트(시간표/지도) · 편집 드래프트 · 시트 열림. **서버 응답을 복사하지 않는다** |

> **[구현 결정 · TRIP-302, 2026-08-12] `useValidateItinerary.ts` 제거 — 정본 정정.** h24 편집 저장(TRIP-302 슬라이스2)에서 재검증은 `PUT /trips/{tripId}/itinerary` 안에 접혀 있다(서버가 전체 교체 적용 후 재검증까지 한 번에 수행) — 별도 즉시 재검증 훅/호출을 만들지 않는다(위 line 73 배선 설명도 같은 결정으로 갱신). 이 절이 가정했던 편집 중 실시간 검증 훅은 실제로 구현되지 않았다. **미반영 관측**: line 71 `itinerary-manual`(h19~h21, 미착수)이 여전히 같은 이름을 참조하지만 이번 결정 범위 밖이라 손대지 않았다 — 그 화면은 추가마다 재검증하는 다른 성격의 흐름(전체 교체 아님)이라 같은 결정이 그대로 적용될지는 그 화면 착수 시 재확인 필요.

## 4. `src/features/itinerary/ui/` — 프레젠테이션

| 파일 | 화면 | 책임 (props만 받는다) |
|---|---|---|
| `ItineraryGlyphs.tsx` ✅ | — | 아이콘 |
| `MustVisitPickerScreen.tsx` ✅ · `MustVisitTimeScreen.tsx` ✅ | h05·h07 | |
| `MethodPickerScreen.tsx` | h04 | 3방식 카드 + `추천` 배지. 차단 시 CTA 비활성 + 사유(판정값은 prop) |
| `GeneratingScreen.tsx` | h09·h10 | 단계 텍스트·진행률·[백그라운드로]·[취소]. 부분 결과는 같은 화면의 상태 |
| `DraftScreen.tsx` | h11 | `DayTabs` · 슬롯 카드 · 추천 강도 세그먼트. **시각 렌더 금지**(BR-U3-07) — 고정 블록만 `21:00 도착 · 변경 불가` |
| `SlotCandidateSheet.tsx` | h12·h18 | 후보 목록(거리·이유) |
| `ZeroCandidateScreen.tsx` | h35 | **어느 조건이 0으로 만들었는지** + 완화 제안 |
| `RegenerateConfirmSheet.tsx` | — | "직접 바꾼 N곳이 사라져요"(BR-U3-18·19) |
| `ConceptPickerScreen.tsx` · `SlotFillScreen.tsx` | h13~h17 | 반경 확대는 **서버가 준 `radiusMUsed`를 표시만**(BR-U3-25) |
| `ManualPlanScreen.tsx` · `PlaceAddSheet.tsx` | h19~h21 | |
| `TimelineScreen.tsx` | h25·h26·h29~h34 | **검증 시각**(`09:30`) · 영업시간 · 휴관칩 · 구간 `도보 950m`/차량 + [길찾기](스텁) · **인라인 지도 글랜스(상시, `viewOnly`) + "지도 크게 보기"→h26 확대 오버레이(로컬 상태 `expanded`) — [구현 결정 · TRIP-354, 2026-08-14] 아래 참고** |
| ~~`MapScreen.tsx`~~ | — | **폐기([구현 결정 · TRIP-354, 2026-08-14])** — 별도 파일이 아니라 `TimelineScreen.tsx` 안의 확대 오버레이로 흡수됐다. 아래 참고 |
| `PinDetailSheet.tsx` | h23 | |
| `ItineraryEditScreen.tsx` | h24 | 위반 배지(저장 후에도 지속 — BR-U3-13) |
| `SaveConflictSheet.tsx` | — | [그대로 저장] 단일 갈래 — [AI 자동 보정] 갈래 제거([구현 결정 · TRIP-302, 2026-08-12], 티켓 결정 가 · BR-U3-14 repair 미충족). 시트 자체는 이 결정과 별개로 Figma 미설계라 TRIP-302에서는 이연(구현 안 됨) |
| `ReorderBanner.tsx` · `ReorderCompareScreen.tsx` | h25 배너·h28 | 배너에 **수치 단언 금지**(G-U3-1) |
| `StaySuggestScreen.tsx` | h27 | |
| `HistoryScreen.tsx` | h36 | actor 배지 · 상대 시각 · [되돌리기] · `기준 버전` 행 · empty. **`with-companions` 제외**(DEC-U3-8) |

> **[구현 결정 · TRIP-354, 2026-08-14] 인라인 지도 모델 — 세그먼트 토글 폐기, h26은 화면 내 확대 오버레이.** 이 문서(§1·§2·§4)는 원래 시간표(h25)/지도(h26)를 `SegmentButton`으로 전환하는 **두 세그먼트**로 서술했고(§4 옛 `MapScreen.tsx` 행), TRIP-301은 그 지도 세그먼트를 실지도(제스처+peekstrip+핀시트)로 채웠다. TRIP-354가 Figma 풀디자인 정합 과정에서 **세그먼트 토글 자체를 없앴다**(라이브 Figma h34가 지도를 상시 인라인으로 그림) — `SegmentButton`×2·`ViewSegmentValue`·`segment`/`onSegmentChange` prop·`itinerary-view-segment-*` testID를 전부 제거했다.
>
> **확정 동작**: 날짜탭 밑에 작은 지도 글랜스(`viewOnly=true`, 잠긴 미리보기)가 **상시** 뜬다. "지도 크게 보기" pill을 누르면 **같은 화면 안에서** 로컬 상태 `expanded`가 켜지고, TRIP-301이 만든 지도 표면(제스처 지도 `viewOnly=false` + `PoiSlotCard` peekstrip + `PinDetailSheet`)이 확대 오버레이로 뜬다. "닫기"로 `expanded=false` → 인라인 복귀. **새 라우트·새 세그먼트가 아니라 로컬 상태 하나**다 — `KakaoMapView`는 오버레이가 열렸을 때만 마운트되는 한 인스턴스(`map-root` 단수).
>
> `PoiSlotCard`(peek variant)는 고아가 아니다 — 이 오버레이의 peekstrip에서 계속 쓰인다. 인라인 글랜스(`viewOnly=true`)와 오버레이(`viewOnly=false`)라는 두 `KakaoMapView` 호출부는 `itineraryMapSurfaceStructure.test.ts`(S2④·S8)가 소스 태그 단위로 정확히 2개로 잠근다.
>
> **요구사항 근거가 아니라 구현 결정의 소급 기록**이다(TRIP-297·339·298·302 선례와 같은 형식) — 다음 사이클이 요구사항 근거로 인용하지 말 것.

## 5. `src/shared/` 변경

| 대상 | 변경 |
|---|---|
| `shared/map/KakaoMapView.tsx` | **확장 필요** — 다중 핀(번호)·폴리라인·center 갱신 미지원(U3 NFR 실측). itinerary와 execution(U4)이 함께 쓰므로 **처음부터 shared 소유** |
| `shared/ui/StateNotice.tsx` | 재사용 — 지도 실패·후보 0건·오류 상태 |
| `shared/api/generated/` | `itinerary` 태그 코드젠 추가 필요(`orval.config.ts` `filters.tags`) |

## 6. 구조 가드 (`src/__tests__/`)

| 파일 | 잠그는 계약 |
|---|---|
| `itineraryMustVisitStructure.test.ts` ✅ | 기존 |
| `itineraryDraftStructure.test.ts` | `DraftScreen.tsx`에 폴백 판정 분기가 **0건**(판정은 `draftState.ts` 한 곳) |

> **[구현 결정 · TRIP-298, 2026-08-11] 파일 이름 소급 기록.** `draftState.ts`는 실제로 `draftView.ts`다(위 §3 소급 기록과 같은 건). `itineraryDraftStructure.test.ts` 자체는 실재하며 TRIP-298에서 `ZeroCandidateScreen.tsx` 경로를 추가로 잠그도록 확장됐다.
| `itineraryTimeStructure.test.ts` | `ui/` 전 파일에 **소요시간 단위 문자열 0건**(`분`·`시간`이 이동 구간 문맥에 없음) — INV-3 |
| `itineraryDraftTimeStructure.test.ts` | `DraftScreen.tsx`가 **`startAt`·`endAt`을 렌더하지 않는다**(고정 블록 예외만) — BR-U3-07 |
| `pagesLayerStructure.test.ts` ✅ | 새 `itinerary-*` 슬라이스를 재귀 스캔이 자동 편입 |

## 7. 폼 검증 (UX 사본 — 권위는 서버)

| 대상 | 규칙 |
|---|---|
| 시각 조정(h24) | `HH:mm`, 자정 넘김 허용(`endsNextDay`). 서버 재검증이 최종 |
| 체류 시간 | 범위 안내만. 강제는 서버 |
| 반경(h15) | 서버가 준 `radiusMUsed` 표시만 — 클라 계산 금지 |

## 8. testID (규약 `{feature}-{screen}-{role}` · feature=`itinerary`)

```
itinerary-method-fullai · -copick · -manual · -gate-blocked
itinerary-generating-progress · -background · -cancel · -day1ready
itinerary-draft-strength-{min|balanced|max} · -day-{n} · -slot-{slotKey}
itinerary-draft-alt-{slotKey} · -fallback-banner · -zero · -zero-relax
itinerary-candidates-{poiId} · -radius-expand · -radius-used
itinerary-timeline-slot-{slotKey} · -openhours-{slotKey} · -closed-warning-{slotKey}
itinerary-leg-{fromSlotKey} · -directions-{fromSlotKey}
itinerary-view-timeline · -view-map · -map-fallback · -map-retry
itinerary-reorder-banner · -compare-apply · -compare-cancel · -no-gain
itinerary-edit-violation-{slotKey} · -save-conflict · -save-repair · -save-asis
itinerary-confirm-cta · -confirmed-edit
itinerary-history-{revisionId} · -restore-{revisionId} · -baseline · -empty
itinerary-mustvisit-{poiId} · -time-{poiId}       # U1 계열과 분리(G-U3-4)
itinerary-regenerate-confirm · -regenerate-proceed · -regenerate-cancel
```

> **[공백]** 제안값이다. 구현이 확정한 값이 다르면 **구현 시점에 이 절에 소급 기록**한다(TRIP-182·207·209 선례).

**[구현 결정 · TRIP-297, 2026-08-10] h11 초안(`itinerary-draft-*`) testID 13종 — 위 제안값(`-strength-{min|balanced|max}` · `-day-{n}` · `-slot-{slotKey}`)과 계열은 같으나 실제 확정 형태는 다르다.** 추천 강도 세그먼트(`-strength-*`)는 이 사이클 범위 밖이라 여전히 미확정 — 아래는 그 나머지, h11이 실제로 구현한 값이다. TRIP-182·207·209와 같은 소급 기록 방식을 따른다.

```
itinerary-draft-day-{n}                날짜 탭 (n = 여행 며칠째)
itinerary-draft-slot-{slotKey}         슬롯 카드 루트 (slotKey = buildSlotKey(day.date, slot.poiId))
itinerary-draft-slot-no-{slotKey}      번호 배지
itinerary-draft-slot-band-{slotKey}    시간대 라벨
itinerary-draft-slot-badge-{slotKey}   'AI 추천' 배지 (isFixed:false 에만)
itinerary-draft-slot-fixed-{slotKey}   고정 시각 표기 (isFixed:true 에만)
itinerary-draft-slot-image-{slotKey}   사진 (imageUrl 있을 때만)
itinerary-draft-slot-tags-{slotKey}    해시태그 줄 (tags 비어있지 않을 때만)
itinerary-draft-slot-name-{slotKey}    장소명 (nameKo 있을 때만)
itinerary-draft-stale-failed           부분 실패 배너
itinerary-draft-loading                진행 표시
itinerary-draft-failed                 전면 실패 얼굴
itinerary-draft-retry                  다시 시도 버튼
```

근거: `_workspace/20260809-trip297-itinerary-draft/02a_test-design_spec.md` §3.1(게이트①-1 승인 테스트가 이 이름들을 직접 집는다) — 요구사항 근거가 아니라 게이트①에서 확정한 구현 결정. 다음 사이클이 요구사항 근거로 인용하지 말 것.

**[구현 결정 · TRIP-297, 2026-08-10] 발명값 3건 — 정본에 근거가 없어 이 사이클이 직접 정한 값. 요구사항 근거로 인용 금지.**

1. **성격 축 라벨 미구현(시간 축만)** — Figma·티켓 모두 "시간대 + 성격"(예: `오전 · 활동`) 라벨을 보여 주지만, 성격 축(활동·식사·전시·숙소 등)을 `PoiCategory` 7종에 매핑하는 정본이 없다. 이 사이클은 시간 축(`오전`/`점심`/`오후`/`저녁`, `timeBandLabel`)만 구현하고 성격 축은 뺐다 — 근거: `_workspace/20260809-trip297-itinerary-draft/01b_ouroboros_seed.md` D4, TRIP-295가 이미 같은 이유로 범위 밖으로 남긴 자리.
2. **고정 블록 시각 절삭 `startAt.slice(0,5)`** — `isFixed:true` 슬롯의 시각 표기를 `"HH:mm:ss"` 문자열의 앞 5글자로 자르는 방식. 정본에 표시 포맷 규정이 없어 구현이 정함 — 근거: `_workspace/20260809-trip297-itinerary-draft/01b_ouroboros_seed.md` D5.
3. **폴링 간격 2초·상한 30회(약 60초)** — 2단계 생성(PARTIAL→COMPLETE) 폴링의 구체 수치. 정본은 "폴링한다"는 사실만 있고 간격·상한 수치는 없음 — 근거: `_workspace/20260809-trip297-itinerary-draft/01b_ouroboros_seed.md` "폴링 수치" 절("정본 부재 — 이 사이클의 발명값" 원문 명시).

**미반영(관측만)**: §6이 예고한 `itineraryDraftTimeStructure.test.ts`는 **소스 스캔으로 표현 불가**로 판명됐다 — 고정 블록 예외 때문에 소스에 `startAt`이 등장하는 것 자체가 정당해서다. 다음 유닛 설계 시 참고. 근거: `_workspace/20260809-trip297-itinerary-draft/02a_test-design_spec.md` ★13.

**[구현 결정 · TRIP-339, 2026-08-10] h05·h11 공용 지도 시각 계약 — 정본 공백 소급 기록.** 이 문서는 h11 testID 13종(위)만 소급했고, 핀·연결선·지도 고정 여부는 한 줄도 다루지 않았다(`01_spec-analyst_brief.md` §8 ④). h05·h11이 같은 지도 대본(`buildMapHtml`)을 쓰므로 여기 한 번에 적는다.

- **핀 마커** — 분홍(`#FF385C`) 채움 · 흰 테두리 2px · 흰 숫자(Inter Bold 13px, WebView 안에는 번들 폰트가 없어 `sans-serif`로 대체) · 물방울(원 지름 26 / 전체 28×36) · `yAnchor: 1`(꼬리 끝이 좌표를 가리킴).
- **연결선 — h11만, h05는 없음.** 흰 6px 케이싱 + 분홍 2.8px 본선의 2겹, 인접 쌍만 잇는다(전결합 아님). h05는 선을 안 그린다 — 핀 번호가 사용자가 **담은 순서**일 뿐 확정 동선이 아니라서다(연결선을 그리면 화면이 아직 안 정해진 동선을 정해진 것처럼 말하게 된다).
- **지도 고정(`viewOnly`)** — h05·h11만 옵트인. 나머지 화면(숙소 등록 3곳·거점 확정 1곳)은 좌표를 정하는 것이 기능 자체라 제외.

근거: Figma `1870:1083`(h11)·`1875:1094`(h05) 실측 · TRIP-339. **요구사항 근거가 아니라 구현 결정의 소급 기록**이다(TRIP-297 선례와 같은 형식) — 다음 사이클이 요구사항 근거로 인용하지 말 것.

## 9. PBT (`model/` 순수 함수 · fast-check)

`business-rules.md` §8 **PBT-U3-1~5**를 그대로 따른다 — 대상 파일은 `legDistance.ts`(합산) · `timeBandLabel.ts`(라벨 사영) · `routeDiff.ts`(diff 분류) · `slotKey.ts`(왕복) · `draftState.ts`(재생성 안전성).
