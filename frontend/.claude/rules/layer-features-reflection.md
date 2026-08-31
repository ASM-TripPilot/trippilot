---
paths:
  - "src/features/reflection/**"
---
# `src/features/reflection/` — j03 오늘의 회고 (TRIP-571 신설) · j04 여행 요약 (TRIP-572 추가) · j06 공유 카드 (TRIP-574 추가)

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
| `ui/DailyReflectionScreen.tsx` | **신규.** 무상태 프레젠테이션, 4얼굴(default·data-insufficient·empty·error) + 편집 모드. 편집 진입 컨트롤은 얼굴당 1개로 `reflection-daily-edit` 단일 testID 재사용(`!editing && isDataFace`→헤더 "편집", `!editing && (empty\|error)`→하단 CTA "직접 회고 작성", 둘 다 `handleEnterEdit`). `canSave = text.trim().length>0`, 저장은 `disabled`+`accessibilityState.disabled` 짝. 편집 상한 **4000자**(`EditReflectionRequest.maxLength` 서버 권위 — 티켓의 "2000자"는 `visit_memo`(US-REC-02) 오전이, 티켓-리포 드리프트). 지도는 `@/shared/map` `KakaoMapView`(viewOnly 글랜스, `TripRecordsScreen` 선례 동형) — `itineraryMapSurfaceStructure.test.ts`의 `LOCKED_CALLERS`에 opt-in 등재(개념 [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]], **이 등재 누락이 TRIP-442·563에 이은 3번째 6-a FAIL 재발**이었다 — 문제로그 [[2026-08-30 지도 옵트인 경계 명부 미등재가 두 번째로 반복됐다]]). **5-c 적용(경고-2)**: 실 좌표(`mapCenter`+`mapPins`) 있을 때만 `KakaoMapView` 렌더, 없으면 placeholder — 이전엔 좌표 없을 때 하드코딩 서울 `DEFAULT_CENTER`를 핀 0개로 실데이터처럼 그려 "부산 하루에 서울 지도"가 뜨는 결함이었다(개념 [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] TRIP-571 절 — 좌표는 `Reflection` 계약에 아예 없어 오늘은 늘 이 가지, 실 좌표 배선은 계약 확장 후속 티켓). `mapCenter?`·`mapPins?`는 옵셔널 prop(테스트가 안 넘겨도 컴파일 통과해야 하므로 required 불가). ⚠️ **로딩 얼굴 없음** — 계약에 loading 얼굴이 없어 조회 중(`isPending`)엔 empty로 접혀 "오늘 기록된 활동이 없습니다"가 로딩 중에도 뜬다(거짓 주장, 03b 참고-2 — loading 얼굴 변형 신설은 후속 티켓). **TRIP-574 추가**: additive `canShare?`/`onShare?` prop + 헤더 공유 아이콘(`reflection-daily-share`) — `onShare != null`일 때만 렌더돼 TRIP-571 동결 테스트(onShare 미주입)는 아이콘 부재로 무회귀. `DailyReflectionPage`가 `useGetTripsTripId(tripId).data?.status === 'ENDED'`로 `canShare`를 판정해 내려준다(BR-U5-48, j03 계약엔 종료 신호가 없어 페이지가 추가 조회로 보강). |
| `ui/DailyReflectionScreen.test.tsx` | **T4 AC-5**(empty/error press→`onEnterEdit` 1회, 두 얼굴 모두 하단 CTA가 `reflection-daily-edit`) · **T4 AC-6**(default 헤더 press→편집 모드→`reflection-daily-edit-input` `maxLength={4000}`, 빈/공백→저장 비활성+콜백 0회·유효→활성+1회) · 렌더 스모크(default가 `NarrativeBlock`·`ReflectionStatsRow`·`ReflectionPhotoGrid` 실렌더) · G2 앵커(`@/shared/map` import로 '@/shared/' 소비). |
| `ui/ReflectionStatsRow.tsx` | **신규.** `reflection-daily-stats` 3열(방문·이동·사진), `distanceDash`면 "—". INV-3 삼중 방어 계열 — 소요시간 문자열 0(`${km}km`만, G6). |
| `ui/NarrativeBlock.tsx` | **신규.** `reflection-daily-narrative`, 완성 표시본을 그대로 렌더. `draftNarrative`·`editedNarrative`·`resolveDisplayNarrative` 어느 것도 참조하지 않는다(AC-8이 소스로 강제 — 화면이 자체 폴백을 만들지 못하게). |
| `ui/ReflectionPhotoGrid.tsx` | **신규.** `reflection-daily-photo-grid`, photos 그리드. `Reflection` 스키마에 사진 URL 배열이 없어 페이지가 항상 `photos=[]`로 넘김(계약 공백, 후속 티켓). |
| `ui/ChangeSummaryRow.tsx` | **신규.** `reflection-daily-change-summary`, 변경 요약 행. 하트 버튼은 testID·BR 근거가 없어 범위 밖(자리만, 배선 보류 — 01 브리프 열린 질문 3). |
| `ui/ReflectionGlyphs.tsx` | feature-local SVG(뒤로·위치없음·사진없음·빈원·다시시도). `shared/location/LocationGlyphs.tsx`에 `LocationOffGlyph`가 있으나 features 간 import 금지 + `RecordGlyphs`(TRIP-565) 선례를 따라 feature-local 미러 채택(`*Glyphs.tsx` 관례, raw-hex 스캔 제외). **TRIP-574 추가**: `ShareGlyph`(j03 헤더 공유 아이콘용, `muted` prop 토글) export 추가 — 같은 폴더의 `ShareCardGlyphs.tsx`에 있는 동명 `ShareGlyph`(카드 화면용)와 **독립 정의**, `LocationOffGlyph` 2벌 선례와 동형 패턴(리포 관례상 정상, qa-verifier 04 리포트 §4 확인). |

### j04 여행 요약 (TRIP-572)

**판정을 순수 함수 단일 출처로 뽑고 화면은 무상태 프레젠테이션** — j03 동형(571 교훈 계승). `TripSummaryStats` shape가 j03 `ReflectionStats`와 필드명·구성이 달라(`totalVisits/totalDistanceKm/totalPhotos+hasLocationData`) **`statsCard.ts`(j03)를 개조하지 않고 별 함수로 뒀다**(ponytail lite — 다른 shape는 별 함수).

| 파일 | 역할 |
|---|---|
| `model/summaryView.ts` | **신규.** 판정 4종 + 평탄화 — `shareEnabled(envelope)=envelope.ready===true`(summary 유무 무관) · `resolveSummaryView(stats)=hasLocationData?'MAP':'VISIT_LIST'`(분기 유일 신호) · `toOrderedVisitList(highlights)`(일자 넘어 전역 1..N 평탄화, 입력 순서 보존 — PBT가 임의 입력으로 잠금) · `distanceSourceLabel(source)`(`ROUTE→'경로'`/그 외(VISIT_LINE)→`'근사'`) · `daySubtitle(places)`(≥2→`첫→마지막`/1→그 이름/0→`''`, 테마 문구 발명 금지 BR-U5-31). |
| `model/summaryView.test.ts` | 4종 진리표(shareEnabled·resolveSummaryView·distanceSourceLabel) + `toOrderedVisitList` 예시+PBT(순서 보존·번호 1..N 연속, 빈입력 자가검사) + daySubtitle 케이스. |
| `model/summaryStats.ts` | **신규.** `summaryStats(stats?)→{totalVisits,distanceText,totalPhotos}` — 방문·사진은 `?? 0`(INV-U5-07), 거리는 `!hasLocationData`면 `'—'`(U+2014, 0km 아님) else `${km}km`. |
| `model/summaryStats.test.ts` | undefined/null 입력 0채움 · `hasLocationData:false`+실수치→거리만 대시 · 완전 입력 통과. |
| `model/useTripSummary.ts` | **신규.** `useGetTripsTripIdSummary(tripId)` 얇은 래퍼(새 HTTP 함수 0). envelope 그대로 반환, `source` 보존만(화면 미사용, AI 미개통 BR-U5-33). |
| `ui/TripSummaryScreen.tsx` | **신규.** 무상태 프레젠테이션. `reflection-summary-stats`(3셀 컨테이너) · MAP 분기(좌표 있으면 `KakaoMapView viewOnly`=`map-root`, 없으면 `reflection-summary-map-pending` — 계약에 좌표 필드 자체가 없어 런타임은 늘 이 자리표시, 가짜 기본센터 금지 571 경고-2 동형) · VISIT_LIST 분기(`reflection-summary-visit-item` 목록) · MAP에서만 `DayHighlightCard` · 공유 버튼(`reflection-summary-share`, `disabled`+`accessibilityState.disabled` 짝, press 시 콜백 0회 확인이 실질 그물). **`itineraryMapSurfaceStructure.test.ts` `LOCKED_CALLERS`에 test-designer가 처음부터 선등재**(571·563·442 3번째 재발을 이 사이클에서 끊음, `defaultTags` 14→15). |
| `ui/TripSummaryScreen.test.tsx` | VM 주입 렌더 AC-1(MAP)·AC-2(VISIT_LIST degrade)·AC-3(라벨)·AC-5(공유 비활성 짝), `@/shared/map` 배럴 경유 목. |
| `ui/DayHighlightCard.tsx` | **신규.** 날짜 카드(`reflection-summary-day-card`). 썸네일 자리표시(사진 URL 계약 부재 — 가짜 이미지 금지) · `Day N · M곳` · 부제(`daySubtitle`) · chevron. |

### j06 공유 카드 (TRIP-574)

**지도·경로 핀·사진 썸네일을 그리지 않는다** — Figma 카드는 지도 히어로+동선 핀이지만 `TripSummary`/`DayHighlight` 계약에 좌표가 없고(j04 요약과 동일 공백), `react-native-view-shot`은 WebView(`KakaoMapView`) 콘텐츠를 캡처 못 한다(맹점, 아래 `traps-reflection.md`). 그래서 라이브 지도를 애초에 안 넣어 두 문제를 동시에 회피 — 카드는 워터마크·동선 순서 목록·하단 그라디언트 텍스트 오버레이(지역·기간·제목·통계)로만 조립한다. 캡처·저장·공유(view-shot·media-library·sharing·file-system)는 전부 미설치라 `captureShareImage()`가 `{armed:false}`(`pickPhotoAsset`·`geofence.registerGeofences` 선례 동형)를 돌려주는 degrade 스텁이다.

| 파일 | 역할 |
|---|---|
| `model/shareCard.ts` | **신규.** `SHARE_FORMATS`(story 9:16/square 1:1/feed 4:5) · `buildShareCard({summary,trip,format})`→카드 VM(title=`trip.title`·periodText·regionText·`summaryStats`/`toOrderedVisitList`(j04 모델 재사용)·`mode`(`totalPhotos===0`→`'no-photo'`)·watermark, **duration 필드·문자열 0**) · `validateCaption`/`validateHashtags`(온디바이스 검증만, 서버 호출 0) · `captureShareImage()`→`{armed:false}` degrade 스텁. **5-c 봉합**: `periodText`가 `trip?.startDate && trip?.endDate` 둘 다 있을 때만 조합(한쪽만 게이트하면 반쪽 방어 재발, 개념 [[반쪽 방어 (half-applied guard)]] TRIP-574 절). |
| `model/shareCard.test.ts` | AC-1(조립, 재사용 함수 반환 `toEqual`) · AC-2(mode 분기) · AC-3(aspect) · AC-7(폼검증) · AC-8(INV-3, `JSON.stringify` 소요시간 매치 0) · INV-4(`captureShareImage` armed:false) · 반쪽 방어 3케이스(summary/trip null 방어). |
| `ui/ShareCardScreen.tsx` | **신규.** 무상태 화면(로컬 상태는 선택 포맷·degrade 안내 노출 둘뿐). `FormatSegment`·`ShareCardPreview` 조립 + 저장/공유 버튼(press→`captureShareImage()` armed:false→`reflection-share-degrade` 안내, 크래시 0). |
| `ui/ShareCardScreen.test.tsx` | AC-1·AC-2·AC-3·INV-4 렌더 검증. |
| `ui/ShareCardPreview.tsx` | **신규.** 카드 프리뷰 — `aspectRatio={selectedFormat.aspectRatio}`를 인라인 `style`로 노출(`reflection-share-preview-frame`), 지도 없이 워터마크·동선 목록·그라디언트 오버레이로 조립. |
| `ui/FormatSegment.tsx` | **신규.** 3셀 포맷 세그(`reflection-share-format-seg`), press로 `selectedFormatId` 전환. |
| `ui/ShareCardGlyphs.tsx` | **신규.** 카드 아이콘(download·share·watermark SVG, `*Glyphs.tsx` raw-hex 제외 관례). `ReflectionGlyphs.tsx`의 동명 `ShareGlyph`(j03 헤더용)와 독립 정의. |

j03·j04 진입점 배선: `pages/daily-reflection/ui/DailyReflectionPage.tsx`·`pages/trip-summary/ui/TripSummaryPage.tsx`가 각각 `router.push('/trips/{tripId}/records/share')`로 실체화(`TripSummaryPage.onShare`는 기존 no-op 스텁이었음). 조회·조립 단일 출처는 `pages/share-card/ui/ShareCardPage.tsx`(`layer-pages.md` 참고).

### j05 여행 스타일 분석 (TRIP-573)

**계정 단위**(`/me/style`, tripId 없음, INV-U5-08) — 지금까지 j 밴드 전부가 여행 단위였던 것과 다르다. **판정 한 곳, 화면은 얼굴만**(j03·j04 교훈 계승) — 승격 권위는 서버 `official` 플래그뿐, `progress.current`는 표시용으로만 읽고 승격 판정엔 **아예 관여시키지 않는다**(PBT-U5-F4, CI 차단 게이트).

| 파일 | 역할 |
|---|---|
| `model/styleThreshold.ts` | **신규.** `resolveStyleFace(envelope): 'official'\|'insufficient'` — `official===true && analysis!=null`만 official, 그 외(9↔10 경계 포함) 전부 insufficient. `progress.current`를 아예 안 읽어 자체 승격 합성을 구조적으로 차단(fast-check 500회 PBT로 잠금). `categoryLabel(share)` — 집계(상위3+기타)는 서버(`isOther`)가 이미 함, 클라 몫은 표시 라벨 변환 하나(`맛집→미식`, 나머지 항등, `isOther→'기타'`). [[반쪽 방어 (half-applied guard)]] 방어: envelope/progress/analysis 중첩 결측에도 크래시 0·항상 insufficient. |
| `model/styleThreshold.test.ts` | PBT-U5-F4 fast-check property 3종(numRuns 500) + 9↔10 경계 예제 + 반쪽 방어 케이스 + `categoryLabel` 매핑. |
| `model/useStyleAnalysis.ts` | **신규.** `useGetMeStyle`(orval, `/me/style`) 얇은 래퍼(조회 전용, mutation 0). 반환 타입 애너테이션은 명세 제안(`ReturnType<typeof useGetMeStyle>`)이 오버로드 마지막 시그니처를 집어 `.data`를 뭉개는 tsc 충돌이 나 **뺐다**(직접 호출 추론이 `StyleAnalysisEnvelope\|undefined`로 정확 — MyPage 선례). |
| `ui/TravelStyleScreen.tsx` | **신규.** `face`로만 두 얼굴 분기(재판정 없음). official=서브타이틀·지도 placeholder(`reflection-style-map`)·`CategoryBarList`·`StatTile`×2·`EvidenceLink` / insufficient=진행 게이지(`reflection-style-progress`)·"정식 아님"·`preview.descriptors` 칩. **INV-3 예외를 값 인터폴레이션으로 통과**(★핵심 기법) — `StatTile`이 숫자·단위를 `{value}{unit}` 한 Text로 조립해 소스에 리터럴 `72분` 문자열을 안 둔다. 기존 INV-3 가드 2개(`reflectionStructure.test.ts` G6·`reflectionSummaryStructure.test.ts` AC-4)가 `\d+\s*분` 정규식으로 소스만 훑기 때문에 인터폴레이션 형태는 **미매치**(렌더 출력 `72분`은 이 스캔이 원리적으로 못 봄) → 화이트리스트 추가 없이 두 가드가 무수정으로 통과했다(BR-U5-08a 예외 허용, 실검증 완료 — 04 리포트). `avgDwellMinutes==null`이면 dwell 타일 자체를 안 그린다(0 채움 금지). 텍스트 충돌 회피로 지도 placeholder 문구를 "지도 표시 예정"(EvidenceLink press 후 "준비 중"과 겹침 방지)으로, 정식 얼굴은 descriptors를 안 그린다(임시 얼굴 칩과 `getByText` 매치 겹침 방지). **5-c**: `monthDay(analysis.updatedAt)`이 [[반쪽 방어 (half-applied guard)]] 여섯 번째 변형이었다 — `categoryBreakdown`은 `?? []`로 degrade하는데 서브타이틀 날짜만 무방비(`iso.slice`)였던 비대칭을 nullish 가드로 봉합. |
| `ui/TravelStyleScreen.test.tsx` | AC-2(official 렌더)·AC-3(insufficient 렌더, 상호배타)·AC-5(72분 표시/null degrade). |
| `ui/CategoryBarList.tsx` | **신규.** testID `reflection-style-bar`(행당 1개, exact testID View — SVG 한 장 fill 함정 회피, `StyleSummaryCard` dot 게이지 패턴 계승). 최상위(max) 막대만 primary 색(jest 무심판, [검증] 픽셀 대조). `categories ?? []` 반쪽 방어. |
| `ui/StatTile.tsx` | **신규.** testID `reflection-style-stat-places`·`reflection-style-stat-dwell`. `{value}{unit}` 값 인터폴레이션 강제(위 INV-3 절 참고). |
| `ui/EvidenceLink.tsx` | **신규.** testID `reflection-style-evidence`. 목적지 라우트 정본 부재(계정 단위, 단일 여행 없음) → press는 로컬 "준비 중" degrade만(가짜 이동 0, INV-4). 목적지 정의는 Follow-up E(신규 티켓 후보). |

지도 히어로는 **계약 좌표 공백**(`StyleAnalysisBody`에 avgRadiusKm 스칼라만, lat/lng 없음)이라 `KakaoMapView` import 자체가 0건 — `itineraryMapSurfaceStructure.test.ts`의 `LOCKED_CALLERS` 등재가 불필요하다(j02·j04 관례 계승, [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]]). 실 반경 원 렌더는 좌표 계약 확장 + `shared/map` 확장 선행(Blocker D, 신규 티켓 후보).

진입점 배선: `features/settings/ui/StyleSummaryCard.tsx`의 `my-style-detail`이 `onPressDetail?` prop-gated로 활성화(`disabled={onPressDetail==null}`, 미주입 시 여전히 disabled — backward-compat)됐고 `MyPage.tsx`가 `router.push('/records/style')`를 주입한다(`layer-features-settings.md` 참고). 라우트·페이지는 `app/records/style.tsx`·`pages/travel-style/`(`layer-app.md`·`layer-pages.md` 참고).

## 관련

- 개념: [[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]] · [[옵셔널 체이닝은 매 단계 필요]] · [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] · [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]] · [[소스 스캔 가드의 폴더 전수와 자동 편입]] · [[반쪽 방어 (half-applied guard)]] · [[페이지 조립은 jest 무심판]]
- 개발로그: [[2026-08-31 20260831-trip571-daily-reflection]] · [[2026-09-01 20260831-trip572-trip-summary]] · [[2026-09-01 20260831-trip574-share-card]] · [[2026-09-01 20260901-trip573-travel-style]]
