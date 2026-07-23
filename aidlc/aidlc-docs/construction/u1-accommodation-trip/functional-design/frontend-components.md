# U1 Accommodation & Trip Setup — Frontend Components

> 아키텍처 준수: `frontend/README.md`(정본) — `src/app` 얇은 라우트 + `features/` 구현 + `shared/` 횡단, TanStack Query(서버 상태)·Zustand(UI 상태)·RHF+Zod(폼)·NativeWind. testID 규약 `{feature}-{screen}-{role}`.
> **클라이언트 검증은 전부 UX 사본** — 판정 정본은 서버(`business-rules.md`).
> 화면 정본 = 라이브 Figma 밴드 d·e·g. 상태 변형은 **구 프레임의 동작·문구만 취하고 레이아웃은 신 default 기준으로 재해석**(Q14=A).

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

## 2. features/explore (밴드 d · C7)

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `ExploreLanding` | 4구획(여행지 칩 · 묵을 곳 · 가볼 곳 · 여행자 일정) + 하단 "담은 곳 N곳 · 여행 만들기" | 구획별 독립 쿼리(하나 실패해도 나머지 렌더) | `GET /explore/landing` |
| `RegionPicker` | **d1b·e00 공용** — `purpose: 'trip' \| 'stay'`로 카피·다음 목적지 분기(BR-U1-07) | props: purpose | `GET /regions` |
| `DestinationDetail` | 인기 스팟 그리드(담기 토글) · "이 지역에서 묵을 곳" · "{지역}으로 여행 만들기" | — | `GET /regions/{region}` |
| `PlaceExplorer` | 검색 + 카테고리 칩(전체·명소·맛집·카페·야경·자연) · 담기 토글 · "N 담은 장소로 여행 만들기" | Zustand: 담기 낙관적 업데이트 | `GET /places` · `POST/DELETE /places/{poiId}/save` |
| `SavedPlaceList` | 담은 순서 목록(순번·지역·태그) · "이 장소들로 여행 만들기" | — | `GET /me/saved-places` |
| `CommunityTeaser` | **1차 자리만** — 섹션 헤더 + 준비 중 안내. 실데이터·상세 라우팅 없음(BR-U1-05) | — | — |

## 3. features/stay (밴드 e · C3·C4·C5)

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `StaySearchResult` | 헤더 "{지역} · 날짜 미정 · N곳" · 필터 칩(가격대·지역·필터) · 카드 목록 | 필터 Zustand · 무한 스크롤 | `GET /stays?region=&filters=` |
| `StayCard` | 이름 · **최저가 스냅숏(`₩120,000~ · 1박`)** · 거리 · ♥ 토글. 스냅숏 없으면 "가격 미확인"(BR-U1-14) | props: stay | `POST/DELETE /stays/{id}/save` |
| `PartialFailureBanner` | "일부 숙소 정보를 불러오지 못했어요 · 다시 시도"(BR-U1-17) | props: onRetry | — |
| `FilterZeroNotice` | 0건을 만든 필터를 지목 + 완화 제안(BR-U1-16) | props: culpritFilters | — |
| `StayDetail` | 사진 · 이름 · 라이브 정확가 · 편의시설 · 지도 · 제휴 고지 · CTA 2종 | — | `GET /stays/{id}` · `GET /stays/{id}/live-price` |
| `OtaChoiceSheet` | OTA별 이름·가격 라디오 + 제휴 고지 + [이동](BR-U1-30·31) | props: options | `POST /stays/{id}/outbound` → 딥링크 |
| `AddToTripSheet` | `[일정에 추가]` — 여행 선택 → 거점 배정. 여행 없으면 생성으로(BR-U1-25) | — | `POST /trips/{id}/bases` |
| `SavedStayList` | "저장한 숙소 N곳 · ♥로 담아둔 곳" · `거점` 배지(파생) · "다른 숙소를 거점으로 지정" | — | `GET /me/saved-stays?tripId=` |
| `StayRegisterTabs` | 3탭(지도 검색 · 링크 붙여넣기 · 핀 지정) 공용 셸(BR-U1-21) | Zustand: 탭·후보·좌표확정 | — |
| ├ `MapSearchTab` | 검색 → 후보 다중 시 라디오 선택 → 지도 확인 | RHF+Zod | `GET /stays/geocode?q=` |
| ├ `LinkPasteTab` | OTA URL 파싱. 실패 시 원문 유지 + 타 탭 유도(BR-U1-24) | RHF+Zod: URL 형식 | `POST /stays/parse-link` |
| ├ `PinTab` | 지도 롱프레스로 핀 지정 → 역지오코딩 | — | `GET /stays/reverse-geocode` |
| └ `StayDateFields` | 체크인/아웃 · "N박 · 나중에 바꿀 수 있어요" | Zod: `checkOut > checkIn`(UX 사본) | `POST /saved-stays` |
| `MapApiFallback` | 지도 API 실패 시 핀 지정 폴백 안내(BR-U1-23) | — | — |

## 4. features/trip (밴드 g · C6)

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `TripWizardLayout` | 2단계 진행 표시(1/2·2/2) · 뒤로가기 시 입력 보존 | Zustand: 위저드 드래프트 | — |
| `DestinationChips` | 다중 도시 칩(`부산 · 2박 ×`) + "도시 추가"(BR-U1-34) | RHF: 배열 필드 | `GET /regions` |
| `MustVisitSeedStrip` | 담은 곳에서 온 '꼭 갈 곳' 썸네일 · 개별 ×· "+N" · "더 담기"(BR-U1-37) | — | `GET /me/saved-places` |
| `PeriodPicker` | 프리셋 칩(이번 주말·다음 주말·1박2일·3박4일) + 날짜 범위. 프리셋은 자동 채움일 뿐 수정 가능(BR-U1-36) | Zod: `end ≥ start`(UX 사본) | — |
| `PartyPicker` | 인원 스테퍼 + 동반 유형(혼자·친구·연인·가족)(BR-U1-39) | — | — |
| `PreferencePrefillCard` | "당신 취향으로 맞췄어요" + 칩 + [바꾸기] → 여행 단위 오버라이드(BR-U1-38) | — | `GET /me/preferences` |
| `BaseSectionList` | 구간별 거점("1~2박 6/10-6/12 부산 — {숙소} · 거점" + [변경]) | — | `GET /trips/{id}/bases` |
| `BaseCandidateList` | 숙소 후보 카드 · "거점으로 지정" · 지정 시 "✓ N박 · {지역}에 지정됨" | — | `POST /trips/{id}/bases` |
| `CoverageResolveSheet` | **차단형 해소 시트** — 미해결 날짜별 선택(겹침: 후보 목록 / 공백: 직전 숙소·여행지 중심·숙소 지정)(BR-U1-44·45) | props: unresolvedDays | `POST /trips/{id}/bases/coverage` |
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
`trip-wizard-step{n}-next` · `trip-wizard-destination-add` · `trip-wizard-period-preset-{code}` · `trip-wizard-party-stepper` · `trip-wizard-pref-change` · `trip-base-assign-{stayId}` · `trip-base-coverage-day-{date}` · `trip-base-nostay-start`

## 7. PBT 대상 (클라이언트 순수 함수 · fast-check)

| 대상 | 속성 |
|---|---|
| `resolveCoverage(trip, assignments) → DayResolution[]` | 임의 배정 집합에서 **모든 날짜가 정확히 하나의 판정**(auto·unresolved-overlap·unresolved-gap)을 받고, 여행 기간 밖 날짜는 결과에 없다 |
| `nightsSum(destinations) ≤ tripLength` | 임의 도시·박수 조합에서 위반 시 항상 거부(INV-U1-14) |
| `formatPrice(snapshot?)` | 스냅숏 없음 → 항상 "가격 미확인", 있음 → 항상 "~" 접미 시작가. **어떤 입력에서도 소요 시간 문자열을 만들지 않는다**(INV-3) |
| `seedMustVisits(savedPlaces)` | 중복 `sourcePoiId` 없음 · 원본 담기 해제와 독립(복사본 보존) |

> **서버측 PBT**(참고): 커버리지 해소 결과의 전 날짜 확정성, 최저가 스냅숏 정규화·직렬화 왕복, 딥링크 파라미터 정확성 — U1 NFR 단계에서 확정. **closed-set 게이트 PBT(INV-1)가 CQ3=B로 U1에 편입**된다.
