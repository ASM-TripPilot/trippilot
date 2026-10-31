---
id: curated-stays
band: e
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes: []
---

# 인기 숙소 (Trip.com 큐레이션)

사용자는 지역의 인기 숙소(Trip.com 큐레이션)를 가로 카드 줄로 보고, 카드 하트로 저장하고, 카드나 「Trip.com에서 전체 숙소 보기」를 누르면 제휴 고지 시트를 거쳐 Trip.com(호텔 상세 또는 지역 숙소 목록)을 외부 브라우저로 연다. 앱 안 상세는 없다. 같은 위젯이 숙소 검색 결과(e02) 목록 머리, 탐색 탭(d01) 지역 필터의 숙소 레인, 일정의 동선 기준 숙소 추천(h15) 빈 얼굴 세 곳에 얹히고, 자리마다 제목·전체 보기 노출이 다르다. 자기 라우트가 없는 위젯이라 `routes`가 비어 있다.

## Sub-features

- `curated-row` 카드 줄: 160 폭 카드(숙소 사진·이름·주소 한 줄·하트). 평점·가격은 없다.
- `curated-hidden` 지역 조건 없음·게스트·로딩·실패·빈 목록이면 카드 줄과 제목이 통째로 숨는다(자리에 따라 전체 보기 버튼만 남는다).
- `curated-save` 카드 하트로 저장/해제(좌표 없이 저장). 요청 중엔 그 카드 하트가 잠긴다. 미인증이면 로그인 화면으로 간다.
- `curated-open-hotel` 카드 탭 → 제휴 고지 시트(「Trip.com」, 가격 칸 없음) → [Trip.com으로 이동] → 호텔 상세 아웃바운드.
- `curated-browse-all` 「Trip.com에서 전체 숙소 보기」 → 같은 시트 → 지역 숙소 목록 아웃바운드(`/stays/browse/outbound`).
- `curated-trip-context` 일정 추천(h15)에서 열면 여행 날짜·인원이 맞는 값일 때 아웃바운드 쿼리(`checkin`·`checkout`·`adults`)에 붙는다.
- `curated-in-search` 숙소 검색 결과: 제목 「인기 숙소」 + 줄 + 전체 보기. 줄은 `regionCode`가 있을 때만 묻는다.
- `curated-in-explore` 탐색 지역 필터: 인기 숙소가 오면 숙소 레인이 이 줄로 바뀌고 레인 제목이 「인기 숙소」가 된다. 전체 보기는 없다.
- `curated-in-recommend` 동선 기준 추천이 없을 때: 인기 숙소가 있으면 「인기 숙소」 얼굴 + 줄 + 전체 보기 + [돌아가기], 없으면 「지금은 동선 기준 추천을 보여 드릴 수 없어요」 빈 얼굴 아래 전체 보기만.

## How to get to it (user POV)

- 여행지 선택(숙소 목적)에서 지역을 골라 숙소 검색 결과(e02)에 들어간다 — 이때만 `regionCode`가 실려 줄이 뜬다.
- 탐색 탭에서 지역을 골라(`/explore?region={regionCode}`) 지역 필터 랜딩의 숙소 레인.
- 일정 → 동선 기준 숙소 추천(`/trips/{tripId}/itinerary/stay-recommend`)에서 추천 후보가 없을 때.
- 저장한 숙소(e04)에서 Trip.com 출처 카드를 누르는 것도 같은 아웃바운드 흐름이다 — `saved-stays.md`.
- 딥링크로 위젯만 여는 경로는 없다. `trippilot://explore?region=11` 처럼 담는 화면을 연다(서울 코드는 예시, 실제 코드값은 지역 카탈로그 확인 필요).

## Driving it with agent-device

Preconditions:

- 소셜 로그인 완료(`GET /stays/curated`는 인증 필요 — 게스트는 요청 자체가 없다).
- 큐레이션 시드가 있는 지역을 고른다. 앱은 서울·부산·제주·인천·대구·강릉·속초·경주·전주 코드면 도시 이름으로 묻는다. 그 밖 지역은 빈 목록일 수 있다.
- 「이 안내를 다시 보지 않기」가 꺼진 계정(`stay-detail.md` Preconditions).

- **숙소 검색 결과에서.** 숙소 검색 결과의 [지역] 칩 → 여행지 선택에서 「부산」 계열 지역을 고른다. 목록 머리에 testID: `stay-search-curated`, 제목 testID: `stay-search-curated-title` 「인기 숙소」, 줄 testID: `stay-search-curated-row`, 버튼 testID: `curated-stay-browse-all` 「Trip.com에서 전체 숙소 보기」가 보인다.
- **카드.** 카드 testID: `curated-stay-card-{hotelId}`(라벨 `{이름}, {주소}` — 주소 없으면 이름만, 2026-10-31 부산 카드는 전부 이름만), 사진 testID: `curated-stay-photo-{hotelId}`, 주소 testID: `curated-stay-address-{hotelId}`(주소 있을 때만), 하트 testID: `curated-stay-heart-{hotelId}`(글리프 `-filled`/`-outline`). `hotelId`는 서버 `stayId` `TRIPCOM:{hotelId}`의 콜론 뒤 값이다.
- **줄 숨김.** 딥링크 `com.trippilot.travel://stays?region=부산`(코드 없음, URL 인코딩)으로 연다. testID: `stay-search-curated`는 있지만 제목·줄이 없고 testID: `curated-stay-browse-all`만 남는다.
- **하트.** testID: `curated-stay-heart-{hotelId}`를 누른다. `-outline` → `-filled`. 저장한 숙소(e04)에 그 이름의 카드가 생겼는지 다른 화면에서 확인한다. 다시 눌러 해제한다.
- **카드 → Trip.com.** 카드를 누른다. testID: `stay-ota-sheet`(「외부 사이트로 이동」)가 뜨고 OTA 행 testID: `stay-ota-option-TRIPCOM`은 「Trip.com」만(가격 칸 없음), 버튼 testID: `stay-ota-confirm` 「Trip.com으로 이동」이다. 누르면 외부 브라우저가 `…/stays/TRIPCOM:{hotelId}/outbound`를 연다 — **열리는 것까지만 확인, 예약·결제 진행 금지**.
- **전체 보기.** testID: `curated-stay-browse-all`을 누른다. 같은 시트(「Trip.com」)가 뜨고 [Trip.com으로 이동]이 `…/stays/browse/outbound?…`(지역 이름·코드)를 연다. testID: `stay-ota-cancel`로 닫으면 화면 그대로다.
- **탐색 지역 필터에서.** 탐색 탭 → 지역 선택 → 부산 계열 지역. 숙소 레인 제목이 「인기 숙소」로 바뀌고 줄 testID: `curated-stays-row`가 보인다. 전체 보기 버튼은 없다. 인기 숙소가 숨김이면 레인은 `{지역} 숙소` 제목의 일반 숙소 카드 그대로다.
- **일정 추천에서.** 추천 후보가 없는 여행의 동선 기준 숙소 추천을 연다. 인기 숙소가 있으면 「인기 숙소」 제목과 testID: `stay-recommend-curated-notice` 안내, 줄 testID: `stay-recommend-curated-row`, testID: `curated-stay-browse-all`, testID: `stay-recommend-empty-back` 「돌아가기」가 보인다. 없으면 testID: `stay-recommend-empty` 「지금은 동선 기준 추천을 보여 드릴 수 없어요」 + testID: `stay-recommend-empty-browse`·testID: `stay-recommend-empty-back` 아래 testID: `curated-stay-browse-all`만.

## Gotchas

- 숙소 검색 결과에선 지역 피커를 거쳐 `regionCode`가 실린 진입에서만 줄이 뜬다. 탐색 「모두 보기」의 전국 레인 진입·여행 위저드·저장한 숙소 [숙소 둘러보기] 같은 `region`만 싣는 진입은 전체 보기 버튼만 보인다 — 결함이 아니다.
- 운영(main) 서버는 `?city=`만 받고 `?regionCode=`는 400이라 줄이 숨는다. 앱이 아는 9개 도시 코드는 city로 바꿔 묻지만, 그 밖 지역은 운영에서 숨고 개발 서버에선 보일 수 있다 — 서버마다 결과가 다를 수 있다.
- 로딩·실패·빈 목록이 모두 "숨김" 하나로 접힌다. 줄이 안 보이면 실패인지 빈 목록인지 화면으로 구분할 수 없다 — 네트워크 로그나 다른 지역으로 대조한다.
- 카드 testID의 `{hotelId}`는 `TRIPCOM:` 접두를 뗀 값이다. 저장한 숙소(e04) 쪽은 `savedStayId` 기준이라 같은 숙소라도 키가 다르다.
- 인기 숙소에서 저장한 숙소는 앱 안 상세가 없어 저장한 숙소(e04)에서 눌러도 제휴 시트로 간다. 마이 → 등록 숙소에선 출처 칩이 「탐색에서 저장」이다.
- 「다시 보지 않기」를 체크하면 이 위젯의 카드·전체 보기도 시트 없이 바로 외부로 나간다(계정 저장).
- [실화면 전용] 가로 스크롤 줄·시트 열림·딤·외부 브라우저 열림·Trip.com 리다이렉트 결과는 실화면으로만 확인된다. 카드 사진은 외부 이미지라 네트워크에 따라 회색일 수 있다.
- [실화면 전용] 시트는 화면 루트 형제로 그려진다. 스크롤 중간에서 열어도 화면 전체를 덮는지 실화면에서 본다.
- **[실화면] 2026-10-31 딥링크는 `com.trippilot.travel://…` 스킴으로만 화면이 바뀐다** — `simctl openurl "trippilot:///…"` 는 앱만 앞으로 오고 라우팅되지 않았다(이 dev build Info.plist 에 `trippilot` 스킴이 네이버 로그인 urlScheme 으로 한 번 더 등록돼 있다, [결함 의심 FM-L1-04]).
- [결함 의심 FM-L1-03] 탐색 지역 필터(d01)에서 카드로 연 제휴 시트의 [취소]·[Trip.com으로 이동]이 탭바 아래 깔려 누를 수 없다 — 누르면 탭바가 받는다(tab-bar.md). 숙소 검색(e02)·저장한 숙소(e04)에선 정상.
- [실화면] 2026-10-31 도달 불가 — `curated-in-recommend`·`curated-trip-context`(동선 기준 숙소 추천은 일정 기능 소관이고 진행 중 여행 수정 금지), `curated-hidden` 중 게스트·로딩·실패(로그아웃·네트워크 차단 불가 — 지역 코드 없는 숨김만 확인).
- [실화면] 2026-10-31 「Trip.com에서 전체 숙소 보기」·카드 [이동]은 Safari 에서 Google 검색(「제주특별자치도 숙소 예약」 등)으로 갔다 — 서버 리다이렉트가 Trip.com 이 아니다(dev-api 제휴 설정 추정).
