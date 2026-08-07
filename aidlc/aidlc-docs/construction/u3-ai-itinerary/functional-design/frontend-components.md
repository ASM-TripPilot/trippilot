# U3 AI Itinerary Generation — Frontend Components

> **아키텍처 정본 = `frontend/README.md`.** 층 구조·폴더 규약을 여기 옮겨 적지 않는다 — 사본은 갈라진다. 이 문서가 정하는 것은 **컴포넌트의 책임·상태·서버 연동**이다. 스택(TanStack Query=서버 상태 · Zustand=UI 상태 · RHF+Zod=폼 · NativeWind)과 testID 규약 `{feature}-{screen}-{role}`도 그 정본을 따른다.
> **화면 정본**: 라이브 Figma 밴드 h. **`h25`(시간표)·`h26`(지도)가 완성 일정 정본**이고 `h29~h33`은 상태·변형의 **동작·문구만** 취한다(DEC-U3-6).
> **현 상태**: `src/app/(tabs)/itinerary.tsx`는 빈 셸(`<Text>일정</Text>`) — 이 유닛이 처음 채운다.

---

## 1. 라우트 골격 (U3가 추가하는 부분)

| 라우트 | 화면 | 비고 |
|---|---|---|
| `(tabs)/itinerary.tsx` | 탭 진입 | 활성 여행 일정으로 리다이렉트 / 없으면 빈 상태 + [여행 만들기] |
| `trips/[tripId]/itinerary/method` | **h04** 시작 방법 | 3방식 카드 |
| `trips/[tripId]/itinerary/must-visits` | **h05** 필수 방문지(선택) | 데이터는 U1(`must_visit`) — DEC-U3-7 |
| `trips/[tripId]/itinerary/must-visits/[poiId]` | **h07** 방문 시각 지정 | 〃 |
| `trips/[tripId]/itinerary/generating` | **h09·h10** 생성 중 / 부분 결과 | 세션 폴링 |
| `trips/[tripId]/itinerary/draft` | **h11·h12·h35** 추천안 · 슬롯 교체 · 후보 0건 | h12는 바텀시트 |
| `trips/[tripId]/itinerary/copick` | **h13** 컨셉 | |
| `trips/[tripId]/itinerary/copick/[slotKey]` | **h14·h15·h18** 후보 선택 · 반경 넓힘 · 옵션 교체 | 같은 화면의 상태 |
| `trips/[tripId]/itinerary/manual` | **h19** 빈 일정 | |
| `trips/[tripId]/itinerary/manual/add` | **h20·h21** 검색 · 주변 탐색 | 세그먼트 2탭 |
| `trips/[tripId]/itinerary/index` | **h25·h26** 완성 일정 (+ h29~h34 상태) | **시간표\|지도 세그먼트가 같은 라우트** |
| `trips/[tripId]/itinerary/edit` | **h24** 일정 편집 | |
| `trips/[tripId]/itinerary/history` | **h36** 변경 이력 | 4변형 중 `with-companions` 제외(DEC-U3-8) |
| `trips/[tripId]/itinerary/stay-suggest` | **h27** 동선 기준 숙소 추천 | US-SCHED-11 |
| `trips/[tripId]/itinerary/reorder` | **h28** 동선 다시 정리(전·후) | 재생성 결과 비교(BR-U3-21) |

- **h23 핀 상세는 라우트가 아니다** — 지도 뷰의 바텀시트.
- **h34 확정 읽기전용은 별도 라우트가 아니다** — `index`가 `status=CONFIRMED`일 때의 상태.

## 2. 생성 진입·방식 (h04·h05·h07)

| 컴포넌트 | 책임 | 상태 / 서버 |
|---|---|---|
| `MethodPicker` | 3방식 카드 + `추천` 배지("AI와 같이 짜기"). 하단 "세 방법은 언제든지 서로 전환할 수 있어요" | 로컬 선택 → 라우팅 |
| `GenerationGate` | 선행 조건 검사(BR-U3-01·02) — 숙소 0이면 CTA 비활성 + 사유, 지오코딩 실패면 지도 지정 요청 | `GET /trips/{id}` 앵커 |
| `MustVisitPicker` | 필수 방문지 선택(h05) · 시각 지정(h07) | **U1 API·규칙 인용** — 새 계약 만들지 않음 |

> **G-U3-3 반영**: 스토리가 요구한 "예상 소요·인터랙션 양"은 라이브 카드에 **없다**. 라이브를 정본으로 삼아 **넣지 않는다**.
> **G-U3-4 반영**: `MustVisitPicker`의 testID는 U1의 `trip-wizard-mustvisit-*` 계열을 **재사용하지 않는다** — 화면이 달라 셀렉터가 충돌한다. `itinerary-mustvisit-*`로 분리하되 **API·검증 규칙은 U1 정본을 그대로 따른다.**

## 3. 생성 진행 (h09·h10)

| 컴포넌트 | 책임 | 상태 / 서버 |
|---|---|---|
| `GeneratingScreen` | 단계 텍스트 · 진행률 · **[백그라운드로]** · **[취소]** | `GenerationSession` 폴링. `DAY1_READY`면 `PartialResult`로 전환 |
| `PartialResult` | 1일차만 노출 + "나머지를 채우는 중" | 완료 시 `draft`로 자동 전환 |
| `FallbackBanner` | `isFallback` / `solveMode=MINIMAL` / `candidatesLevel=LOW` 각각의 문구 | **BR-U3-11 — 침묵 금지.** 세 신호가 동시에 오면 심각도 높은 것 하나만 |

## 4. 추천안 (h11·h12·h35)

| 컴포넌트 | 책임 | 상태 / 서버 |
|---|---|---|
| `DraftHeader` | "취향·거리로 채운 추천안이에요" + 우상단 **[직접 고르기]**(방식 전환, 진행분 보존 — BR-U3-06) | |
| `StrengthSegment` | `최소 \| 균형 \| 많이` | **재생성 트리거**(BR-U3-22) — 변경 시 `RegenerateConfirm` 경유 |
| `DayTabs` | `1일차 / 2일차` + 날짜 헤더(`6월 10일 · 화`) + `N곳` | |
| `RouteMap` | OSM/CARTO 타일 + 번호 핀 + 동선 폴리라인 | 실패 시 지도 자리만 폴백(h31 문구 재사용) |
| `DraftSlotCard` | 번호 · 사진 · **시간대 라벨**(`오전·활동`) · `AI 추천` 배지 · 장소명 · 해시태그 + 거리 · **[다른 후보 N]** | **시각 렌더 금지**(BR-U3-07·INV-U3-07). 고정 블록만 시각 표시(`21:00 도착 · 변경 불가`) |
| `SlotCandidateSheet` | h12 — 후보 목록(거리·이유), 선택 시 교체 | `proposeSlotCandidates`(DEC-U3-5) |
| `ZeroCandidateScreen` | h35 — **어느 조건이 0으로 만들었는지** 표시 + 완화 제안 | US-SCHED-02 예외 |
| `RegenerateConfirm` | "직접 바꾼 N곳이 사라져요" 확인 | **BR-U3-18·19** — 확인 후 리비전 스냅숏 → `generate` |

## 5. 같이 고르기 · 직접 (h13~h21)

| 컴포넌트 | 책임 | 비고 |
|---|---|---|
| `ConceptPicker` | h13 컨셉(테마) 선택 | `concept` 파라미터 |
| `SlotCandidateList` | h14·h18 — 후보 카드(거리 `도보 1.1km`·이유) | `proposeSlotCandidates` |
| `RadiusExpander` | h15 — 후보 0/부족 시 반경 확대. **응답 `radiusMUsed`를 표시**(`약 11.3km`) | BR-U3-25 |
| `SlotFillPreview` | h16 — 채운 뒤 동선 갱신 미리보기 | |
| `EmptyItinerary` | h19 — 빈 일정 + [장소 추가] | |
| `PlaceAddSheet` | h20 검색 / h21 주변 — 세그먼트 2탭 | U1 후보풀 소비 · 추가마다 `validate` |

## 6. 완성 일정 · 편집 · 확정 (h23~h34)

| 컴포넌트 | 책임 | 상태 / 서버 |
|---|---|---|
| `ItineraryHeader` | `부산 여행 · 3박 4일` / `총 9곳 · 이동 12km` + 공유 · 더보기 | 합계는 **클라 계산** |
| `ViewSegment` | **시간표 \| 지도** 전환 — 같은 데이터, 한쪽 수정 즉시 반영 | UI 상태(Zustand) |
| `TimelineSlotCard` | **검증 시각**(`09:30`) · 시간대 라벨 · 장소 · **영업시간**(`09:00–21:00 영업`) · **`⚠︎ 월요일 휴관`** 경고 | 영업시간은 **backend 합성**(BR-U3-09) |
| `LegRow` | 구간 — `도보 950m` / `차량 3.1km` + **[길찾기]**(외부 지도앱) | **소요시간 금지**(BR-U3-08) |
| `ReorderBanner` | h25 배너 — "동선을 더 짧게 정리해볼까요?" → `reorder` | **수치 단언 제거**(G-U3-1) |
| `ReorderCompare` | h28 전·후 비교 + [적용]/[취소]. 개선 없으면 "지금 동선이 이미 짧아요" | **클라 계산**(BR-U3-21·20) |
| `MapView` + `PinDetailSheet` | h26 지도 + h23 핀 상세(슬롯 선택) | h32 스크러버는 지도 뷰의 옵션 동작 |
| `MapFallback` | h31 — "지도를 불러오지 못했어요" + 시간표형 폴백 | 일정 데이터는 정상 제공 |
| `EditScreen` | h24 — 추가·삭제·재정렬·시간 조정 | 변경마다 `validate`(비차단) |
| `ViolationBadge` | 위반 배지 + 사유 | 저장 후에도 지속 가시화(BR-U3-13) |
| `SaveConflictSheet` | "○곳에서 시간이 안 맞아요" → **[AI 자동 보정] / [그대로 저장]** | `repair` |
| `ConfirmCta` | **[일정 확정하기]** → 확정 의미 한 줄 안내 | `POST /confirm`. 스냅숏 동결 실패 시 거부(BR-U3-27) |
| `ConfirmedView` | h34 읽기전용 + D-day·출발 맥락 + **[일정 수정]** | 수정 시 `CONFIRMED → PLANNED`(BR-U3-29) |
| `StaySuggestScreen` | h27 — 권역 지도 + 후보(평균 이동 거리 순, before/after 거리) | US-SCHED-11 |

## 7. 변경 이력 (h36)

| 컴포넌트 | 책임 | 비고 |
|---|---|---|
| `HistoryList` | "바꾼 내용은 언제든 되돌릴 수 있어요" + 항목(actor 배지 `나`/`AI` · 상대 시각 · 요약 · 상세 칩 · **[되돌리기]**) | `ItineraryRevision` |
| `BaselineRow` | 최하단 `AI가 처음 짠 일정` + **`기준 버전`** 배지 — 되돌리기 없음 | `kind=BASELINE` |
| `RestoreConfirm` | 되돌리기 확인 | **새 리비전을 쌓는다**(BR-U3-32) |
| `HistoryEmpty` | 변경 없음 상태 | h36-empty |

- **1차 미구현**: `with-companions` 변형(DEC-U3-8) · Plan-B 재계획 항목(U4 착수 후 합류, G-U3-2).

## 8. 폼 검증 (UX 사본 명세 — 권위는 서버)

| 대상 | 규칙 |
|---|---|
| 시각 조정(h24) | `HH:mm`, 자정 넘김 허용(`endsNextDay`). 서버 재검증 결과가 최종 |
| 체류 시간 | 최소·권장·최대 범위 안내만. 강제는 서버 |
| 반경(h15) | 서버가 준 `radiusMUsed`를 표시만 — 클라가 임의 값 계산 금지 |

## 9. testID (규약 `{feature}-{screen}-{role}` · feature=`itinerary`)

```
itinerary-method-fullai · -copick · -manual · -gate-blocked
itinerary-generating-progress · -background · -cancel · -day1ready
itinerary-draft-strength-{min|balanced|max} · -day-{n} · -slot-{slotKey}
itinerary-draft-alt-{slotKey}          # [다른 후보 N]
itinerary-draft-fallback-banner · -zero · -zero-relax
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

> **[공백]** 위 목록은 화면 정본에서 유도한 **제안값**이다. U1 선례(TRIP-182·207·209)처럼 실제 구현이 확정한 값이 다르면 **구현 시점에 이 절에 소급 기록**한다.

## 10. PBT 대상 (클라이언트 순수 함수 · fast-check)

`business-rules.md` §8의 **PBT-U3-1~5**를 그대로 따른다 — 총 이동거리 합산 · 시간대 라벨 사영 · 전·후 diff 분류 · `slotKey` 왕복 · 재생성 안전성.
