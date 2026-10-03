---
paths:
  - "src/features/trip/**"
  - "src/pages/trip/trip-new-*/**"
  - "src/app/trips/**"
  - "src/features/create-trip/**"
  - "src/features/assign-trip-base/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 여행 만들기 위저드 (g01)

- **기간 포맷터 6벌의 정본은 `entities/trip/lib/formatTripPeriod.ts`다(`baseScreen.ts`·`tripSummary.ts`·`tripWizardStep1.ts`는 내부 사용 `import`만 남았다)** → 6벌(`formatDateRange`·`formatSectionRange`·`formatTripRange`·`formatConfirmedDateRange`·`formatTripDateRange`·`formatDateRangeWithDow`)은 en dash(U+2013)·미들닷(U+00B7)·공백 유무가 서로 달라 하나로 통합하면 회귀한다.

## 거점 숙소 단일 카드 (g02)


## 숙소 선택 시트 후보 카드 (g02)

- **`CheckGlyph`는 여러 `*Glyphs.tsx`(features·widgets·entities)에 동명이심볼로 존재한다(개수는 `grep -rln 'CheckGlyph' src`)** → grep 파일 목록만 보고 소비처 수를 오판하기 쉽다(브리프 오귀속 실측 1건). features 격리로 서로 cross-import가 불가능해 이름만 같을 뿐 다른 함수다 — 한쪽에 색·prop 확장을 추가해도 다른 파일엔 영향이 없다. 소비처 수를 셀 때는 **파일명이 아니라 `from` 절 전수 grep으로 실제 심볼의 정의 파일을 확인**한다(TripGlyphs.tsx의 CheckGlyph는 `StaySelectSheet.tsx` 하나가 쓴다). 개념 [[후방호환 옵셔널 파라미터 (additive prop)]] 참고.
- **거점 편집의 "바뀌었나" 기준(스냅샷)은 마운트 후 첫 서버 응답이라, l04가 선채움한 캐시로 카드가 즉시 뜬 뒤 첫 조회가 끝나기 전에 [지정]하면 지정 뒤 값이 기준이 되어 [완료]가 묻지 않고 나간다** → 결과는 암묵적 [그대로 두기](자동 재생성 없음). 첫 조회가 끝내 실패하면 옛 캐시가 기준이 되어 가짜 "바뀌었어요"도 가능(미재현). 어느 테스트도 "스냅샷 전 조작" 창을 안 밟는다 — `TripBasesPage.integration.test.tsx` 「편집 모드 (TRIP-1082)」 describe는 모두 첫 응답 뒤에 조작한다.

## 예산 등급 (g01)

- **`tierForAmount`의 경계(50만·150만·300만)는 온보딩 `PrefStep2Screen.BUDGET_OPTIONS` 라벨 문자열(`'50~150만원'` 등)의 손 복사본이라, 라벨을 고쳐도 이 숫자가 따라가지 않고 잡는 테스트도 없다** → 온보딩 구간을 바꾸는 작업은 `pages/trip/trip-new-step1/model/budgetAmount.ts`의 세 숫자와 칩 대표 금액 맵(`BUDGET_TIER_AMOUNT`)을 함께 고쳐야 한다. 형제 feature import 금지라 공용화도 막혀 있다(공용 범위 표 후보, 미착수). 역산 등급은 화면 표시 전용 — 생성 결과는 계정 `budgetTier`로 정해져 바뀌지 않는다(BE/AI 짝 칸).
