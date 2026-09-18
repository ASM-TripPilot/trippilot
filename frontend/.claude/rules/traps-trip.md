---
paths:
  - "src/features/trip/**"
  - "src/pages/trip-new-*/**"
  - "src/app/trips/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 여행 만들기 위저드 (g01)

- **`TripNewStep1Page`의 poiCount→위저드 prop 어댑터 배선(TRIP-363)에 통합 회귀 심판이 없다** → 어댑터가 서버 `region.poiCount`를 위저드 `regions`/`sheetRegions` prop으로 additive 전달해 poiCount=0 지역에 "준비 중" 배지(`trip-wizard-destination-coming-soon-{code}`)를 띄운다. `TripWizardStep1Screen.test.tsx`(화면 단위, poiCount를 목 데이터로 직접 주입)만 이 배지를 잰다 — `TripNewStep1Page.test.tsx`·`.budget.test.tsx`·`.mustVisit.test.tsx`·`.stayImport.test.tsx` 어느 것도 poiCount=0 케이스로 배지 노출을 통합 검증하지 않는다(`coming-soon` grep 결과 화면 파일·화면 테스트 2개뿐). 어댑터의 poiCount 매핑을 지워도 이 무심판 지대에서는 안 걸린다 — h20 add→PUT·d06 un-save와 동형 계열(어댑터/페이지 배선 무심판).
- **`baseScreen.ts`·`tripSummary.ts`·`tripWizardStep1.ts`의 기간 포맷터(en dash 구분자)는 TRIP-808로 `entities/trip/lib/formatTripPeriod.ts`에 바이트 그대로 이관됐다** → 6벌(`formatDateRange`·`formatSectionRange`·`formatTripRange`·`formatConfirmedDateRange`·`formatTripDateRange`·`formatDateRangeWithDow`)은 en dash(U+2013)·미들닷(U+00B7)·공백 유무가 서로 달라 하나로 통합하면 회귀(TRIP-808 03 ★2). **TRIP-810로 `baseScreen.ts`·`tripWizardStep1.ts`의 공개 재수출 줄은 제거됨**(내부에서 이관 함수를 쓰는 `tripWizardStep1.ts`는 `import`만 존치) — `tripSummary.ts`는 3-a로 범위 밖(내부 사용 `import`+재수출 shim 존치, 새 티켓 후보).

## 거점 숙소 단일 카드 (g02, TRIP-740)

- **g01 선례(`SUMMARY_CARD_SHADOW`의 `shadowColor: '#000000'`)를 그대로 베끼면 g02에선 raw-hex 가드가 깨진다** → `tripWizardStep2Structure.test.ts` AC-7이 `TripWizardStep2Screen.tsx` 소스를 `/#[0-9a-fA-F]{3,8}\b/`로 스캔한다(g01 화면엔 이 가드 자체가 없어 `#000000` 인라인이 통과할 뿐). 그림자를 유지하면서 통과시키려면 **`shadowColor: 'black'`**(RN에서 `#000000`과 동치인 색이름, `#` 없어 정규식 무매치) 같은 비-hex 리터럴을 쓰거나, 상수를 `.ts` 파일로 빼 hex 스캔 대상(`.tsx`) 밖으로 옮긴다. 새로 raw-hex 가드가 있는 화면에 g01류 그림자 상수를 베낄 때마다 재발 가능 — 개념 [[소스 코드 문자열 스캔 가드 (needle)]] "TripPilot 실측 추가 — TRIP-740" 참고.

## 숙소 선택 시트 후보 카드 (g02, TRIP-741)

- **`CheckGlyph`는 `features/trip/ui/TripGlyphs.tsx`·`features/onboarding/ui/OnboardingGlyphs.tsx`·`features/itinerary/ui/ItineraryGlyphs.tsx` 세 파일에 동명이심볼로 존재한다** → grep `CheckGlyph`를 파일 목록만 보고 "소비처 3곳 이상"이라 오판하기 쉽다(TRIP-741 브리프가 실제로 "5+ 소비처"라 오귀속했다). features 격리로 서로 cross-import가 불가능해 이름만 같을 뿐 완전히 다른 함수다 — `tone`처럼 한쪽에 색·prop 확장을 추가해도 다른 두 파일엔 원리적으로 영향이 없다. 소비처 수를 셀 때는 **파일명이 아니라 `from` 절 전수 grep으로 실제 심볼의 정의 파일을 확인**해야 한다(TripGlyphs.tsx의 CheckGlyph는 실제로는 `StaySelectSheet.tsx` 단 하나가 쓴다). 개념 [[후방호환 옵셔널 파라미터 (additive prop)]] "census로 소비처 회귀 우려를 정정한 사례" 참고.
