# U3 AI Itinerary Generation — Business Logic Model

> **범위**: C8 Itinerary Generation(생성 오케스트레이션). 솔버·LLM은 **U2 경계 뒤**(재서술 금지), POI 정본·후보풀은 **U1/C7 소유**.
> **전제**: U2 산출물(2026-08-07 승인) — 경계 계약 + BR-U2-01~16. 특히 `slotKey` 규약(BR-U2-04) · `solveMode`↔`isFallback` 매핑(BR-U2-03) · 거리 표시(BR-U2-08) · explanations 문구 제약(BR-U2-09)은 이 유닛의 전제다.
> **화면 정본**: 라이브 Figma 밴드 h(2026-08-07 관측, 33프레임). 드리프트 대조표는 `plans/u3-ai-itinerary-functional-design-plan.md`.

---

## 1. 결정 (질문 Q1~Q9 → DEC-U3-1~9)

| ID | 결정 | 근거 |
|---|---|---|
| **DEC-U3-1** | **변경 이력은 U3가 "일정 편집 이력"만 소유.** 되돌리기 대상 = 사용자 편집 + AI 생성 기준 버전. Plan-B 재계획 이력 = **U4**, 여행 후 아카이브 change-log = **U5(C12)**, `with-companions` = **1차 제외** | Q1=A. 화면(h36)은 하나지만 데이터 소유는 컴포넌트 경계를 따른다 |
| **DEC-U3-2** | **동선 재정렬은 `generate` 재호출로 구현.** U2 `recalculate`는 **개통하지 않는다**(U4 Plan-B 몫으로 유지). 전·후 비교(h28)는 **클라이언트 계산** | Q2=B |
| **DEC-U3-3** | **시각 노출은 단계별로 다르다.** 초안(h11·h17)은 **시간대 라벨만**, 완성·확정(h25·h26·h34)은 **검증 시각**. 고정 블록(숙소·시각 고정 필수 방문지)은 초안에서도 시각 노출 | Q3=A. 초안 시각은 슬롯 교체마다 흔들려 신뢰를 깎는다. 안 보여주는 것은 INV-2 위반이 아니다 |
| **DEC-U3-4** | **추천 강도(`최소·균형·많이`) 변경 = 재생성 트리거.** 클라이언트 필터가 아니다 | Q4=A. 밀도는 서버(솔버 목적함수)가 소유 |
| **DEC-U3-5** | **`proposeSlotCandidates` 개통** — 완전 AI·같이 고르기 **공통 경계**. U2 미결 O-U2-3 종결 | Q5=A. 라이브에서 완전 AI 경로(h11 "다른 후보 3", h12)에도 슬롯 교체가 존재 |
| **DEC-U3-6** | **완성 일정 정본 = `h25`(시간표)·`h26`(지도).** `h29~h33`은 상태·변형(폴백·스크러버)의 **동작·문구만** 취한다 | Q6=A. U1 선례와 동형 |
| **DEC-U3-7** | **필수 방문지: 데이터=U1(C6 `must_visit`) / 화면=U3.** U3는 화면만 정의하고 API·규칙은 U1 정본을 인용 | Q7=A |
| **DEC-U3-8** | **공동편집(`with-companions`) 1차 제외** | Q8=A. 후속 게이트 원칙 유지 |
| **DEC-U3-9** | **영업시간·휴관 경고는 backend 합성** — `poiId`로 C7 정본 조회해 붙인다. 경계 응답 확장 0 | Q9=A. POI 정본 단일 소유 유지 |

### 1.1 DEC-U3-2·4가 함께 만드는 결과 — "재생성 계열" 공통 절차

Q2=B와 Q4=A는 둘 다 **`generate` 재호출**로 귀결된다. 재생성은 새 일정을 만들므로 **사용자 편집분이 사라진다.** 따라서 두 동작을 하나의 절차로 묶는다.

```
재생성 계열 동작 = { 추천 강도 변경, 동선 정리, 명시적 재생성 }
  1. 편집분이 있으면 확인 대화 — "직접 바꾼 N곳이 사라져요"
  2. 재생성 직전 현재 일정을 이력에 스냅숏(DEC-U3-1의 편집 이력 = 되돌리기 지점)
  3. generate 재호출
  4. 결과 채택 여부는 사용자가 결정 (동선 정리는 전·후 비교 후 [적용]/[취소])
```

> **⚠️ 갭 G-U3-1**: `h25` 배너는 **"동선 정리하면 3.2km → 2.4km / 이동 거리 25% 감소"** 라고 **재생성 전에 수치를 단언**한다. DEC-U3-2(재생성 방식)에서는 **돌려보기 전에는 그 수치를 알 수 없다.** 처리 = 배너 문구에서 수치를 빼고(예: "동선을 더 짧게 정리해볼까요?") 수치는 **결과 화면(h28)에서만** 제시한다. 재생성 결과가 더 나쁘거나 같으면 "지금 동선이 이미 짧아요"로 안내하고 **원본을 유지**한다. 디자인 협의 필요.

---

## 2. 생성 3방식 플로우

### F-U3-1 · 진입과 방식 분기 (h04 · US-SCHED-10)

```
여행 생성 완료(U1) 또는 일정 탭 → [일정 만들기]
  → 선행 조건 검사
      · 등록 숙소 0 → 생성 차단 + 안내 (US-SCHED-01 예외)
        예외: "숙소 나중에" 온램프(US-SCHED-11) 진입은 허용
      · 지오코딩 실패 앵커 존재 → 지도 지정 요청 후 보류
  → h04 방식 선택: [완전 AI가 짜기] · [AI와 같이 짜기(추천)] · [직접 짜기]
  → 방식은 언제든 전환 가능(진행분 보존 — BR-U3-06)
```

### F-U3-2 · 완전 AI (h09 → h10 → h11 · US-SCHED-01·02·05·09)

```
generate 호출 (U2 경계 · deadlineMs = day1 5,000ms)
  ├─ h09 로딩: 단계 텍스트·진행률·[백그라운드로]·[취소]
  ├─ day1ReadyAt 도달 → h10 "부분 결과 먼저 보기" (1일차만 노출, 나머지 채우는 중)
  └─ 완료 → h11 추천안
       · 시간대 라벨만 표시(DEC-U3-3) · 슬롯별 [다른 후보 N] · 고정 배지
       · 추천 강도 세그먼트(재생성 트리거 — DEC-U3-4)
       · isFallback=true → "일부 추천이 기본 모드로 생성됐어요" 배너 (INV-4, 침묵 금지)
       · candidatesSummary.level=LOW → "일부 추천이 빠졌어요" (h35 후보 0건은 별도 화면)
```

### F-U3-3 · 같이 고르기 (h13~h18 · US-SCHED-10)

```
h13 컨셉 선택 → 슬롯별 반복 {
    proposeSlotCandidates(slotKey, radiusM, concept)   ← DEC-U3-5 신설 경계
      → h14 테마 후보(도보 1.1km 등 거리 표기)
      → 후보 0건 또는 부족 → h15 반경 넓힘(약 11.3km) 재조회 · 컨셉 변경 제안
      → 선택 → h16 슬롯 채우기(동선 갱신)
  } → h17 완성 → (h11과 같은 초안 계약으로 합류)
h18 옵션 교체 = 채운 뒤 같은 슬롯 다른 후보로 교체 (같은 경계 재호출)
```

### F-U3-4 · 직접 짜기 (h19~h21 · US-SCHED-10)

```
h19 빈 일정 → [장소 추가]
  ├─ h20 검색(U1 C7 후보풀 소비)
  └─ h21 주변 탐색(현재 슬롯 기준 반경)
  → 추가할 때마다 validate 재검증 → 위반 배지 표시(차단 없음)
```

### F-U3-5 · 편집·재검증 (h23·h24 · US-SCHED-07)

```
h24 편집: 추가·삭제·재정렬·시간 조정 / h23 핀 상세에서 슬롯 선택
  → 변경마다 validate(U2 경계) → violations 배지·사유 표시, 변경은 차단하지 않음(BR-U2-12)
  → 저장 시 위반 있으면 "○곳에서 시간이 안 맞아요"
       [AI 자동 보정] → repair(TIME_SHIFT_ONLY · POI 불변)
       [그대로 저장]  → 위반 블록 지속 가시화
```

### F-U3-6 · 완성·확정 (h25·h26·h34 · US-SCHED-06·08·12)

```
h25 시간표 ⇄ h26 지도 (같은 데이터 2뷰 · 한쪽 수정 즉시 반영)
  · 슬롯: 검증 시각 + 영업시간(backend 합성 · DEC-U3-9) + 휴관 경고
  · 구간: 거리 + 이동수단 + [길찾기](외부 지도앱 위임) — 소요시간 미표시(INV-3)
  · 지도 실패 → h31 폴백("지도를 불러오지 못했어요") · 일정 데이터는 정상 제공
  → [일정 확정하기] → h34 읽기전용(PLANNED → CONFIRMED 단방향 잠금)
  → 확정 후에도 [일정 수정]으로 재편집 가능(CONFIRMED → PLANNED 복귀는 BR-U3-09)
```

### F-U3-7 · 숙소 나중 등록 (h27·h28 · US-SCHED-11)

```
숙소 없이 생성된 일정 → [동선 기준 숙소 추천]
  → 방문지 무게중심·평균 이동 거리로 권역 추천(h27, 지도)
  → 후보를 평균 이동 거리 순 + before/after 거리로 제시
  → 등록(U1 C4) → 그 숙소를 출발·복귀 기준으로 재생성(DEC-U3-2와 같은 절차)
숙소 없는 날(당일치기·이동일)은 숙소 없이 동선만으로 유지
```

---

## 3. U2 경계 소비 지점

| 화면·동작 | 경계 메서드 | 비고 |
|---|---|---|
| 최초 생성 · 추천 강도 변경 · 동선 정리 · 숙소 등록 후 재정렬 | `generate` | **모두 같은 메서드**(DEC-U3-2·4). 재생성 계열 공통 절차(§1.1) 적용 |
| 편집 중 재검증 | `validate` | 비차단(BR-U2-12) |
| [AI 자동 보정] | `repair` | `TIME_SHIFT_ONLY`·POI 불변 |
| [다른 후보 N] · 같이 고르기 후보 · 반경 넓힘 | **`proposeSlotCandidates`** | **DEC-U3-5 신설** — §3.1 |

### 3.1 `proposeSlotCandidates` 계약 (신설 · U2 소급)

```kotlin
fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput

data class SlotCandidatesInput(
    val tripId: UUID,
    val slotKey: String,          // BR-U2-04 규약 "{date}#{poiId}" · 빈 슬롯이면 date + 순번 기준
    val neighborSlotKeys: List<String>,  // 직전·직후 슬롯(동선 트레이드오프 계산 입력)
    val radiusM: Int?,            // null = AI 기본 반경. h15 "반경 넓힘"이 이 값을 올린다
    val concept: String?,         // h13 컨셉(테마) — null 허용
    val excludePoiIds: List<UUID>,// 이미 일정에 있는 POI 재추천 방지
    val requestMeta: RequestMeta,
)

data class SlotCandidatesOutput(
    val candidates: List<SlotCandidate>,  // 빈 리스트 = 후보 0건(h15 반경 확대 유도)
    val radiusMUsed: Int,                 // 실제 사용 반경(AI가 자동 확대했을 수 있음)
    val freshness: FreshnessMeta,
)

data class SlotCandidate(
    val poiId: UUID,
    val distanceRange: String,   // "도보 1.1km" — 거리만(INV-3, BR-U2-08)
    val rationale: String,       // closed-set 근거(시각·소요시간 언급 금지, BR-U2-09)
)
```

- **INV-1 유지**: 후보는 AI가 U1 후보풀에서 고른 closed-set 결과. backend가 임의 POI를 섞지 않는다.
- **INV-2 유지**: 교체 후 시각은 **교체 결과를 `validate`(또는 재생성)로 확정**하기 전에는 노출하지 않는다. 초안 단계라 시간대 라벨만 보이므로(DEC-U3-3) 자연히 지켜진다.
- **U2 문서 소급 필요**: `business-logic-model.md` §7(미개통 2건)에서 `proposeSlotCandidates` 행 제거 + `business-rules.md` O-U2-3 종결. `recalculate`는 **미개통 유지**(DEC-U3-2).

---

## 4. 폴백·실패 표시 (US-SCHED-09 · INV-4)

| 경계 신호 | 화면 표시 | 화면 |
|---|---|---|
| `isFallback=true`, `solveMode=DETERMINISTIC` | "일부 추천이 기본 모드로 생성됐어요" 배너 | h10·h11 |
| `solveMode=MINIMAL` | 최소 일정(앵커 + 시각 고정 필수 방문지만) + [다시 시도] | h11 축소형 |
| `candidatesSummary.level=LOW` | "일부 추천이 빠졌어요" | h11 |
| 후보 0건 | 조건 완화 제안(어느 조건이 0으로 만들었는지 표시) | **h35** |
| 지도/경로 API 실패 | 시간표형 폴백 + "지도를 불러오지 못했어요" | **h31** |
| 저장 중 네트워크 오류 | 로컬 임시 보관 + "저장 대기 중" → 재연결 시 자동 동기화 | h25 |
| AI 경계 전면 실패 | backend 바깥 겹 `MinimalItineraryFallback` | h11 축소형 |

**침묵 실패 금지**: 위 어느 경로도 "그냥 성공한 것처럼" 보이지 않는다.

---

## 5. 갭

| ID | 갭 | 처리 |
|---|---|---|
| **G-U3-1** | `h25` 동선 정리 배너가 재생성 전에 "3.2km → 2.4km" 수치를 단언 — DEC-U3-2에서는 산출 불가 | 문구에서 수치 제거 + 결과 화면에서만 제시. **디자인 협의 필요** |
| **G-U3-2** | `h36` 변경 이력이 4개 유닛 데이터를 한 화면에 — U3는 편집 이력만 소유(DEC-U3-1) | 화면은 U3가 그리되 Plan-B 항목은 U4 착수 후 합류. `with-companions`는 1차 미구현 |
| **G-U3-3** | `h04` 방식 카드에 스토리가 요구한 **예상 소요·인터랙션 양**이 없음 | 라이브 우선(U1 Q1=D 선례) — 스토리 문구를 라이브에 맞춰 읽는다. 인셉션 개정은 별도 승인 |
| **G-U3-4** | `h05`·`h07`(필수 방문지)이 U1 데이터·U3 화면으로 갈림 | DEC-U3-7. U1 `frontend-components.md`의 `trip-wizard-mustvisit-*` 와 **testID 계열이 갈라지지 않도록** §frontend-components에서 재사용 여부 명시 |
| **G-U3-5** | 결번 `h01·h02·h03·h06·h08·h22` — 원래 있었는지 미확인. `h22map`이 밴드 d `d06-장소 상세` 자식에 잔존 | 화면 누락 아님으로 판단(있는 것만 센다). `h22map` 이름 오탈은 디자인 정리 사안 |
| **G-U3-6** | 확정(CONFIRMED) 후 재편집 시 상태 전이가 도메인에 없음 — `ItineraryStatus`는 PLANNED→CONFIRMED **단방향** | BR-U3-09에서 결정 |
| **G-U3-7** | `explanations` 영속 경로 부재(U2 O-U2-2) — h11 "AI 추천" 배지·추천 이유가 저장 안 되면 재진입 시 사라짐 | backend 마이그레이션 필요(U2 미결 승계) |
