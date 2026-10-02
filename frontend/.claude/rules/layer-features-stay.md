---
paths:
  - "src/features/stay/**"
---
# `src/features/stay/` — 숙소 탐색(e02)·상세(e03)·저장(e04)·등록(e05)


판정은 순수 함수(`model/`), 화면은 무상태 프레젠테이션(`ui/`) — `features/stay/ui`는 `useState`를 두지 않으므로(기계 강제 없음) 시트 개폐·선택 초안 같은 상태는 페이지가 쥔다(개념 [[상태 끌어올리기 (lifting state up)]]). 다른 feature 글리프·훅은 import하지 않고 재작성한다. 화면 뷰 4개(e02·e03·e04·e05)와 그 전용 부품(`PartialFailureBanner`·`SkeletonList`·`filterReasonLabel`·`amenityIcons`)은 TRIP-1148로 `pages/stay-*`로 이사했다(`layer-pages.md`) — 여기엔 판정 model·시트 3종·글리프·`affiliateNotice`만 남는다.

| 파일 | 역할 |
|---|---|
| `src/features/stay/model/useStaySearch.ts` | 생성 훅(`useGetStaysSearch`)을 도메인 이름으로 감싼 얇은 층 — 생성물 경로를 한 곳에 가두는 것이 존재 이유다. `options?.enabled`를 생성 훅의 `{ query: { enabled } }`로 매핑한다 — 이 매핑의 실효는 `useStaySearch.integration.test.tsx`(`{enabled:false}`→요청 0건)만 잠근다(`{query:{}}`로 깨져도 tsc는 green) |
| `src/features/stay/model/stayKey.ts` | `` stayKey(item) = `${externalSource}:${externalId}` `` — 계약에 `stayId`가 없어 합성. `keyExtractor`와 testID(`stay-card-{key}`·`stay-card-save-{key}`)의 **유일한 출처**(화면 소스는 `item.externalId`를 직접 안 쓴다 — 기계 강제 없음, 소스 스캔은 TRIP-1145에서 삭제) |
| `src/features/stay/model/staySearchState.ts` | 판별 유니온 `StaySearchState`(`loading`\|`error`\|`results`\|`filter-zero`\|`empty`, partial-failure는 `results.degraded`) + `resolveStaySearchState`(pending→error→results→filter-zero→empty). PBT 대상 |
| `src/features/stay/model/relaxCulpritFilter.ts` | `relaxCulpritFilter(reason, filters)` — `filterReasonLabel`(`pages/stay-search/model`)과 **같은 `split(':')` 규약**으로 원인을 푼다(값이면 그 값만, bare면 축 전체, 모르면 무변경, 비파괴). 라벨과 제거값이 같은 `reasons[0]`에서 나와 "라벨과 다른 걸 지우는" 갈라짐이 없다 |
| `src/features/stay/model/stayRegisterForm.ts` | 등록 폼 판정·조립 — `canSubmitStayRegister`·`buildStayRegisterRequest`·`resolveName`. **zod 없음·날짜 없음**(TRIP-1052 — 요청 키는 `name`·`registerRoute`·`lat`·`lng`·`coordConfirmed` 5개뿐, `checkIn`/`checkOut` 키 자체를 안 싣는다). 요청 모양은 orval 타입이 잠근다. `canSubmitStayRegister` 게이트 순서는 후보 → 좌표 → 제출 중 → 이름(서버 400 의존 금지). `registerRoute`는 `flow.coordSource`를 옮긴다. `resolveName`(트림된 입력 → 건물명 → 빈 문자열)은 게이트·조립·안내가 같은 함수를 써야 판정이 갈라지지 않는다 |
| `src/features/stay/ui/StayGlyphs.tsx` | 숙소 화면 글리프 전부(Figma 벡터 실측, `tone` prop으로 색 변형). 다른 feature 글리프를 재사용하지 않는다. raw hex 소스 스캔은 없다(TRIP-1145에서 삭제) — 저장 하트 같은 상태 신호를 여기 fill로만 두면 jest가 못 본다(`repo-traps.md` 「글리프」) |
| `src/features/stay/ui/OtaChoiceSheet.tsx` | OTA 이동 시트 — `variant: 'default'\|'error'` 두 얼굴. 완전 제어(체크·error 상태의 주인은 `StayDetailPage`). `BODY`/`NOTICE` 문자열은 통합 테스트가 리터럴로 완전일치 잠금 |
| `src/features/stay/model/savedStayIndex.ts` | `findSavedStayId(savedStays, item)` — `externalSource`·`externalId` strict 짝 등가만(외부키 null인 핀·수동 등록은 자동 탈락). `optimisticSavedStayId(key)`는 낙관 삽입 표식. 훅 파일과 분리해 node 버킷에서 열린다 |
| `src/features/stay/model/buildSaveStayRequest.ts` | `StayItem → RegisterSavedStayRequest` **정확히 7키**(`registerRoute:'MAP_SEARCH'`·`coordConfirmed:false`는 정본 공백을 메운 구현 결정 — 요구사항 근거로 인용 금지) |
| `src/features/stay/model/savedStays.ts` | 저장 토글 훅 `useSavedStays({isAuthed})`. `save()`는 문지기다 — **① 인증(미인증은 요청 0 + `failed`, 캐시에 남은 옛 계정 행이 있어도 새지 않는다) → ② 진행 중 잠금(`useRef` Map, 같은 `stayKey`가 가는 중이면 그 promise를 그대로 돌려줌 — POST 1회 보장) → ③ 캐시 멱등(`getQueryData`로 지금 캐시를 읽어 같은 외부키 행이 있으면(낙관 `optimistic:` 행도 포함) 요청 없이 `{saved}`)** 순서로만 판정한다(TRIP-1041, 순서 뒤집으면 게스트에게 `saved`가 샌다). 멱등 판정에 `findSavedStayId`·렌더 클로저 `isSaved`를 쓰면 안 된다 — 낙관 행에 `null`을 줘서 두 번째 POST가 나간다. 실제 요청은 지역 함수 `postSave`(구 `save` 본문 — 낙관 삽입/제거 → POST/DELETE → 성공·409는 `getGetSavedStaysQueryKey()` **하나만** 무효화, 404/네트워크는 롤백만)가 맡고, `.finally`로 잠금을 해제한다(성공·실패 관계없이 — 안 그러면 재시도가 옛 결과에 갇힘, 이 줄을 지켜보는 심판은 없었다가 02c에서 보강됨). `remove`는 잠금을 안 본다(잠금은 `save`만의 계약). `remove`는 `item`을 받는다. `savedCount`(목록 길이)는 `savedKeys`와 의미가 다르다 — 이 값을 실행하는 심판이 없다. 409는 openapi.yaml에 미문서(형제 `/saved-places`는 문서화됨 — 판단성 이상, 새 티켓 후보). ⚠️ `features/trip/model/useSavedStays.ts`(읽기전용)와 동명 별개([[TanStack Query enabled false와 isPending]]) |
| `src/features/stay/model/stayFilterOptions.ts` | `buildStayFilterOptions(items, selected)` — 계약에 enum이 없어 후보를 "조회된 items의 값 ∪ 선택값"에서 파생(선택값은 항상 해제 가능). 한계: 좁힌 결과에 없는 새 값은 발견할 수 없다 |
| `src/features/stay/ui/StayFilterSheet.tsx` | 편의시설·숙소유형 다중선택 시트 — 완전 제어(`useState` 0). 실제 열림·딤은 gorhom 통과형 목의 사각(`repo-traps.md` 바텀시트 절) |
