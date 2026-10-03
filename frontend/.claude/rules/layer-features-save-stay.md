---
paths:
  - "src/features/save-stay/**"
---
# `src/features/save-stay/`

| 파일 | 역할 |
|---|---|
| `src/features/save-stay/model/stayKey.ts` | (TRIP-1155로 features/stay에서 이사) `` stayKey(item) = `${externalSource}:${externalId}` `` — 계약에 `stayId`가 없어 합성. `keyExtractor`와 testID(`stay-card-{key}`·`stay-card-save-{key}`)의 **유일한 출처**(화면 소스는 `item.externalId`를 직접 안 쓴다 — 기계 강제 없음, 소스 스캔은 TRIP-1145에서 삭제) |
| `src/features/save-stay/model/savedStayIndex.ts` | (TRIP-1155로 features/stay에서 이사) `findSavedStayId(savedStays, item)` — `externalSource`·`externalId` strict 짝 등가만(외부키 null인 핀·수동 등록은 자동 탈락). `optimisticSavedStayId(key)`는 낙관 삽입 표식. 훅 파일과 분리해 node 버킷에서 열린다 |
| `src/features/save-stay/model/buildSaveStayRequest.ts` | (TRIP-1155로 features/stay에서 이사) `StayItem → RegisterSavedStayRequest` **정확히 7키**(`registerRoute:'MAP_SEARCH'`·`coordConfirmed:false`는 정본 공백을 메운 구현 결정 — 요구사항 근거로 인용 금지) |
| `src/features/save-stay/model/savedStays.ts` | (TRIP-1155로 features/stay에서 이사) 저장 토글 훅 `useSavedStays({isAuthed})`. `save()`는 문지기다 — **① 인증(미인증은 요청 0 + `failed`, 캐시에 남은 옛 계정 행이 있어도 새지 않는다) → ② 진행 중 잠금(`useRef` Map, 같은 `stayKey`가 가는 중이면 그 promise를 그대로 돌려줌 — POST 1회 보장) → ③ 캐시 멱등(`getQueryData`로 지금 캐시를 읽어 같은 외부키 행이 있으면(낙관 `optimistic:` 행도 포함) 요청 없이 `{saved}`)** 순서로만 판정한다(TRIP-1041, 순서 뒤집으면 게스트에게 `saved`가 샌다). 멱등 판정에 `findSavedStayId`·렌더 클로저 `isSaved`를 쓰면 안 된다 — 낙관 행에 `null`을 줘서 두 번째 POST가 나간다. 실제 요청은 지역 함수 `postSave`(구 `save` 본문 — 낙관 삽입/제거 → POST/DELETE → 성공·409는 `getGetSavedStaysQueryKey()` **하나만** 무효화, 404/네트워크는 롤백만)가 맡고, `.finally`로 잠금을 해제한다(성공·실패 관계없이 — 안 그러면 재시도가 옛 결과에 갇힘, 이 줄을 지켜보는 심판은 없었다가 02c에서 보강됨). `remove`는 잠금을 안 본다(잠금은 `save`만의 계약). `remove`는 `item`을 받는다. `savedCount`(목록 길이)는 `savedKeys`와 의미가 다르다 — 이 값을 실행하는 심판이 없다. 409는 openapi.yaml에 미문서(형제 `/saved-places`는 문서화됨 — 판단성 이상, 새 티켓 후보). ⚠️ `features/trip/model/useSavedStays.ts`(읽기전용)와 동명 별개([[TanStack Query enabled false와 isPending]]) |
