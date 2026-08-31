---
paths:
  - "src/features/reflection/**"
---
# `src/features/reflection/` — j03 오늘의 회고 (TRIP-571 신설)

**이 폴더는 이번 사이클(TRIP-571)에서 처음 생겼다.** 화면 계약은 backend openapi `Reflection`(orval이 이미 생성, `ai/docs/openapi.json`의 `/ai/v1/reflection/generate`와는 무관 — 그건 SNS 카드 템플릿). load-bearing 계약은 두 축 — **"어떤 응답이 와도 빈 화면을 안 그린다"(폴백 3단, PBT-U5-F1)** 와 **"표시본 결정을 한 곳에서만 한다"(AC-8)**.

**경계**: `features/reflection`은 **다른 `features/*`(특히 `record`)를 import할 수 없다**. `eslint.config.js`의 `FEATURES` 배열엔 `reflection`이 없어 기계 강제 밖 — `reflectionStructure.test.ts`의 G2(소스 재귀 스캔, `recordsStructure.test.ts` 동형)가 이 경계의 유일한 그물이다.

| 파일 | 역할 |
|---|---|
| `model/reflectionFallback.ts` | **신규.** `resolveDisplayNarrative(res: Reflection \| undefined): string` — 표시본 결정의 **단일 지점**(AC-8이 소스 스캔으로 강제). 3단: ①서버 `narrative`가 비지 않으면 그대로(서버가 이미 `edited ?? draft`로 결정해 내려줌, openapi `Reflection.narrative` 주석 근거 — 클라 재판정 금지) ②결측·빈문자열이면 `editedNarrative ?? draftNarrative` ③그마저 없으면 `statsCard(res?.stats)`로 조립한 BASIC 문장. **클라 함수는 1차 결정자가 아니라 빈 화면 방지 최후수단**(방어층, 개념 [[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]]) — 그래서 응답 자체 결측(undefined)·필드 결측·빈/공백을 전부 방어한다(`nonEmpty` = `typeof string && trim().length>0`). |
| `model/reflectionFallback.test.ts` | **T1 AC-1(PBT-U5-F1, CI 차단)**: 임의 `Reflection \| undefined`(narrative 빈 문자열·`editedNarrative` null·응답 자체 undefined·stats 결측 조합 포함)에도 표시본 `trim().length>0`. **T1 AC-2**: ①narrative 우선(edited/draft 있어도 재조립 안 함) ②빈→edited ③공백+null edited→draft ④⑤전부 결측→BASIC 비지 않음. |
| `model/statsCard.ts` | **신규.** `statsCard(stats?): ReflectionStats` — `?? 0`/`?? 'VISIT_LINE'`로 네 필드(`visitCount`·`distanceKm`·`distanceSource`·`photoCount`) 0채움(INV-U5-07, `stats`는 비어 있을 수 없다). `?? 0`은 null/undefined만 대체하므로 실제 0/12 값은 그대로 통과 — "빈 것"과 "0인 것"을 안 섞는다. |
| `model/statsCard.test.ts` | **T2**: undefined/null 입력→0s(distanceSource는 `'ROUTE'\|'VISIT_LINE'` 안에서만) · 완전 입력→`toEqual(given)` · 숫자 필드 `typeof 'number'`. |
| `model/missingParts.ts` | **신규.** `missingParts(stats): {hidePhotoGrid, mapNotice, distanceDash}` — `photoCount===0`→`hidePhotoGrid`(하이라이트 생략), `visitCount<2`→`mapNotice`(위치 기록 없음 안내 문자열)+`distanceDash`("—"는 값이 아니라 플래그, `distanceKm`은 required number라 실제로 대시 문자열을 넣지 않는다). BR-U5-34(부분 데이터 시 누락을 명시 — 조용히 칸을 지우지 않는다)의 실체. |
| `model/missingParts.test.ts` | **T3**: photoCount===0→hidePhotoGrid on / visitCount<2→mapNotice(`trim>0`)+distanceDash on / visitCount≥2·photoCount≥1→전부 off(짝 검증). |
| `model/useDailyReflection.ts` | **신규.** 재사용 3훅(`useGetTripsTripIdReflections`·`usePostTripsTripIdReflectionsDayDate`·`usePutTripsTripIdReflectionsDayDate`, 새 HTTP 함수 0)만 감싸 목록 GET에서 `dayDate` 항목을 골라내고 create/saveEdit 뮤테이션을 래핑한다. `source`(`AI\|RULE\|BASIC`)는 보존만 하고 화면 분기에 안 쓴다(AI 단 미개통, BR-U5-33 — 개념 [[옵셔널 체이닝은 매 단계 필요]]). **5-c 적용(경고-1)**: `list.data?.items.find(...)` → `list.data?.items?.find(...)`(`?.`가 `data`만 방어하고 `items`는 미방어라 `{}`/`{items:null}` 200 응답에 `undefined.find` TypeError로 레드박스 — `StaySearchPage` W-3 동형 함정). |
| `ui/DailyReflectionScreen.tsx` | **신규.** 무상태 프레젠테이션, 4얼굴(default·data-insufficient·empty·error) + 편집 모드. 편집 진입 컨트롤은 얼굴당 1개로 `reflection-daily-edit` 단일 testID 재사용(`!editing && isDataFace`→헤더 "편집", `!editing && (empty\|error)`→하단 CTA "직접 회고 작성", 둘 다 `handleEnterEdit`). `canSave = text.trim().length>0`, 저장은 `disabled`+`accessibilityState.disabled` 짝. 편집 상한 **4000자**(`EditReflectionRequest.maxLength` 서버 권위 — 티켓의 "2000자"는 `visit_memo`(US-REC-02) 오전이, 티켓-리포 드리프트). 지도는 `@/shared/map` `KakaoMapView`(viewOnly 글랜스, `TripRecordsScreen` 선례 동형) — `itineraryMapSurfaceStructure.test.ts`의 `LOCKED_CALLERS`에 opt-in 등재(개념 [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]], **이 등재 누락이 TRIP-442·563에 이은 3번째 6-a FAIL 재발**이었다 — 문제로그 [[2026-08-30 지도 옵트인 경계 명부 미등재가 두 번째로 반복됐다]]). **5-c 적용(경고-2)**: 실 좌표(`mapCenter`+`mapPins`) 있을 때만 `KakaoMapView` 렌더, 없으면 placeholder — 이전엔 좌표 없을 때 하드코딩 서울 `DEFAULT_CENTER`를 핀 0개로 실데이터처럼 그려 "부산 하루에 서울 지도"가 뜨는 결함이었다(개념 [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] TRIP-571 절 — 좌표는 `Reflection` 계약에 아예 없어 오늘은 늘 이 가지, 실 좌표 배선은 계약 확장 후속 티켓). `mapCenter?`·`mapPins?`는 옵셔널 prop(테스트가 안 넘겨도 컴파일 통과해야 하므로 required 불가). ⚠️ **로딩 얼굴 없음** — 계약에 loading 얼굴이 없어 조회 중(`isPending`)엔 empty로 접혀 "오늘 기록된 활동이 없습니다"가 로딩 중에도 뜬다(거짓 주장, 03b 참고-2 — loading 얼굴 변형 신설은 후속 티켓). |
| `ui/DailyReflectionScreen.test.tsx` | **T4 AC-5**(empty/error press→`onEnterEdit` 1회, 두 얼굴 모두 하단 CTA가 `reflection-daily-edit`) · **T4 AC-6**(default 헤더 press→편집 모드→`reflection-daily-edit-input` `maxLength={4000}`, 빈/공백→저장 비활성+콜백 0회·유효→활성+1회) · 렌더 스모크(default가 `NarrativeBlock`·`ReflectionStatsRow`·`ReflectionPhotoGrid` 실렌더) · G2 앵커(`@/shared/map` import로 '@/shared/' 소비). |
| `ui/ReflectionStatsRow.tsx` | **신규.** `reflection-daily-stats` 3열(방문·이동·사진), `distanceDash`면 "—". INV-3 삼중 방어 계열 — 소요시간 문자열 0(`${km}km`만, G6). |
| `ui/NarrativeBlock.tsx` | **신규.** `reflection-daily-narrative`, 완성 표시본을 그대로 렌더. `draftNarrative`·`editedNarrative`·`resolveDisplayNarrative` 어느 것도 참조하지 않는다(AC-8이 소스로 강제 — 화면이 자체 폴백을 만들지 못하게). |
| `ui/ReflectionPhotoGrid.tsx` | **신규.** `reflection-daily-photo-grid`, photos 그리드. `Reflection` 스키마에 사진 URL 배열이 없어 페이지가 항상 `photos=[]`로 넘김(계약 공백, 후속 티켓). |
| `ui/ChangeSummaryRow.tsx` | **신규.** `reflection-daily-change-summary`, 변경 요약 행. 하트 버튼은 testID·BR 근거가 없어 범위 밖(자리만, 배선 보류 — 01 브리프 열린 질문 3). |
| `ui/ReflectionGlyphs.tsx` | **신규.** feature-local SVG(뒤로·위치없음·사진없음·빈원·다시시도). `shared/location/LocationGlyphs.tsx`에 `LocationOffGlyph`가 있으나 features 간 import 금지 + `RecordGlyphs`(TRIP-565) 선례를 따라 feature-local 미러 채택(`*Glyphs.tsx` 관례, raw-hex 스캔 제외). |

## 관련

- 개념: [[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]] · [[옵셔널 체이닝은 매 단계 필요]] · [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] · [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]] · [[소스 스캔 가드의 폴더 전수와 자동 편입]]
- 개발로그: [[2026-08-31 20260831-trip571-daily-reflection]]
