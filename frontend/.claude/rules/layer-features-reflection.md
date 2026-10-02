---
paths:
  - "src/features/reflection/**"
---
# `src/features/reflection/` — j03 오늘의 회고 · j04 여행 요약 · j05 여행 스타일 · j06 공유 카드 (model·글리프)

화면 계약은 backend openapi `Reflection`(`ai/docs/openapi.json`의 `/ai/v1/reflection/generate`와는 무관). load-bearing 계약은 두 축 — **"어떤 응답이 와도 빈 화면을 안 그린다"(폴백 3단, PBT-U5-F1)** 와 **"표시본 결정을 한 곳에서만 한다"(AC-8)**. 판정은 순수 함수 단일 출처, 화면은 무상태 프레젠테이션.

**화면 뷰는 여기 없다** — j03·j04·j05·j06 Screen과 그 전용 부품(+`styleThreshold`)은 TRIP-1153으로 각 page 슬라이스(`pages/{daily-reflection,trip-summary,share-card,travel-style}`)로 이사했다(`layer-pages.md`). 여기 남은 것은 page와 Screen이 함께 쓰거나 두 page 이상이 쓰는 model, page 하나만 쓰지만 Screen 전용이 아니라 이번에 옮기지 않은 model(`useDailyReflection`·`useStyleAnalysis`·`reflectionFallback`·`statsCard`·`editCard` — TRIP-1155 재평가 몫), 그리고 `ReflectionGlyphs`다.

**경계**: 다른 `features/*`(특히 `record`)를 import할 수 없다 — eslint 층 zone이 막는다.

## j03 오늘의 회고

| 파일 | 역할 |
|---|---|
| `model/reflectionFallback.ts` | `resolveDisplayNarrative(res) → string` — 표시본 결정의 **단일 지점**(AC-8 — 소스 스캔은 TRIP-1145에서 지워 기계 강제 없음). ①서버 `card.subtitle`(서버가 `editedCard ?? draftCard`로 이미 결정 — 클라 재판정 금지) ②결측·공백이면 `editedCard?.subtitle ?? draftCard?.subtitle` ③그마저 없으면 `statsCard`로 조립한 BASIC 문장. 클라 함수는 1차 결정자가 아니라 빈 화면 방지 최후수단이다([[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]]) |
| `model/reflectionFallback.test.ts` | PBT-U5-F1(CI 차단): 임의 `Reflection \| undefined`에도 표시본 `trim().length>0` + 폴백 순서 예제 |
| `model/editCard.ts` | `buildEditCard(card, text) → string` — 고친 글을 서버가 받는 카드 원문 JSON으로 조립. `cover.subtitle`만 바꾸고 나머지 키는 **그대로 보존**(DEC-U5-14). `cover.title`은 원래 값 → `card.title` → 글 첫 줄 앞 30자(코드포인트 단위) 순으로 항상 비지 않게(저장 400 회피). payload가 깨져도 `{}`에서 다시 시작. **저장 바탕은 `reflection?.card`뿐** — `draftCard`·`editedCard`로 클라가 다시 고르면 위반(뮤테이션 테스트가 잠금) |
| `model/statsCard.ts` | `statsCard(stats?)` — 네 필드를 `?? 0`/`?? 'VISIT_LINE'`로 0채움(INV-U5-07). 실제 0 값은 그대로 통과 — "빈 것"과 "0인 것"을 안 섞는다 |
| `model/statsCard.test.ts` | undefined/null→0s · 완전 입력 통과 · 숫자 타입 |
| `model/missingParts.ts` | `missingParts(stats) → {hidePhotoGrid, mapNotice, distanceDash}` — 부분 데이터 시 누락을 명시한다(BR-U5-34, 조용히 칸을 지우지 않는다). `distanceDash`는 값이 아니라 플래그 |
| `model/missingParts.test.ts` | 각 플래그 on/off 짝 |
| `model/useDailyReflection.ts` | POST(생성)·PUT(저장)·GET(목록) 훅을 감싼다(새 HTTP 0). 목록 GET에서 `dayDate` 항목을 고르고(`items?.find` — `items`도 옵셔널 체이닝해야 `{items:null}`에 안 죽는다, [[옵셔널 체이닝은 매 단계 필요]]) create/saveEdit 래핑. `source`는 보존만(BR-U5-33). POST·PUT 성공은 같은 지역 함수 `replaceDay`로 목록 캐시의 그 날 항목을 응답으로 교체(캐시가 비면 무효화)한다 — 재조회 없이 화면이 갱신된다(TRIP-1068, TRIP-980과 동형). `isCreateError`(=`post.isError`)가 생성 실패를 페이지에 노출한다(BR-U5-36) |
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
| `model/shareCapture.ts` | (신규) `isShareCaptureArmed()`(모듈 3종 존재 판정, 없으면 null 조회 — 패키지 정적 import 없음) · `saveShareCardImage(ref)`/`shareShareCardImage(ref)`(캡처→저장/공유, 실패는 전부 `{status:'failed'}` 반환, throw 없음) — `shareCaptureNative.ts`를 `await import`로만 부른다 |
| `model/shareCapture.test.ts` | (신규) armed 판정 3종 개별 부재·저장/공유 성공·권한거부·각 단계 reject |
| `model/shareCaptureNative.ts` | (신규) 캡처 3종 패키지를 **정적 import**하는 유일한 파일(re-export). 옮기면 `eslint.config.js`의 캡처 어댑터 예외(이 파일 경로 하나만 캡처 3종 정적 import 허용)에서 빠져 lint error가 난다(`traps-reflection.md`) |

## j05 여행 스타일 분석

**계정 단위**(`/me/style`, tripId 없음, INV-U5-08). 승격 권위는 서버 `official` 플래그뿐 — `progress.current`는 표시용이고 승격 판정에 관여시키지 않는다(PBT-U5-F4, CI 차단). 판정(`resolveStyleFace`)은 `entities/style-analysis/lib/styleFace.ts`(`layer-entities.md`). 표시 라벨 `categoryLabel`은 TRIP-1153으로 `pages/travel-style/model/styleThreshold.ts`로 이사(`layer-pages.md`).

| 파일 | 역할 |
|---|---|
| `model/useStyleAnalysis.ts` | `useGetMeStyle` 얇은 래퍼(조회 전용). 반환 타입 애너테이션을 달지 않는다 — `ReturnType<typeof …>`이 오버로드 마지막 시그니처를 집어 `.data`를 뭉갠다 |

## 관련

- 개념: [[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]] · [[옵셔널 체이닝은 매 단계 필요]] · [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] · [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]] · [[소스 스캔 가드의 폴더 전수와 자동 편입]] · [[반쪽 방어 (half-applied guard)]] · [[페이지 조립은 jest 무심판]] · [[마운트당 1회 발사 가드 (firedRef)]] · [[invalidateQueries (쿼리 무효화)]]
