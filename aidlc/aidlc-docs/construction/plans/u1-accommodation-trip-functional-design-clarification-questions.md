# U1 Functional Design — Clarification Questions

> Q1~Q14 답변(2026-07-23 수령)을 분석한 결과, **모호한 답은 없으나 인셉션 산출물과 충돌하거나 스스로 모순되는 항목 3건 + 승인이 필요한 항목 1건**이 검출됐습니다. `functional-design.md` Step 5는 모순 해소 전 진행을 금지하므로 아래 4문항만 답해 주세요.

---

## 모순 1 — Q2=A의 `isBase` 플래그로는 **일자별 다중 거점**을 표현할 수 없음

Q2=A는 "`saved_stay` 하나에 `isBase`(거점) 플래그"입니다. 그런데 거점은 **숙소 하나의 속성이 아니라 (숙소 × 날짜구간) 관계**입니다:

- `US-STAY-07` 일자별 다중 거점 등록 — "날짜 구간이 겹치지 않으면 각 구간 거점 기준으로 일정 생성"
- `US-TRIP-06` 다중 숙소(구간 거점) · `US-TRIP-07` 다박 연속 지정 — "체크인~체크아웃 모든 숙박일에 동일 거점"
- 선재 dbml도 `saved_stay` / `base_assignment` / `trip_base_day` **3테이블**로 분리

불리언 플래그 하나면 "부산 1~2일차는 A호텔, 3~4일차는 B호텔"을 담지 못합니다. 화면(e04)이 단일 `거점` 배지만 보여주는 건 **단일 숙소 여행일 때의 표시**로 해석해야 정합합니다.

### Clarification Question 1
저장·거점 데이터 모델을 무엇으로 확정합니까?

A) **저장은 플래그, 거점은 관계** — `saved_stay`(저장 목록, 계정 귀속) + `base_assignment`(여행 × 숙소 × 날짜구간) + `trip_base_day`(날짜별 확정 거점). e04의 `거점` 배지는 "현재 여행에서 거점으로 쓰이는 중" 파생 표시. **Q2=A의 통합 UI는 유지하되 저장 구조만 관계형으로**

B) 문자 그대로 `isBase` 단일 플래그 — 1차는 **여행당 거점 1개**만 지원하고 US-STAY-07·US-TRIP-06·07(다중 거점)을 후속 유닛으로 이연(인셉션 스토리 3건 재배치 필요)

C) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## 모순 2 — Q8=B(차단형)가 `US-TRIP-06` 수용기준(비차단)과 정면 충돌

`US-TRIP-06` 정상 흐름은 명시적으로 **비차단**입니다: "공백·겹침 구간은 스마트 기본 거점(공백일=직전 숙소, 겹침=체크인 우선)으로 **미리 채우고** '이 날은 ○○ 기준 — 바꾸기' **비차단 안내**로 사후 수정하게 한다."
Q8=B는 "사용자에게 날짜별 primary를 고르게 함(**차단형** — 고를 때까지 일정 생성 불가)"입니다. 둘 다 참일 수 없습니다.

또한 Q8은 **겹침**만 물었는데, **공백일**(어느 숙소도 배정 안 된 날) 처리는 답이 없습니다.

### Clarification Question 2
겹침·공백 처리 방식을 확정해 주세요. (B/C를 고르면 `US-TRIP-06` 수용기준 문구 수정이 뒤따릅니다)

A) 겹침·공백 모두 **차단형** — 사용자가 날짜별 거점을 확정하기 전에는 일정 생성 불가. US-TRIP-06 수용기준을 차단형으로 개정

B) **겹침만 차단, 공백은 자동**(직전 숙소로 채움 + 비차단 안내) — 애매한 건만 묻는 절충. US-TRIP-06 수용기준을 부분 개정

C) 차단 지점을 **여행 생성이 아니라 AI 일정 생성 직전**으로 — 여행·거점 등록은 자유롭게 하고, 일정 생성 버튼을 누를 때 미해결 날짜가 있으면 그때 해결 시트를 띄움

D) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## 모순 3 — Q4=B가 **컴포넌트-유닛 경계(C7 = U3)**를 넘음

Q4=B는 "`poi`·`poi_snapshot`과 정규화 규칙까지 U1에서 확정"입니다. 그런데 인셉션 `components.md`에서 **C7 Place Data = 모듈 7 · U3 소속 · RAG 게이트 소유자**이고, `unit-of-work.md`는 U1 = C3·C4·C5·C6로 못 박혀 있습니다. 또한 **INV-1**(LLM은 폐쇄 후보풀에서만 선택, 웹 POI는 수집 게이트 통과 후 place-data에 등록)이 C7의 책임입니다.

### Clarification Question 3
U1이 가져오는 범위를 어디까지로 합니까?

A) **스키마·정규화만 U1** — `poi`·`poi_snapshot` 테이블과 표준화 규칙은 U1이 확정(탐색·담기·필수방문지가 당장 필요로 하므로). **수집 게이트·RAG 후보풀·INV-1 집행은 C7(U3)이 그대로 소유**하고 U1이 만든 스키마 위에 얹음 → 인셉션은 "C7의 데이터 스키마를 U1이 선행 정의" 주해만 추가

B) **C7 자체를 U1로 이동** — Place Data 컴포넌트를 U1 소속으로 재배정. `unit-of-work.md`·`unit-of-work-dependency.md`·`story-map`을 개정(U3는 C8 Itinerary Generation만 보유)

C) Other (please describe after [Answer]: tag below)

[Answer]: B

---

## 승인 요청 — 인셉션 산출물 수정 (완료 스테이지)

인셉션은 2026-07-13에 승인 완료된 단계라, `common/workflow-changes.md` §4에 따라 **명시적 승인 없이는 수정할 수 없습니다.** 위 답변들이 확정한 수정 목록입니다(U0 설계 산출물은 영향 없음):

| ID | 파일 | 수정 내용 | 근거 |
|---|---|---|---|
| I-1 | `user-stories/stories.md` | US-STAY-01·02의 "대표 가격대(정적 구간)" → **"최저가 스냅숏(부터 가격)"**, 정렬 축 "대표 가격대순" → "최저가순" | Q11=A |
| I-2 | `stories.md` 또는 `story-map` | US-SHELL-03의 "여행자 일정 3진입"에 **"1차는 자리만, 실데이터는 U7"** 주해 | Q13=A |
| I-3 | `stories.md` + `story-map` + `unit-of-work` | **US-EXPL-\* 신규 스토리**(탐색 랜딩 d01 · 목적지 상세 d03 · 지역 선택 d1b/e00)를 U1에 추가 → 총 스토리 수 119 → N 갱신 | Q12=A |
| I-4 | `requirements/requirements.md` | FR-STAY-03 "등록 **2경로**" → **3경로**(검색 · URL 파싱 · 핀 지정). "예약번호·메일 자동 인식 없음"은 유지 | Q6=A |
| I-5 | `application-design/*` | C7 Place Data 경계 주해 또는 유닛 재배정 | CQ3 답변에 따름 |
| I-6 | `stories.md` | US-TRIP-06 거점 커버리지 비차단 → 차단 문구 개정 | CQ2 답변에 따름 |
| I-7 | (인셉션 아님) `backend/docs/design/전체-API-서피스.md` | "위시리스트 1차 제외"는 **FR-STAY-01 위반** → 철회. 이건 팀 소유 문서라 별도 협의 | Q2=A |

### Clarification Question 4
인셉션 수정을 어떻게 처리합니까?

A) **지금 일괄 수정** — 위 I-1~I-6을 이번 세션에서 반영하고(수정 전 원본은 git으로 추적), audit.md에 변경 기록을 남긴 뒤 U1 산출물 생성으로 진행

B) **갭으로만 기록하고 진행** — 인셉션은 손대지 않고 U1 설계 문서에 갭 표(G-U1-\*)로만 남긴 뒤, 인셉션 개정은 별도 시점에 일괄 처리

C) **인셉션 스테이지 정식 재개** — Requirements Analysis / User Stories / Units Generation 단계를 규칙대로 다시 열어 승인 게이트를 거침(가장 무겁지만 절차상 가장 안전)

D) Other (please describe after [Answer]: tag below)

[Answer]:
