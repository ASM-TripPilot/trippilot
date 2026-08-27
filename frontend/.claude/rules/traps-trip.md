---
paths:
  - "src/features/trip/**"
  - "src/pages/trip-new-*/**"
  - "src/app/trips/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 여행 만들기 위저드 (g01)

- **`TripNewStep1Page`의 poiCount→위저드 prop 어댑터 배선(TRIP-363)에 통합 회귀 심판이 없다** → 어댑터가 서버 `region.poiCount`를 위저드 `regions`/`sheetRegions` prop으로 additive 전달해 poiCount=0 지역에 "준비 중" 배지(`trip-wizard-destination-coming-soon-{code}`)를 띄운다. `TripWizardStep1Screen.test.tsx`(화면 단위, poiCount를 목 데이터로 직접 주입)만 이 배지를 잰다 — `TripNewStep1Page.test.tsx`·`.budget.test.tsx`·`.mustVisit.test.tsx`·`.stayImport.test.tsx` 어느 것도 poiCount=0 케이스로 배지 노출을 통합 검증하지 않는다(`coming-soon` grep 결과 화면 파일·화면 테스트 2개뿐). 어댑터의 poiCount 매핑을 지워도 이 무심판 지대에서는 안 걸린다 — h20 add→PUT·d06 un-save와 동형 계열(어댑터/페이지 배선 무심판).
