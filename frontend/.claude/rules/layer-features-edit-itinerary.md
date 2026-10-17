---
paths:
  - "src/features/edit-itinerary/**"
---
# `src/features/edit-itinerary/`

| 파일 | 역할 |
|---|---|
| `src/features/edit-itinerary/model/itineraryEditStore.ts` | (TRIP-1155로 features/itinerary에서 이사) 편집 드래프트 스토어(Zustand) + 순수 헬퍼 `removeSlot`(첫 자리만, 비파괴)·`reorderKeepingFixed`(고정 슬롯을 원래 절대 인덱스에 재고정, INV-U3-02)·`addSlot`·`insertSlotAt`(`splice` 준용 클램프)·`adjustSlotTime`(시각 3필드만). `seed`는 얕은 복사. `EditorSlot`·`EditorDaysItem`은 `startAt: string\|null`을 허용하는 **로컬 확장 타입**(서버 계약은 non-nullable — 개념 [[로컬 확장 타입 — 서버 코드젠 타입 무오염]]). |
| `src/features/edit-itinerary/model/buildEditItineraryRequest.ts` | (TRIP-1155로 features/itinerary에서 이사) 편집 `days` → PUT 봉투. 슬롯당 5필드만(`poiId·startAt·endAt·isFixed·endsNextDay`), 시각은 **원본 그대로**(`slice(0,5)` 절단 금지), `endsNextDay` 보존(HC4), 배열 순서=슬롯 순서(INV-U3-02). `startAt === null` 슬롯은 제외한다(사용자 안내는 이 함수 밖). |
| `src/features/edit-itinerary/model/useEditorDraft.ts` | **(TRIP-1357 신규)** `useEditorDraft(editingSlotKey)` — `ItineraryEditPage`·`ManualPlanPage` 가 똑같이 쥐던 편집 스토어 5셀렉터(seed·deleteSlot·reorderSlots·adjustSlotTime·days)와 `parseSlotKey`→`editing`·`editingSlot` 도출을 한 곳에. 시트 개폐 state 는 페이지가 쥐고 키만 넘긴다. 확정 부수효과는 이 훅이 아니라 아래 `useConfirmItinerary` 소관 |
| `src/features/edit-itinerary/model/useConfirmItinerary.ts` | **(TRIP-1357)** `useConfirmItinerary(tripId, onConfirmed?)` — 확정 POST 훅(`usePostTripsTripIdItineraryConfirm`) 래퍼. 훅 옵션에 성공 시 응답→조회 캐시 쓰기 + `void markDoneBarSeen(tripId)`(TRIP-1428 — `entities/trip`, 완료 배너 seen 기록; 호출별 onSuccess 가 아니라 훅 옵션이라 확정 응답 대기 중 화면을 떠나도 기록된다. `markDoneBarSeen` 은 throw·거절 0 계약이라 배럴을 통째로 목으로 바꾼 다른 확정 테스트(`readIdSet` undefined)를 안 깬다) + `onConfirmed()`, 실패 시 **409 에서만** 재조회. `ManualPlanPage`·`ItineraryPlanPage` 가 공유한다. 위저드 reset(형제 feature `create-trip`)·이동·press 가드 창·토스트·인라인 오류 안내는 페이지가 콜백/호출별 옵션으로 쥔다 — 이 훅은 `useTripWizardStore` 를 import 하지 않는다. |
| `src/features/edit-itinerary/model/swapSlotPoi.ts` | (TRIP-1155로 features/itinerary에서 이사) `swapSlotPoi(days, {date,poiId}, nextPoiId)` — 첫 일치 슬롯의 poiId만 치환(비파괴, BR-U3-23). |
| `src/features/edit-itinerary/model/slotSwapError.ts` | (TRIP-1155로 features/itinerary에서 이사) `resolveSlotSwapError(error)` — 409 `error.code` 3분기(확정일정/생성중/슬롯특정불가, 대표값 상수) + 그 밖은 전부 폴백(침묵 없음, INV-4). |
| `src/features/edit-itinerary/ui/SaveConflictDialog.tsx` | (TRIP-1155로 features/itinerary에서 이사) 저장 뒤 위반 요약 게이트(「N곳에서 시간이 안 맞아요」 + [고치기]/[그대로 …]). props-only 뷰 — 언제 띄우고 버튼이 무엇을 하는지는 `ManualPlanPage`·`ItineraryEditPage`가 각자 쥔다(두 화면 토스트 시점이 반대). 서버 사유 문자열을 prop 으로 받지 않는다(INV-3). 조건부 `absolute inset-0` 오버레이 10번째 — 딤·중앙정렬·터치 차단 jest 사각(6-b). Figma 프레임 없음, `TripDeleteDialog` 토큰 복제. |
