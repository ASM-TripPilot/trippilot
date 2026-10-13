---
paths:
  - "src/features/reflection/**"
---
# `src/features/reflection/` — j03 오늘의 회고 · j04 여행 요약 · j05 여행 스타일 · j06 공유 카드 (model·글리프)

화면 계약은 backend openapi `Reflection`(`ai/docs/openapi.json`의 `/ai/v1/reflection/generate`와는 무관). load-bearing 계약은 두 축 — **"어떤 응답이 와도 빈 화면을 안 그린다"(폴백 3단, PBT-U5-F1)** 와 **"표시본 결정을 한 곳에서만 한다"(AC-8)**. 판정은 순수 함수 단일 출처, 화면은 무상태 프레젠테이션.

**화면 뷰는 여기 없다** — j03·j04·j05·j06 Screen과 그 전용 부품(+`styleThreshold`)은 TRIP-1153으로 각 page 슬라이스(`pages/{daily-reflection,trip-summary,share-card,travel-style}`)로 이사했다(`layer-pages.md`). 여기 남은 것은 page와 Screen이 함께 쓰거나 두 page 이상이 쓰는 model, page 하나만 쓰지만 Screen 전용이 아니라 이번에 옮기지 않은 model(`useDailyReflection`·`useStyleAnalysis`·`reflectionFallback`·`statsCard`·`editCard` — TRIP-1155 재평가 몫), 그리고 `ReflectionGlyphs`다. TRIP-1155로 그 5개(+`missingParts`)는 `pages/record/daily-reflection`·`pages/record/travel-style`로, 캡처 어댑터(`shareCapture`·`shareCaptureNative`)는 `features/share-trip-card`로 이사했다.

**경계**: 다른 `features/*`(특히 `record`)를 import할 수 없다 — eslint 층 zone이 막는다.

## j03 오늘의 회고

| 파일 | 역할 |
|---|---|
| `ui/ReflectionGlyphs.tsx` | 공용 SVG(뒤로·위치없음·사진없음·빈원·다시시도·기분 3종) — j03·j04·j05·j06 Screen이 각자 다른 page로 흩어져 여기 남았다 |

## j04 여행 요약

`TripSummaryStats`는 j03 `ReflectionStats`와 shape가 달라 `statsCard.ts`를 개조하지 않고 별 함수로 둔다.

| 파일 | 역할 |
|---|---|
| `model/summaryView.ts` | `shareEnabled(envelope)=envelope.ready===true` · `resolveSummaryView(stats)=hasLocationData?'MAP':'VISIT_LIST'` · `toOrderedVisitList`(일자 넘어 전역 1..N 평탄화, 순서 보존) · `distanceSourceLabel`(`ROUTE→'경로'`/그 외→`'근사'`) · `daySubtitle`(≥2→`첫→마지막`, 테마 문구 발명 금지 BR-U5-31) |
| `model/summaryView.test.ts` | 진리표 + `toOrderedVisitList` PBT(순서 보존·번호 연속) |
| `model/formatKm.ts` | `formatKm(km) → 'X.Ykm'` (TRIP-1086) — 서버 double 거리를 0.1 반올림·끝 `.0` 생략(`1.929…→'1.9km'`, `12→'12km'`). 거리 문자열은 **이 함수 하나**로 만든다(소비처: `ReflectionStatsRow`·`summaryStats`·`reflectionFallback` ③). ★ `toFixed(1)`은 0.15를 '0.1'로 내려 쓰지 않는다. **'—'(측정 못 함) 판정은 호출부 몫이고 `formatKm`은 모른다** — 그런데 `reflectionFallback` ③ `basicNarrative`에는 그 판정이 없어 방문 1곳 이하에도 `이동 0km`을 쓴다(타일은 `—`, 이번 diff 전부터의 동작·후속 티켓 후보). 50m 미만(방문 2곳 이상)은 `'0km'`. 미터 입력·m 단위의 `entities/place` `formatDistance`와는 별개다(입력 단위·`.0` 처리가 달라 재사용 안 함) |
| `model/formatKm.test.ts` | 경계 예제(0.15·0.35·0.95·1.15) + PBT(형식·오차≤0.05·단조·동점 half-up) — `toFixed(1)` 뮤테이션에 red |
| `model/summaryStats.ts` | `summaryStats(stats?)` — 방문·사진 `?? 0`, 거리는 `!hasLocationData`면 `'—'`(0km 아님), 아니면 `formatKm` |
| `model/summaryStats.test.ts` | 0채움·거리 대시·완전 입력 |
| `model/useTripSummary.ts` | `useGetTripsTripIdSummary` 얇은 래퍼(새 HTTP 0), envelope 그대로 |

## j06 공유 카드

카드는 지도·경로 핀·사진을 그리지 않는다 — 계약에 좌표가 없다. 워터마크·동선 목록·그라디언트 오버레이로만 조립한다. 캡처(PNG)·앨범 저장·OS 공유·해시태그 인라인 편집은 TRIP-1071로 실구현(네이티브 3종 — `traps-reflection.md`, 재빌드 전엔 버튼 줄 자체가 안 뜬다).

| 파일 | 역할 |
|---|---|
| `model/shareCard.ts` | `SHARE_FORMATS`(story·square·feed) · `buildShareCard({summary,trip,format})` 카드 VM(j04 모델 재사용, `totalPhotos===0`→`'no-photo'`, duration 필드 0) · `validateCaption`/`validateHashtags`(온디바이스만, 해시태그 인라인 편집이 재사용) · `periodText`는 시작·종료 **둘 다** 있을 때만 조합([[반쪽 방어 (half-applied guard)]]). 옛 `captureShareImage()` degrade 스텁은 제거됨(→ `model/shareCapture.ts`) |
| `model/shareCard.test.ts` | 조립·mode·aspect·폼검증·INV-3(`JSON.stringify` 소요시간 0)·INV-4·null 방어 |

## j05 여행 스타일 분석

**계정 단위**(`/me/style`, tripId 없음, INV-U5-08). 승격 권위는 서버 `official` 플래그뿐 — `progress.current`는 표시용이고 승격 판정에 관여시키지 않는다(PBT-U5-F4, CI 차단). 판정(`resolveStyleFace`)은 `entities/style-analysis/lib/styleFace.ts`(`layer-entities.md`). 표시 라벨 `categoryLabel`은 TRIP-1153으로 `pages/record/travel-style/model/styleThreshold.ts`로 이사(`layer-pages.md`).

| 파일 | 역할 |
|---|---|

## 관련

- 개념: [[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]] · [[옵셔널 체이닝은 매 단계 필요]] · [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] · [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]] · [[소스 스캔 가드의 폴더 전수와 자동 편입]] · [[반쪽 방어 (half-applied guard)]] · [[페이지 조립은 jest 무심판]] · [[마운트당 1회 발사 가드 (firedRef)]] · [[invalidateQueries (쿼리 무효화)]]
