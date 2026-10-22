---
paths:
  - "src/features/curated-stay/**"
---
# `src/features/curated-stay/` — 인기 숙소(Trip.com 큐레이션) 목록·카드 (TRIP-1579)

`GET /stays/curated` 목록과 그 순수 뷰. 저장·제휴 흐름은 모른다(features 끼리 import 금지) — 하트 상태·핸들러는 props 로 받고, 이어 붙이기는 `widgets/curated-stays`가 한다. 앱 안 인기 숙소 상세는 없다(서버 `GET /stays/{id}`가 TRIPCOM 출처를 모른다 — 카드 누름은 곧 아웃바운드). steiger `insignificant-slice` 예외 5(참조 1)가 걸려 있다.

| 파일 | 역할 |
|---|---|
| `src/features/curated-stay/index.ts` | 공개 API — `index.view` + `useCuratedStays` |
| `src/features/curated-stay/index.view.ts` | 네트워크 없는 진입점 — `curatedKey`·`BrowseAllButton`·`CuratedStayCard`·`CuratedStayRow` |
| `src/features/curated-stay/model/useCuratedStays.ts` | `useCuratedStays({regionCode?, city?, isAuthed})` → `{items, hidden}`. 카탈로그 코드를 그대로 `regionCode`로(이름을 city 로 넘기면 빈 목록), 둘 다면 regionCode 만. 조건 없음·게스트(인증 필요 계약 — 요청 0, 캐시도 접는다)·로딩·실패·빈 목록이 전부 `hidden` |
| `src/features/curated-stay/model/curatedKey.ts` | `stayId`('TRIPCOM:{hotelId}') → `{externalSource, externalId, name}` — **첫 콜론으로만** 가른다. 저장 훅 입력(`SavableStay`)과 카드 testID(hotelId)의 출처 |
| `src/features/curated-stay/ui/CuratedStayCard.tsx` | 160 폭 카드 — 사진(`shared/ui/Image`, cover)·이름·하트(`HeartButton`), 주소는 truthy 일 때만 한 줄(`curated-stay-address-{id}`). 평점·가격 없음(BR-U1-18). testID `curated-stay-card-{id}`·`curated-stay-heart-{id}`(`-filled`/`-outline`)·`curated-stay-photo-{id}`. 대기 하트 누름이 부모로 새므로 카드 `!pending` 가드(PlaceRailCard 선례) |
| `src/features/curated-stay/ui/CuratedStayRow.tsx` | 가로 `ScrollView` 줄(카드 간격 `gap-md` 고정, 좌우 여백·번짐은 `className`·`contentPaddingClassName`으로 소비처가 준다). `pendingStayId` 카드만 하트 잠금 |
| `src/features/curated-stay/ui/BrowseAllButton.tsx` | 「Trip.com에서 전체 숙소 보기」 윤곽 버튼(`curated-stay-browse-all`, 시트 [취소] 버튼과 같은 모양) |
