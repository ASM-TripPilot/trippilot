---
paths:
  - "src/features/trip/**"
  - "src/pages/trip-new-*/**"
  - "src/app/trips/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 여행 만들기 위저드 (g01)

- **`TripNewStep1Page`의 poiCount→위저드 prop 어댑터 배선(TRIP-363)에 통합 회귀 심판이 없다** → 어댑터가 서버 `region.poiCount`를 위저드 `regions`/`sheetRegions` prop으로 additive 전달해 poiCount=0 지역에 "준비 중" 배지(`trip-wizard-destination-coming-soon-{code}`)를 띄운다. `TripWizardStep1Screen.test.tsx`(화면 단위, poiCount를 목 데이터로 직접 주입)만 이 배지를 잰다 — `TripNewStep1Page.test.tsx`·`.budget.test.tsx`·`.mustVisit.test.tsx`·`.stayImport.test.tsx` 어느 것도 poiCount=0 케이스로 배지 노출을 통합 검증하지 않는다(`coming-soon` grep 결과 화면 파일·화면 테스트 2개뿐). 어댑터의 poiCount 매핑을 지워도 이 무심판 지대에서는 안 걸린다 — h20 add→PUT·d06 un-save와 동형 계열(어댑터/페이지 배선 무심판).
- **`baseScreen.ts`·`tripSummary.ts`·`tripWizardStep1.ts`의 기간 포맷터(en dash 구분자)는 TRIP-808로 `entities/trip/lib/formatTripPeriod.ts`에 바이트 그대로 이관됐고, 옛 자리엔 재수출 shim만 남았다** → 6벌(`formatDateRange`·`formatSectionRange`·`formatTripRange`·`formatConfirmedDateRange`·`formatTripDateRange`·`formatDateRangeWithDow`)은 en dash(U+2013)·미들닷(U+00B7)·공백 유무가 서로 달라 하나로 통합하면 회귀(TRIP-808 03 ★2). shim은 TRIP-810이 정리 예정 — 그 전엔 이 파일에서 `import`(내부 사용) 또는 `export … from`(순수 재수출) 한 줄로만 보인다.
