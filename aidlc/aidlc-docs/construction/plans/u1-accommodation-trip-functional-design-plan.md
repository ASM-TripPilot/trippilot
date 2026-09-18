# U1 Accommodation & Trip Setup — Functional Design Plan

> **유닛**: U1 Accommodation & Trip Setup (앵커) — Accommodation Search(C3) · Saved Accommodation(C4) · Affiliate Link(C5) · Trip Creation(C6)
> **스토리**: US-SHELL-05(장소 우선 저장) + US-STAY-01~11 + US-TRIP-01~09 = **21개**
> **범위 주의(SCOPE.md 2026-07-17)**: 산출물은 설계 문서까지 — Code Generation 없음. 코드는 팀이 `backend/`·`frontend/`에서 직접 개발.
> **선행 상태**: U0 설계 종료(2026-07-17, 8종). U0 구현은 backend 사실상 완료 / frontend ≈85% — 사용자 지시로 U1 설계를 병렬 착수(2026-07-22).

## 기존 자산 조사 (Step 1 결과 — 질문 Q1의 근거)

| 자산 | 내용 | U1 관련성 |
|---|---|---|
| backend 코드 | modules = auth·profile·moderation **뿐**, Flyway V1.0~V1.7도 auth/profile/moderation만 | U1 관련 **코드 0** — 그린필드 |
| `backend/docs/design/전체-최소-스키마.dbml` | `poi` · `poi_snapshot` · `saved_place` · `saved_stay` · `ota_partner` · `outbound_click` · `trip` · `base_assignment` · `trip_base_day` · `must_visit` | U1 스키마 **선재 설계** |
| `backend/docs/design/전체-API-서피스.md` | 밴드 e(숙소) · g(여행 생성) · h(필수방문지) | U1 API **선재 설계** |
| Figma (라이브 정본) | 밴드 **d 탐색** · **e 숙소** · g 여행 생성 | 화면 정본 — 아래 §대조 결과 |

> **⚠️ 번호 충돌 주의**: `backend/docs/design/U1-API-설계.md`·`U1-DB스키마-설계.md`의 "U1"은 **제거된 planning/units.md 체계의 U1(기반·계정·온보딩)** = AI-DLC의 **U0**이다. 본 문서의 U1(숙소·여행)과 다르다.

## 라이브 Figma 대조 결과 — 밴드 d·e (2026-07-22 관측)

관측 대상: `d01 explore-landing` · `d02 place-save`(default/empty) · `d03 목적지 상세` · `d04 장소 탐색·담기` · `d05 여행자 일정 발견` · `d1b 지역 선택` · `e00 숙소 지역 선택` · `e02 숙소 검색 결과`(default + loading/empty/filter-zero/partial-failure/error) · `e03 숙소 상세`(default/affiliate-sheet) · `e04 저장한 숙소`(default/empty) · `e05 숙소 등록`(default/multi-candidate/conflict/error-mapapi)

| ID | 드리프트 | 문서 쪽 근거 | 라이브 |
|---|---|---|---|
| **D-1** | **탐색 탭(밴드 d) 전체가 문서에 무주공산** | 스토리에 탐색 랜딩 없음(US-SHELL-05 장소 저장 한 줄뿐). U0은 `(tabs)/explore` 빈 셸 | d01이 **숙소·장소·여행자 일정 통합 랜딩**("무엇을 찾을까요?"), d03 목적지 상세, d04 장소 탐색, d1b 지역 선택 |
| **D-2** | **위시리스트 부활 + 저장·등록 통합** | `전체-API-서피스.md`: `~~/wishlist~~` 1차 제외 / 스토리 US-STAY-04는 U1 | e02·e03·d01 카드에 ♥, **e04 "저장한 숙소 · ♥로 담아둔 곳"** 목록에 **`거점` 배지** + CTA "다른 숙소를 거점으로 지정" → 저장 목록 위에 거점 플래그를 얹은 **단일 모델** |
| **D-3** | **가격 표기 정책 상충** | US-STAY-01·02: 목록은 "대표 가격대(정적 구간)", 정확가는 딥링크 시점 라이브·캐싱 금지(ADR-0012) | 목록·상세·저장목록·지역카드 전부 **구체 금액**(`₩145,000~ · 1박`, 지역카드 `숙소 180곳 · ₩62,000~`) |
| **D-4** | 정합 ✅ | US-STAY-05 OTA 다중 선택·제휴 고지 | e03-affiliate-sheet: OTA A/B/C 라디오 + 가격 + "TripPilot은 제휴(어필리에이트) 수수료를 받을 수 있어요" |
| **D-5** | **e01 결번 · e00 신설 · 지역 선택 화면 2벌** | API 서피스는 e01·e02 참조 | 진입 = `e00 숙소 지역 선택`("어디서 묵을까요?") → e02. 그런데 `d1b 여행지 선택`("어디로 떠날까요?")과 UI가 거의 동일한 2벌 존재 |
| **D-6** | **숙소 등록 경로가 신·구 불일치** | 스토리 2경로(제휴 1탭·수동) / 서피스 3경로(검색·URL·핀) | 신 default(e05) = 단일 검색 + 지도 핀 확인 + 체크인/아웃. 구 변형(multi-candidate) = **3탭(지도 검색·링크 붙여넣기·핀 지정)** |
| **D-7** | **같은 화면코드에 신·구 두 벌** | — | default 프레임들(노드 `169x`·`183x`)은 최근 재디자인, 상태 변형(loading·empty·filter-zero·partial-failure·error·conflict·multi-candidate, 노드 `134x`·`135x`)은 **구 디자인 잔존** |
| **D-8** | **여행 생성 주 진입이 "담은 곳 → 여행 만들기"로 역전** | US-TRIP-01은 여행지·날짜·인원·예산 폼이 주 진입 | d01 "담은 곳 5곳 · 여행 만들기" / d02 "이 장소들로 여행 만들기" / d03 "부산으로 여행 만들기" / d04 "3 담은 장소로 여행 만들기" (seed POI 배열과는 정합) |
| **D-9** | **커뮤니티(여행자 일정)가 탐색 탭 1차에 노출** | 밴드 k = M15 **후속 게이트**(U7) | d05 "여행자 일정" 목록(작성자·좋아요·댓글수·인기순/최신/내취향 필터), d01·d03에도 "여행자 일정" 섹션 |
| **D-10** | **지도가 상시 전제** | Q5 선택지에 "지도 없이" 안 포함 시 불일치 | e03 상세·e05 등록에 지도 노출(OSM/CARTO 타일), e05 `error-mapapi` 폴백 변형 존재 |
| **D-11** | e03 CTA에 **"일정에 추가"** 신설 | 스토리에 대응 동작 없음 | e03 하단 = [외부에서 예약하기] + **[일정에 추가]** — 거점 등록과 같은 동작인지 불명 |
| **D-12** | 숙소 필터 축 축소 | US-STAY-02: 유형·편의시설·거리·가격대 | e02 필터 칩 = **가격대 · 지역 · 필터** 3개 (유형·편의시설은 상세 편의시설 아이콘으로만) |
| **D-13** | 정합 ✅ | US-STAY-01 날짜·인원 없이 탐색 | e02 헤더 "부산 · **날짜 미정** · 24곳" |

## 실행 계획

- [x] 1. 유닛 컨텍스트 분석 — unit-of-work.md(U1)·story-map(21 스토리)·stories.md 에픽 C·D·components.md C3~C6·component-methods §4·unit-of-work-dependency(U1→U0 단방향) + 기존 자산 조사
- [x] 1b. **라이브 Figma 밴드 d·e 대조** — 드리프트 D-1~D-13 식별(위 표)
- [x] 2. 질문 수집·모호성 해소 — Q1~Q14 답변(2026-07-23) + 모순 3건 검출 → 명확화 CQ1=A·CQ2=A·CQ3=B 확정 (CQ4 인셉션 수정 승인은 **미응답 → 갭 기록으로 대체**)
- [x] 2b. **밴드 g 추가 대조** — 신규 드리프트 5건(G-U1-08 다중 목적지 · G-U1-09 예산 UI 부재 · G-U1-10 동반유형 도메인 · G-U1-11 여행별 취향 오버라이드 · 프리셋)
- [x] 3. `u1-accommodation-trip/functional-design/business-logic-model.md` — DEC-1~13 · 플로우 F-1~F-6 · 포트 6종 · 갭 G-U1-01~13 · US-EXPL-* 신설 제안
- [x] 4. `u1-accommodation-trip/functional-design/domain-entities.md` — 엔티티 12종 · INV-U1-01~19 · 이벤트 6종
- [x] 5. `u1-accommodation-trip/functional-design/business-rules.md` — **BR-U1-01~56**
- [x] 6. `u1-accommodation-trip/functional-design/frontend-components.md` — 라우트·컴포넌트 30여종·폼검증·testID·PBT 4종
- [x] 7. 정합 검증 — 갭 G-U1-01~13(business-logic-model §6)
- [ ] 8. 완료 메시지 제시 → 사용자 승인 게이트 → audit.md·aidlc-state.md 반영

## 질문 (모두 [Answer]: 에 답해 주세요)

각 질문의 마지막 선택지는 항상 "Other"입니다. 해당 없으면 Other를 고르고 [Answer]: 뒤에 직접 적어 주세요. "이건 추천해줘"라고 적으셔도 됩니다 — 근거와 함께 안을 제시하겠습니다.

## Question 1
선재 설계 문서(`전체-최소-스키마.dbml` U1 테이블 10종 · `전체-API-서피스.md` 밴드 e·g·h)의 지위는? U1은 **코드가 아직 0줄**이라 재작업 비용이 없고, 위 대조에서 **라이브 Figma와 어긋나는 항목(D-2·D-3·D-5)이 이미 확인**됐습니다.

A) 기준선으로 수용 — 제약으로 받고 상충은 갭(G-U1-*)으로 기록해 협의

B) 설계 문서 우선 — 이번 기능설계가 정본, 선재 스키마·서피스는 참고안

C) 절충 — 테이블·컬럼은 기준선 수용, API 경로·응답은 이번 설계가 정본

D) **Figma 우선 원칙 적용** — 화면·상태·인터랙션은 라이브 Figma가 정본이고, 그와 충돌하는 선재 문서 항목만 이번 설계가 덮어씀 (CLAUDE.md 충돌 원칙과 동형)

E) Other (please describe after [Answer]: tag below)

[Answer]: D

## Question 2 (D-2 — 갱신됨)
**저장(♥)과 등록(거점)의 관계.** 라이브 e04는 "저장한 숙소 · ♥로 담아둔 곳" **한 목록** 안에서 하나에 `거점` 배지를 달고 "다른 숙소를 거점으로 지정"으로 전환합니다. 즉 위시리스트가 살아있고 등록은 그 위의 플래그입니다. 반면 `전체-API-서피스.md`는 위시리스트 1차 제외입니다.

A) **라이브 모델 채택** — `saved_stay` 하나에 `isBase`(거점) 플래그. 저장=위시리스트 포함, API 서피스의 "위시리스트 제외"는 폐기

B) 두 엔티티 분리 — 위시리스트(`wishlist_stay`)와 등록 숙소(`saved_stay`)를 별도로 두고 화면만 합쳐 보여줌

C) 서피스대로 위시리스트 제외 — ♥ = 곧 등록으로 해석하고 디자인 쪽을 수정 요청

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 3
**외부 OTA 연동의 현실 상태** — 탐색·가격·딥링크는 제휴 계약·키가 전제입니다. 1차 구현 형태는?

A) 포트 + 스텁 — `AccommodationContentPort`·`LivePricePort`·`OtaDeeplinkPort` 인터페이스와 고정 데이터 어댑터만, 실연동은 계약 확보 후 교체

B) 실연동 — 사용 가능한 OTA API로 즉시 연동 (어디인지 [Answer]에 명시)

C) 공공 데이터 우선 — TourAPI 등으로 탐색을 채우고 OTA는 딥링크만(가격 미표시)

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 4
**장소(POI) 검색의 소유 경계** — 담기(d02·d04)·필수 방문지·숙소 지도 검색에 장소 검색이 필요하지만, POI 정규화·후보풀(C7 Place Data)은 U3 소속입니다.

A) 얇게 — U1은 지도/장소 검색 어댑터 호출과 **선택 결과 저장**(`saved_place`)만. `poi`·`poi_snapshot` 정규화와 수집 게이트는 U3

B) 두껍게 — `poi`·`poi_snapshot`과 정규화 규칙까지 U1에서 확정하고 U3는 RAG 후보풀만 얹음

C) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 5 (D-10 — 갱신됨)
**지도 SDK 선택.** 라이브는 e03 상세·e05 등록에 지도를 상시 노출하고 `error-mapapi` 폴백 변형까지 있어 "지도 없이"는 선택지가 아닙니다. 디자인 타일은 OSM/CARTO입니다.

A) 카카오맵 네이티브 SDK (국내 POI·주소 정합 최상, 카카오 로컬 검색과 한 벤더)

B) 네이버 지도 SDK

C) OSM 기반(MapLibre 등) — 디자인 타일 그대로, 벤더 종속 없음. 단 국내 POI 검색은 별도 어댑터 필요

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 6 (D-6 — 갱신됨)
**숙소 등록 경로.** 신 default(e05)는 단일 검색 + 지도 핀 확인, 구 변형(multi-candidate)은 3탭(지도 검색 · 링크 붙여넣기 · 핀 지정)입니다.

A) 3경로 — 구 변형의 3탭을 유지(검색·URL 파싱·핀 지정)

B) 2경로 — 검색 + 핀 확인(신 default). URL 붙여넣기는 이연

C) 신 default 그대로 1경로 — 검색해서 고르면 지도로 위치만 확인

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 7
**여행(Trip) 라이프사이클의 U1 범위** — 상태(계획중·진행중·종료)·소프트 삭제·수동 종료(`TripEnded`)까지 U1에서 확정합니까? 전이 소비자는 U4·U5입니다.

A) 전부 U1 — 상태 머신·소프트 삭제·수동 종료·이벤트까지 확정

B) 생성·편집·삭제까지만 — 상태 필드는 두되 진행/종료 전이와 종료 이벤트는 U4·U5로 이연

C) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 8
**다중 거점 커버리지 기본값** — 스토리(US-TRIP-06)는 "공백일=직전 숙소, 겹침=체크인 우선", API 서피스(g02)는 "겹침=날짜별 primary 지정"입니다.

A) 체크인 우선 자동 결정 + "이 날은 ○○ 기준 — 바꾸기" 비차단 안내

B) 사용자에게 날짜별 primary를 고르게 함(차단형)

C) 자동 결정 + 오버라이드 저장 — A로 채우되 사용자가 지정하면 `trip_base_day`에 기록해 우선

D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 9
**국내 한정 강제** — 초기 출시는 국내 한정입니다. 해외 목적지 입력 처리는?

A) 차단 — 국내 범위 밖이면 생성을 막고 "지금은 국내 여행만 지원해요" 안내

B) 허용하되 AI 일정 생성 단계에서만 차단

C) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 10
**홈 대시보드 집계 API(`GET /home`)의 소유 유닛** — 홈 화면 셸은 U0(TRIP-170 구현 중)인데 집계 API는 U1 데이터(여행·숙소)를 씁니다.

A) U1에서 정의 — 지금 채울 수 있는 슬롯(여행·등록 숙소·취향 유도)까지 계약 확정, 나머지는 후속 확장

B) 이연 — U1은 개별 리소스 API만, `/home` 집계는 후속(U6 등)

C) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 11 (D-3 — 신규)
**가격 표기 모델.** 문서는 "목록은 대표 가격대(정적 구간), 정확가는 딥링크 시점 라이브·캐싱 금지"인데, 라이브 화면은 목록·상세·지역카드 전부 **구체 시작가**(`₩145,000~ · 1박`, `₩62,000~`)를 씁니다.

A) **최저가 스냅숏 모델** — "부터 가격"을 주기적 스냅숏으로 저장·표시(정적 취급, 갱신 주기 명시), 정확한 1박가는 상세/딥링크에서 라이브 조회. ADR-0012의 "캐싱 금지"는 **정확가에만** 적용되도록 규칙을 정밀화

B) 구간 표기로 디자인 수정 요청 — `₩10만~15만대` 형태로 바꾸고 문서 원안 유지

C) 전부 라이브 — 목록에서도 실시간 조회(비용·지연·부분 실패 감수)

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 12 (D-1 — 신규)
**탐색 탭(밴드 d)의 소유 유닛.** d01·d03·d04·d1b는 현재 어느 유닛 스토리에도 배정돼 있지 않습니다(U0은 빈 셸, U1 스토리는 숙소·여행 생성만).

A) **U1에 편입** — 탐색 랜딩·목적지 상세·장소 담기를 U1 스토리로 신설(US-EXPL-*)하고 이번 설계에 포함. 숙소 탐색(e)의 진입이 실제로 d01이므로 함께 설계하는 게 자연스러움

B) 장소 담기(d02·d04)만 U1(US-SHELL-05 확장), 탐색 랜딩·목적지 상세(d01·d03)는 데이터가 U3(POI)·U7(커뮤니티)에 걸리므로 후속 유닛

C) 밴드 d 전체를 별도 유닛으로 분리 — U1은 e·g만

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 13 (D-9 — 신규)
**"여행자 일정"(커뮤니티) 1차 노출 여부.** d05와 d01·d03의 여행자 일정 섹션은 커뮤니티(밴드 k = M15 = **U7 후속 게이트**) 데이터입니다. 그런데 탐색 탭 1차 화면에 이미 들어가 있습니다.

A) 1차 제외 — 해당 섹션은 U1 설계에서 자리(placeholder)만, 실데이터·상세는 U7

B) 읽기 전용 발견만 1차 포함 — 목록·상세 열람까지는 U1/U3 범위로 당기고, 작성·공개·댓글·신고는 U7

C) 전체 포함 — 커뮤니티를 1차로 앞당김(유닛 순서 재조정 필요)

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 14 (D-7 — 신규)
**같은 화면코드의 신·구 두 벌 처리.** default 프레임은 최근 재디자인됐고, 상태 변형(loading·empty·filter-zero·partial-failure·error·conflict·multi-candidate)은 구 디자인이 남아 있습니다. 설계 기준을 무엇으로 잡습니까?

A) **신 default 우선** — 상태 변형은 구 프레임의 *동작·문구*만 취하고 레이아웃은 신 default 기준으로 재해석해 설계

B) 구 변형이 정본 — 상태 변형에 담긴 정보량이 더 크므로 그쪽에 맞춰 default를 되돌림

C) 설계 보류 — 상태 변형 재디자인을 먼저 요청하고 대기

D) Other (please describe after [Answer]: tag below)

[Answer]: A
