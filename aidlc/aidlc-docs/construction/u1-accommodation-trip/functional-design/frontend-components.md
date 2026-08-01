# U1 Accommodation & Trip Setup — Frontend Components

> **아키텍처 정본 = `frontend/README.md`.** 층 구조·폴더 규약을 이 문서에 옮겨 적지 않는다 — 사본은 갈라진다. 이 문서가 정하는 것은 **컴포넌트의 책임·상태·서버 연동**이지 그것이 놓일 폴더가 아니다. 상태 관리 스택(TanStack Query=서버 상태 · Zustand=UI 상태 · RHF+Zod=폼 · NativeWind)과 testID 규약 `{feature}-{screen}-{role}`도 그 정본을 따른다.
> **클라이언트 검증은 전부 UX 사본** — 판정 정본은 서버(`business-rules.md`).
> 화면 정본 = 라이브 Figma 밴드 d·e·g. 상태 변형은 **구 프레임의 동작·문구만 취하고 레이아웃은 신 default 기준으로 재해석**(Q14=A).
>
> **서버 연동 열 표기(2026-07-29 정정)**: 경로 정본은 언제나 `backend/docs/design/openapi.yaml`이고 아래 표는 그 사본이다. `⚠️ 계약 미존재`는 **이 문서가 계약보다 앞서 나간 자리** — 백엔드 계약·모듈이 생기기 전까지 프론트가 붙을 수 없다(후속 티켓 C 대기). 정정 전에는 존재하지 않는 경로가 실재하는 것처럼 적혀 있었다.

## 1. 라우트 골격 (U1이 추가하는 부분)

```text
src/app/
  (tabs)/
    explore.tsx                # d01 탐색 랜딩 — U0의 빈 셸을 U1이 채움
  explore/
    region.tsx                 # d1b·e00 지역 선택 (purpose 파라미터로 분기)
    destination/[region].tsx   # d03 목적지 상세
    places.tsx                 # d04 장소 탐색·담기
    saved-places.tsx           # d02 담은 장소
    community.tsx              # d05 여행자 일정 — 1차는 자리만(BR-U1-05)
  stays/
    index.tsx                  # e02 숙소 검색 결과
    [stayId].tsx               # e03 숙소 상세 (+ OTA 선택 바텀시트)
    saved.tsx                  # e04 저장한 숙소
    register.tsx               # e05 숙소 등록 (3탭)
  trips/
    new/
      _layout.tsx              # 2단계 위저드 셸(진행 표시 1/2·2/2)
      step1.tsx                # g01 여행지·꼭 갈 곳·기간·인원
      step2.tsx                # g02 거점 숙소
    [tripId]/
      bases.tsx                # 거점 관리·커버리지 해소 시트
      must-visits.tsx          # 필수 방문지 관리
```

- 위저드·등록·상세는 **몰입 화면**이므로 탭바를 숨긴다(U0 BR-U0-29 상속).

## 2. 탐색 컴포넌트 (밴드 d · C7)

⚠️ **이 절의 서버 연동은 전부 계약 미존재다** — 장소 도메인은 openapi 경로 0개·백엔드 모듈 0개다(2026-07-29 실측). 후속 티켓 **C**(`place-data` 모듈 + `GET /places` · `POST/DELETE /saved-places`)가 선행되지 않으면 이 절의 어떤 컴포넌트도 붙지 않는다.

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `ExploreLanding` | 4구획(여행지 칩 · 묵을 곳 · 가볼 곳 · 여행자 일정) + 하단 "담은 곳 N곳 · 여행 만들기" | 구획별 독립 쿼리(하나 실패해도 나머지 렌더) | ⚠️ 계약 미존재 (`/explore/landing`) |
| `RegionPicker` | **d1b·e00 공용** — `purpose: 'trip' \| 'stay'`로 카피·다음 목적지 분기(BR-U1-07) | props: purpose | ⚠️ 계약 미존재 (`/regions`) |
| `DestinationDetail` | 인기 스팟 그리드(담기 토글) · "이 지역에서 묵을 곳" · "{지역}으로 여행 만들기" | — | ⚠️ 계약 미존재 (`/regions/{region}`) |
| `PlaceExplorer` | 검색 + 카테고리 칩(전체·명소·맛집·카페·야경·자연) · 담기 토글 · "N 담은 장소로 여행 만들기" | Zustand: 담기 낙관적 업데이트 | ⚠️ 계약 미존재 (`/places` · `/places/{poiId}/save`) — **C 대기** |
| `SavedPlaceList` | 담은 순서 목록(순번·지역·태그) · "이 장소들로 여행 만들기" | — | ⚠️ 계약 미존재 (`/me/saved-places`) — **C 대기** |
| `CommunityTeaser` | **1차 자리만** — 섹션 헤더 + 준비 중 안내. 실데이터·상세 라우팅 없음(BR-U1-05) | — | — |

## 3. 숙소 컴포넌트 (밴드 e · C3·C4·C5)

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `StaySearchResult` | 헤더 "{지역} · 날짜 미정 · N곳" · 필터 칩(가격대·지역·필터) · 카드 목록 | 필터 Zustand | `GET /stays/search` (region·amenity·stayType — 날짜·인원·정렬 없음: BR-U1-10/15) |
| `StayCard` | 이름 · **최저가 스냅숏(`120,000원~ · 1박`)** · 거리 · ♥ 토글. 스냅숏 없으면 "가격 미확인"(BR-U1-14) | props: stay | `POST /saved-stays` · `DELETE /saved-stays/{savedStayId}` |
| `PartialFailureBanner` | "일부 숙소 정보를 불러오지 못했어요 · 다시 시도"(BR-U1-17) | props: onRetry | — |
| `FilterZeroNotice` | 0건을 만든 필터를 지목 + 완화 제안(BR-U1-16). **[구현 결정 · TRIP-182, 2026-07-30]** 실제 구현은 아래 `StateNotice`의 얇은 래퍼(자체 마크업 없음) — 근거: `frontend/src/features/stay/ui/StaySearchScreen.tsx`의 `FilterZeroNotice` 로컬 함수 | props: culpritFilters | — |
| `StateNotice` | **[구현 결정 · TRIP-182, 2026-07-30]** `empty`·`filter-zero`·`error` **3상태 공용** 안내 블록(원형 배지 + 제목 + 부제 + 버튼 N) — 이 문서 승인(2026-07-23) 당시엔 없던 컴포넌트, 세 상태를 하나로 묶은 것은 요구사항이 아니라 구현 단계의 부품 분해 결정이다. 근거: `frontend/src/features/stay/ui/StateNotice.tsx` | props: icon·title·description·actions[](`variant: 'outline'\|'filled'\|'link'`)·dashed? | — |
| `SkeletonList` | **[구현 결정 · TRIP-182, 2026-07-30]** `loading` 상태 전용 — 라벨(`숙소를 모으는 중`) + 스켈레톤 카드 2장. 이 문서 승인 당시 loading 대응 컴포넌트 행이 없었다(§3 공백). 근거: `frontend/src/features/stay/ui/SkeletonList.tsx` | — | — |
| `StayDetail` | 사진 · 이름 · 라이브 정확가 · 편의시설 · 지도 · 제휴 고지 · CTA 2종 | — | ⚠️ 계약 미존재 (`/stays/{id}` · `/stays/{id}/live-price`) |
| `OtaChoiceSheet` | OTA별 이름·가격 라디오 + 제휴 고지 + [이동](BR-U1-30·31) | props: options | ⚠️ 계약 미존재 (`/stays/{id}/outbound` → 딥링크) |
| `AddToTripSheet` | `[일정에 추가]` — 여행 선택 → 거점 배정. 여행 없으면 생성으로(BR-U1-25) | — | `POST /trips/{tripId}/bases` |
| `SavedStayList` | "저장한 숙소 N곳 · ♥로 담아둔 곳" · `거점` 배지(파생) · "다른 숙소를 거점으로 지정" | — | `GET /saved-stays` |
| `StayRegisterTabs` | 3탭(지도 검색 · 링크 붙여넣기 · 핀 지정) 공용 셸(BR-U1-21) | Zustand: 탭·후보·좌표확정 | — |
| ├ `MapSearchTab` | 검색 → 후보 다중 시 라디오 선택 → 지도 확인 | RHF+Zod | `GET /stays/geocode` |
| ├ `LinkPasteTab` | OTA URL 파싱. 실패 시 원문 유지 + 타 탭 유도(BR-U1-24) | RHF+Zod: URL 형식 | ⚠️ 계약 미존재 (`/stays/parse-link`) |
| ├ `PinTab` | 지도 롱프레스로 핀 지정 → 역지오코딩 | — | ⚠️ 계약 미존재 (`/stays/reverse-geocode`) |
| └ `StayDateFields` | 체크인/아웃 · "N박 · 나중에 바꿀 수 있어요" | Zod: `checkOut > checkIn`(UX 사본) | `POST /saved-stays` |
| `MapApiFallback` | 지도 API 실패 시 핀 지정 폴백 안내(BR-U1-23) | — | — |

> **문구 소유자 — `filterZeroReasons` 코드→표시명 변환.** **[구현 결정 · TRIP-182, 2026-07-30]** 계약(`filterZeroReasons: string[]`)은 `stayType`·`amenity:오션뷰` 같은 기계 코드만 준다. 한글 표시명으로 바꾸는 책임은 **프론트가 소유**한다 — 근거: `frontend/src/features/stay/model/filterReasonLabel.ts`(축 이름 사전 2줄 + 모르는 축은 코드 그대로 폴백). 이 문서 승인 당시 이 변환의 소유자가 정해져 있지 않았다(공백). 서버가 표시명 필드를 새로 주는 것으로 이 소유권이 바뀌면 이 문단부터 갱신한다.

## 4. 여행 생성 컴포넌트 (밴드 g · C6)

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `TripWizardLayout` | 2단계 진행 표시(1/2·2/2) · 뒤로가기 시 입력 보존 | Zustand: 위저드 드래프트 | — |
| `DestinationChips` | 다중 도시 칩(`부산 · 2박 ×`) + "도시 추가"(BR-U1-34) | RHF: 배열 필드 | ⚠️ 계약 미존재 (`/regions`) |
| `MustVisitSeedStrip` | 담은 곳에서 온 '꼭 갈 곳' 썸네일 · 개별 ×· "+N" · "더 담기"(BR-U1-37) | — | ⚠️ 계약 미존재 (`/me/saved-places`) — **C 대기** |
| `PeriodPicker` | 프리셋 칩(이번 주말·다음 주말·1박2일·3박4일) + 날짜 범위. 프리셋은 자동 채움일 뿐 수정 가능(BR-U1-36) | Zod: `end ≥ start`(UX 사본) | — |
| `PartyPicker` | 인원 스테퍼 + 동반 유형(혼자·친구·연인·가족)(BR-U1-39) | — | — |
| `PreferencePrefillCard` | "당신 취향으로 맞췄어요" + 칩 + [바꾸기] → 여행 단위 오버라이드(BR-U1-38) | — | `GET /me/preferences` |
| `BaseSectionList` | 구간별 거점("1~2박 6/10-6/12 부산 — {숙소} · 거점" + [변경]) | — | `GET /trips/{tripId}/coverage` (구간·배정 상태) · `DELETE /trips/{tripId}/bases/{baseAssignmentId}` |
| `BaseCandidateList` | 숙소 후보 카드 · "거점으로 지정" · 지정 시 "✓ N박 · {지역}에 지정됨" | — | `POST /trips/{tripId}/bases` |
| `CoverageResolveSheet` | **차단형 해소 시트** — 미해결 날짜별 선택(겹침: 후보 목록 / 공백: 직전 숙소·여행지 중심·숙소 지정)(BR-U1-44·45) | props: unresolvedDays | `GET /trips/{tripId}/coverage` → 해소는 `POST /trips/{tripId}/bases` 재배정 |
| `NoStayStartButton` | "숙소 없이 시작하기"(BR-U1-40) | — | `POST /trips` |
| `OverseasBlockDialog` | 국내 밖 목적지 차단 안내(BR-U1-35) | — | — |

## 5. 폼 검증 (UX 사본 명세)

| 폼 | 클라 검증(Zod) | 서버 정본 |
|---|---|---|
| 숙소 등록 | 숙소명 필수 · 체크아웃 > 체크인 · 좌표 확정 여부 | BR-U1-22·26 (409/422) |
| 링크 붙여넣기 | URL 형식 | BR-U1-24 (파싱 판정은 서버) |
| 여행 생성 | 종료일 ≥ 시작일 · 도시별 박수 합 ≤ 기간 · 인원 ≥ 1 | BR-U1-34·36 · INV-U1-14 |
| 필수 방문지 고정 | 날짜가 여행 기간 안 · 시각 형식 | BR-U1-49 |

## 6. testID (규약 `{feature}-{screen}-{role}`)

`explore-landing-{section}`(regions·stays·places·community) · `explore-landing-createtrip` · `explore-region-{code}` · `explore-places-search` · `explore-places-save-{poiId}` · `explore-saved-createtrip`
`stay-search-filter-{axis}`(price·region·more) · `stay-card-{stayId}` · `stay-card-save-{stayId}` · `stay-search-partialfailure-retry` · `stay-detail-book` · `stay-detail-addtotrip` · `stay-ota-option-{otaCode}` · `stay-saved-setbase-{stayId}` · `stay-register-tab-{route}`(mapsearch·linkpaste·pin) · `stay-register-submit` · `stay-register-mapconfirm`

**[구현 결정 · TRIP-182, 2026-07-30]** 위 `stay-search-partialfailure-retry` 외 나머지 4상태(loading·empty·filter-zero·error)의 testID — 이 문서 승인 당시 이 넷의 이름은 정해지지 않았다(§6 공백). 실제 구현이 확정한 값: `stay-search-loading` · `stay-search-skeleton-{i}`(i=0,1) · `stay-search-empty` · `stay-search-empty-region` · `stay-search-empty-filter` · `stay-search-register` · `stay-search-filterzero` · `stay-search-filterzero-clear` · `stay-search-filterzero-reset` · `stay-search-error` · `stay-search-error-retry` · `stay-search-error-register` · `stay-search-partialfailure`(배너 컨테이너 자체 — retry는 위와 동일). 근거: `frontend/src/features/stay/ui/StaySearchScreen.states.test.tsx`(게이트①-1 승인, TRIP-182).
`trip-wizard-step{n}-next` · `trip-wizard-destination-add` · `trip-wizard-period-preset-{code}` · `trip-wizard-party-stepper` · `trip-wizard-pref-change` · `trip-base-assign-{stayId}` · `trip-base-coverage-day-{date}` · `trip-base-nostay-start`

## 7. PBT 대상 (클라이언트 순수 함수 · fast-check)

| 대상 | 속성 |
|---|---|
| `resolveCoverage(trip, assignments) → DayResolution[]` | 임의 배정 집합에서 **모든 날짜가 정확히 하나의 판정**(auto·unresolved-overlap·unresolved-gap)을 받고, 여행 기간 밖 날짜는 결과에 없다 |
| `nightsSum(destinations) ≤ tripLength` | 임의 도시·박수 조합에서 위반 시 항상 거부(INV-U1-14) |
| `formatPrice(snapshot?)` | 스냅숏 없음 → 항상 "가격 미확인", 있음 → 항상 "~" 접미 시작가. **어떤 입력에서도 소요 시간 문자열을 만들지 않는다**(INV-3) |
| `seedMustVisits(savedPlaces)` | 중복 `sourcePoiId` 없음 · 원본 담기 해제와 독립(복사본 보존) |
| `resolveStaySearchState(input) → StaySearchState` | **[구현 결정 · TRIP-182, 2026-07-30]** 임의의 `(isPending, isError, itemCount, degraded, filterZeroReasons)` 조합에서 결과 `kind`가 5개 리터럴(`loading`\|`error`\|`results`\|`filter-zero`\|`empty`) 중 **정확히 하나**이고 "아무것도 아님"이 없다. 요구사항 근거는 INV-4(결정론적 폴백·침묵 실패 금지) — 단 이 성질을 PBT 대상으로 뽑을 수 있었던 것 자체는 구현이 판정을 순수 함수로 분리한 결정에서 비롯한다. 이 문서 승인 당시 상태 판정 완전성은 PBT 대상 목록에 없었다(공백). 근거: `frontend/src/features/stay/model/staySearchState.test.ts`(fast-check, numRuns 500) |

> **서버측 PBT**(참고): 커버리지 해소 결과의 전 날짜 확정성, 최저가 스냅숏 정규화·직렬화 왕복, 딥링크 파라미터 정확성 — U1 NFR 단계에서 확정. **closed-set 게이트 PBT(INV-1)가 CQ3=B로 U1에 편입**된다.
