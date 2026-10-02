---
paths:
  - "src/features/trip/**"
---
# `src/features/trip/` — 여행 생성 위저드(g01·g02)의 계약·판정·시트

서버 계약(orval `trips`·`preferences`·`bases`)을 도메인 이름으로 감싸는 얇은 훅, 위저드 드래프트 상태(Zustand), 순수 판정·파생, 무상태 편집 시트·확인 다이얼로그. 판정과 렌더를 파일로 가른다 — 순수 계산(`tripWizardStep1.ts`·`tripSummary.ts` 등)·상태 상자(`tripWizardStore.ts`)·시트·다이얼로그. 위저드 화면 뷰 두 개(`TripWizardStep1Screen`·`TripWizardStep2Screen`)는 TRIP-1149로 각 page 슬라이스(`pages/trip-new-step1`·`pages/trip-new-step2`)로 이사했다 — 행은 `layer-pages.md`. `validateTripDraft`를 부르는 곳은 배선 층(`pages/trip-new-step1/`) 하나뿐이고, 시트·다이얼로그는 서버 훅을 직접 물지 않는다. 날짜 산술은 epoch-day 방식이고 `new Date(` 생성자를 쓰지 않는다(기계 강제 없음 — TRIP-1145에서 스캔 삭제). 편집 시트는 전부 `@gorhom/bottom-sheet` 기반 props-only 무상태이고, 개폐·드래프트는 배선이 소유하며 시트는 화면의 형제로 마운트된다 — 실개폐·딤·터치차단은 통과형 목이라 jest 사각(6-b 전용).

| 파일 | 역할 |
|---|---|
| `src/features/trip/model/useSavedStays.ts` | `useGetSavedStays` 래퍼, 옵셔널 `enabled`(g02는 `tripId` 부재 시 요청 자체를 끈다). |
| `src/features/trip/model/baseScreen.ts` | `unresolvedDaysView(days)` — `{items: 앞 2개, overflowCount}`(프로덕션 소비처 0). |
| `src/features/trip/model/baseAssignPlan.ts` | `planBaseAssign(current, request)` — 거점 지정을 "교체"로 만드는 계획(겹치는 배정 DELETE + 남은 구간 재POST + 새 POST). 서버 `POST /bases`가 기존 배정을 안 보고 행을 추가하기 때문. 구간은 `[dateFrom, dateTo)`, ISO 문자열 비교. |
| `src/features/trip/model/useTripBases.ts` | `useTripBases`(`enabled: tripId !== undefined`) · `useInvalidateBases`(`bases`·`coverage` 두 키만 — 인자 없는 `invalidateQueries()`는 `saved-stays`까지 헛돈다) · `useAssignBase`(`useMutation`+생성 요청 함수로 **409를 성공으로 접는다** — 생성 훅 반환 타입으로는 "409면 빈 값"을 표현 못 함). |
| `src/features/trip/model/regionMatch.ts` | g02 시트 섹션 분리의 주소 판정. `sidoKey(name)` — 끝 명칭을 **긴 것부터** 떼고(`도`를 먼저 떼면 `강원특별자치도`가 깨진다), **접미를 실제로 뗀 경우에만** 3자를 1·3번째 글자로 접는다(시군구 `대덕구`를 접으면 `대구`와 충돌). `addressInRegion(address, region)`. **지역 이름 상수표를 두지 않는다**(소스 스캔 가드가 시도 이름 문자열 0건을 강제). **(TRIP-1042 신규)** `regionCodeInTrip(placeCode, destinationCodes)` — 행정구역 코드 양방향 `startsWith` 판정(짧은 쪽이 긴 쪽의 접두면 안). 장소 코드 없음 → 안(fail-open) · 목적지 코드가 하나라도 없으면 판정 자체를 생략(전부 안, [[fail-open 필터 설계]] "판정 전체를 건너뛰는" 변형). `placeLocationLabel(place, regions)` — 카탈로그 시도 행(코드 앞 2자리)의 `sidoKey`로 접어 `"인천 남동구"` 표기 조립, 못 찾으면 원래 이름·이미 짧으면 안 겹침. 둘 다 `pages/saved-places`가 소비(features 경계상 순수 함수만 export, 화면은 없음). **(TRIP-1074 신규)** `sigunguLabel(address)` — reverse-geocode 주소 문자열의 둘째 토막(시도 버림)이 시·군·구로 안 끝나면 `null`(대체 문구 없음), 일반시+구면 `수원시 영통구`처럼 이어 붙임. 주소 포맷은 계약 없음(관찰 기반, 6-b 실스택 확인 대상) — `pages/trip-new-step2`의 `TripNewStep2Page`가 `useStayAddresses` known 주소에만 호출해 `StaySelectSheet`/`SavedStayCard`로 내린다. |
| `src/features/trip/ui/TripGlyphs.tsx` | 위저드 글리프(Figma path 그대로). 비활성 색은 파일 내 상수(`DISABLED`) — SVG `stroke`는 className을 못 받는다. `BedGlyph`·`ChevronRightGlyph`는 `tone` prop, `ThumbRemoveGlyph`는 도시 칩용 `RemoveGlyph`와 색·굵기가 다른 별개 그림. `CheckGlyph`는 여러 `*Glyphs.tsx`에 동명이심볼로 있다(`traps-trip.md`). |
| `src/features/trip/lib/sheetHandle.ts` | 편집 시트 6종 공용 `SHEET_HANDLE_INDICATOR_STYLE`(gorhom `handleIndicatorStyle`이 raw `ViewStyle`만 받아 hex 불가피). `.ts`라 시트 구조가드의 raw-hex 스캔(`.tsx` 전용) 밖이고, `#DDDDDD`는 `hairline-strong` 토큰의 손 복제라 토큰이 바뀌어도 따라가지 않는다(개념 [[가드의 사정거리]]). |
