---
paths:
  - "src/features/reflection/**"
---
# `src/features/reflection/` — j03 오늘의 회고 · j04 여행 요약 · j05 여행 스타일 · j06 공유 카드

화면 계약은 backend openapi `Reflection`(`ai/docs/openapi.json`의 `/ai/v1/reflection/generate`와는 무관). load-bearing 계약은 두 축 — **"어떤 응답이 와도 빈 화면을 안 그린다"(폴백 3단, PBT-U5-F1)** 와 **"표시본 결정을 한 곳에서만 한다"(AC-8)**. 판정은 순수 함수 단일 출처, 화면은 무상태 프레젠테이션.

**경계**: 다른 `features/*`(특히 `record`)를 import할 수 없다 — eslint 층 zone과 `reflectionStructure.test.ts` G2(소스 재귀 스캔)가 이중으로 막는다.

## j03 오늘의 회고

| 파일 | 역할 |
|---|---|
| `model/reflectionFallback.ts` | `resolveDisplayNarrative(res) → string` — 표시본 결정의 **단일 지점**(AC-8이 소스 스캔으로 강제). ①서버 `card.subtitle`(서버가 `editedCard ?? draftCard`로 이미 결정 — 클라 재판정 금지) ②결측·공백이면 `editedCard?.subtitle ?? draftCard?.subtitle` ③그마저 없으면 `statsCard`로 조립한 BASIC 문장. 클라 함수는 1차 결정자가 아니라 빈 화면 방지 최후수단이다([[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]]) |
| `model/reflectionFallback.test.ts` | PBT-U5-F1(CI 차단): 임의 `Reflection \| undefined`에도 표시본 `trim().length>0` + 폴백 순서 예제 |
| `model/editCard.ts` | `buildEditCard(card, text) → string` — 고친 글을 서버가 받는 카드 원문 JSON으로 조립. `cover.subtitle`만 바꾸고 나머지 키는 **그대로 보존**(DEC-U5-14). `cover.title`은 원래 값 → `card.title` → 글 첫 줄 앞 30자(코드포인트 단위) 순으로 항상 비지 않게(저장 400 회피). payload가 깨져도 `{}`에서 다시 시작. **저장 바탕은 `reflection?.card`뿐** — `draftCard`·`editedCard`로 클라가 다시 고르면 위반(뮤테이션 테스트가 잠금) |
| `model/statsCard.ts` | `statsCard(stats?)` — 네 필드를 `?? 0`/`?? 'VISIT_LINE'`로 0채움(INV-U5-07). 실제 0 값은 그대로 통과 — "빈 것"과 "0인 것"을 안 섞는다 |
| `model/statsCard.test.ts` | undefined/null→0s · 완전 입력 통과 · 숫자 타입 |
| `model/missingParts.ts` | `missingParts(stats) → {hidePhotoGrid, mapNotice, distanceDash}` — 부분 데이터 시 누락을 명시한다(BR-U5-34, 조용히 칸을 지우지 않는다). `distanceDash`는 값이 아니라 플래그 |
| `model/missingParts.test.ts` | 각 플래그 on/off 짝 |
| `model/useDailyReflection.ts` | POST(생성)·PUT(저장)·GET(목록) 훅을 감싼다(새 HTTP 0). 목록 GET에서 `dayDate` 항목을 고르고(`items?.find` — `items`도 옵셔널 체이닝해야 `{items:null}`에 안 죽는다, [[옵셔널 체이닝은 매 단계 필요]]) create/saveEdit 래핑. `source`는 보존만(BR-U5-33). POST·PUT 성공은 같은 지역 함수 `replaceDay`로 목록 캐시의 그 날 항목을 응답으로 교체(캐시가 비면 무효화)한다 — 재조회 없이 화면이 갱신된다(TRIP-1068, TRIP-980과 동형). `isCreateError`(=`post.isError`)가 생성 실패를 페이지에 노출한다(BR-U5-36) |
| `ui/DailyReflectionScreen.tsx` | 무상태 **5얼굴**(default·data-insufficient·empty·error·**pending**, TRIP-1068) + 편집 모드. `pending`은 조회·생성 진행 중 안내(`StateNotice` 재사용, `ShareCardPage.tsx` 선례)만 보이고 하단 CTA는 없다. 편집 진입은 데이터 얼굴이면 헤더 `reflection-daily-edit`, empty/error면 하단 CTA `reflection-daily-compose`. 저장은 `canSave = text.trim().length>0`(`disabled`+`accessibilityState.disabled` 짝), `onSaveEdit`가 Promise면 성공일 때만 편집을 닫고 실패면 안내 문구를 보인다. 편집 상한 **4000자**(서버 권위 `EditReflectionRequest.maxLength`). 지도는 실 좌표가 있을 때만 `MapView`(`LOCKED_CALLERS` 등재), 없으면 placeholder — 계약에 좌표가 없어 오늘은 늘 placeholder([[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]]). ⚠️ 얼굴 판정은 "레코드 존재"를 "생성 실패"보다 먼저 본다 — `post.isError`는 PUT 성공 뒤에도 남아 두 조건이 동시에 참일 수 있는데 이 순서를 지키는 단위 테스트가 없다(03b W-1, 문제로그 없이 각주로만 인계). 공유 아이콘은 `onShare`가 있을 때만(`canShare`는 페이지가 trip `status === 'ENDED'`로 판정, BR-U5-48) |
| `ui/DailyReflectionScreen.test.tsx` | empty/error CTA·편집 모드 `maxLength`·저장 활성 짝·렌더 스모크 |
| `ui/ReflectionStatsRow.tsx` | `reflection-daily-stats` 3열(방문·이동·사진), `distanceDash`면 "—". 소요시간 문자열 0(INV-3) |
| `ui/NarrativeBlock.tsx` | `reflection-daily-narrative` — 완성 표시본을 그대로 렌더. `draftCard`·`editedCard`·`resolveDisplayNarrative`를 참조하지 않는다(AC-8 소스 강제). 내부 주석의 옛 필드명은 낡았다 |
| `ui/ReflectionPhotoGrid.tsx` | `reflection-daily-photo-grid` — `Reflection`에 사진 URL이 없어 페이지가 항상 `photos=[]` |
| `ui/ChangeSummaryRow.tsx` | `reflection-daily-change-summary` 변경 요약 행 — 하트 버튼은 근거가 없어 자리만 |
| `ui/ReflectionGlyphs.tsx` | feature-local SVG(뒤로·위치없음·사진없음·빈원·다시시도·`ShareGlyph`). `ShareCardGlyphs.tsx`의 동명 `ShareGlyph`와 독립 정의 |

## j04 여행 요약

`TripSummaryStats`는 j03 `ReflectionStats`와 shape가 달라 `statsCard.ts`를 개조하지 않고 별 함수로 둔다.

| 파일 | 역할 |
|---|---|
| `model/summaryView.ts` | `shareEnabled(envelope)=envelope.ready===true` · `resolveSummaryView(stats)=hasLocationData?'MAP':'VISIT_LIST'` · `toOrderedVisitList`(일자 넘어 전역 1..N 평탄화, 순서 보존) · `distanceSourceLabel`(`ROUTE→'경로'`/그 외→`'근사'`) · `daySubtitle`(≥2→`첫→마지막`, 테마 문구 발명 금지 BR-U5-31) |
| `model/summaryView.test.ts` | 진리표 + `toOrderedVisitList` PBT(순서 보존·번호 연속) |
| `model/summaryStats.ts` | `summaryStats(stats?)` — 방문·사진 `?? 0`, 거리는 `!hasLocationData`면 `'—'`(0km 아님) |
| `model/summaryStats.test.ts` | 0채움·거리 대시·완전 입력 |
| `model/useTripSummary.ts` | `useGetTripsTripIdSummary` 얇은 래퍼(새 HTTP 0), envelope 그대로 |
| `ui/TripSummaryScreen.tsx` | 무상태 — stats 3셀 · MAP 분기(좌표 없으면 `reflection-summary-map-pending`, 가짜 기본센터 금지) · VISIT_LIST 분기 · `DayHighlightCard` · 공유 버튼(`disabled` 짝 — press 콜백 0회가 실질 그물). `LOCKED_CALLERS` 등재 |
| `ui/TripSummaryScreen.test.tsx` | MAP·VISIT_LIST·라벨·공유 비활성 짝 |
| `ui/DayHighlightCard.tsx` | 날짜 카드(`reflection-summary-day-card`) — 썸네일 자리표시(가짜 이미지 금지) · `Day N · M곳` · 부제 |

## j06 공유 카드

카드는 지도·경로 핀·사진을 그리지 않는다 — 계약에 좌표가 없다. 워터마크·동선 목록·그라디언트 오버레이로만 조립한다. 캡처(PNG)·앨범 저장·OS 공유·해시태그 인라인 편집은 TRIP-1071로 실구현(네이티브 3종 — `traps-reflection.md`, 재빌드 전엔 버튼 줄 자체가 안 뜬다).

| 파일 | 역할 |
|---|---|
| `model/shareCard.ts` | `SHARE_FORMATS`(story·square·feed) · `buildShareCard({summary,trip,format})` 카드 VM(j04 모델 재사용, `totalPhotos===0`→`'no-photo'`, duration 필드 0) · `validateCaption`/`validateHashtags`(온디바이스만, 해시태그 인라인 편집이 재사용) · `periodText`는 시작·종료 **둘 다** 있을 때만 조합([[반쪽 방어 (half-applied guard)]]). 옛 `captureShareImage()` degrade 스텁은 제거됨(→ `model/shareCapture.ts`) |
| `model/shareCard.test.ts` | 조립·mode·aspect·폼검증·INV-3(`JSON.stringify` 소요시간 0)·INV-4·null 방어 |
| `model/shareCapture.ts` | (신규) `isShareCaptureArmed()`(모듈 3종 존재 판정, 없으면 null 조회 — 패키지 정적 import 없음) · `saveShareCardImage(ref)`/`shareShareCardImage(ref)`(캡처→저장/공유, 실패는 전부 `{status:'failed'}` 반환, throw 없음) — `shareCaptureNative.ts`를 `await import`로만 부른다 |
| `model/shareCapture.test.ts` | (신규) armed 판정 3종 개별 부재·저장/공유 성공·권한거부·각 단계 reject |
| `model/shareCaptureNative.ts` | (신규) 캡처 3종 패키지를 **정적 import**하는 유일한 파일(re-export). `features/reflection/` 밖으로 옮기면 `recordPhotoBinaryGuard` 등 다른 스캔 가드에 걸린다(`traps-reflection.md`) |
| `ui/ShareCardScreen.tsx` | `useRef<View>`(`frameRef`)를 `ShareCardPreview`에 내려 캡처 대상 지정 · 저장/공유 press(armed일 때만 버튼 노출) · 해시태그 인라인 편집(`hashtags`/`draft`/`draftError` 로컬 상태, 서버 저장 없음) · `reflection-share-result`(성공/실패/거부 공용 안내) |
| `ui/ShareCardScreen.test.tsx` | armed 판정별 버튼 유무·저장/공유 성공·권한거부·해시태그 편집 검증(개수·길이)·1:1 포맷 캡처 대상 aspectRatio |
| `ui/ShareCardPreview.tsx` | 카드 프리뷰 — `aspectRatio`를 인라인 `style`로 노출, `frameRef`를 프레임 View 자체에 직결(`reflection-share-preview-frame`, 래퍼에 달면 캡처 대상 불일치) |
| `ui/FormatSegment.tsx` | 3셀 포맷 세그(`reflection-share-format-seg`) |
| `ui/ShareCardGlyphs.tsx` | download·share·watermark SVG |

## j05 여행 스타일 분석

**계정 단위**(`/me/style`, tripId 없음, INV-U5-08). 승격 권위는 서버 `official` 플래그뿐 — `progress.current`는 표시용이고 승격 판정에 관여시키지 않는다(PBT-U5-F4, CI 차단). 판정(`resolveStyleFace`)은 `entities/style-analysis/lib/styleFace.ts`(`layer-entities.md`).

| 파일 | 역할 |
|---|---|
| `model/styleThreshold.ts` | `categoryLabel(share)`만 — 집계(상위3+기타)는 서버가 하고 클라는 표시 라벨 변환(`맛집→미식`, `isOther→'기타'`) |
| `model/styleThreshold.test.ts` | `categoryLabel` 매핑 |
| `model/useStyleAnalysis.ts` | `useGetMeStyle` 얇은 래퍼(조회 전용). 반환 타입 애너테이션을 달지 않는다 — `ReturnType<typeof …>`이 오버로드 마지막 시그니처를 집어 `.data`를 뭉갠다 |
| `ui/TravelStyleScreen.tsx` | `face`로만 분기 — official=서브타이틀·지도 placeholder·`CategoryBarList`·`StatTile`×2 / insufficient=진행 게이지·"정식 아님"·descriptor 칩. **INV-3 예외(BR-U5-08a)는 값 인터폴레이션으로 통과**한다 — `StatTile`이 `{value}{unit}`로 조립해 소스에 `72분` 리터럴이 없으므로 소스 스캔 가드가 미매치. `avgDwellMinutes==null`이면 타일째 미렌더(0 채움 금지). 날짜·카테고리 모두 nullish 방어 |
| `ui/TravelStyleScreen.test.tsx` | official·insufficient 상호배타·dwell 표시/null degrade |
| `ui/CategoryBarList.tsx` | `reflection-style-bar`(행당 exact testID View — fill 함정 회피). 최상위 막대만 primary(jest 무심판) |
| `ui/StatTile.tsx` | `reflection-style-stat-places`·`-dwell` — `{value}{unit}` 인터폴레이션 강제 |

지도 히어로는 계약 좌표 공백이라 `MapView` import 0(`LOCKED_CALLERS` 등재 불필요). 진입점은 `features/settings`의 `StyleSummaryCard` `onPressDetail?`(미주입 시 disabled), 라우트는 `app/records/style.tsx`·`pages/travel-style/`.

## 관련

- 개념: [[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]] · [[옵셔널 체이닝은 매 단계 필요]] · [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] · [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]] · [[소스 스캔 가드의 폴더 전수와 자동 편입]] · [[반쪽 방어 (half-applied guard)]] · [[페이지 조립은 jest 무심판]] · [[마운트당 1회 발사 가드 (firedRef)]] · [[invalidateQueries (쿼리 무효화)]]
