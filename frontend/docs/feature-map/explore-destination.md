---
id: explore-destination
band: d
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/(tabs)/explore.tsx
  - app/explore/region.tsx
  - app/explore/destination/[region].tsx
---

# 탐색 랜딩 · 지역 선택 · 여행지 상세

탐색 탭(d01)은 「무엇을 둘러볼까요?」 헤딩 아래 가짜 검색창(「도시 검색」), 숙소 가로 레인, 장소 가로 레인, 우하단 담은 곳(♥)·여행 만들기(＋) FAB 을 보여 준다. 지역 필터가 없으면 서울·부산·제주 서비스 지역만 모아 보이고, 지역 선택(d1b)에서 시도·구군을 고르면 그 지역 코드가 `region` 파라미터로 붙어 같은 탭이 「{지역} 숙소」·「{지역} 장소」로 좁혀진다(옛 여행지 상세 화면을 이 필터로 합쳤다). 지역 선택 화면은 다른 목적(숙소·위저드 도시 추가·장소 탐색 지역 바꾸기)에도 쓰이며 목적에 따라 카피와 돌아갈 곳만 다르다.

## Sub-features

- `explore-landing` 필터 없음 — 레인 제목 「숙소」·「장소」, 숙소는 주소가 서울·부산·제주인 것만, 장소는 3지역에서 8장.
- `explore-region-filter` `region` 코드가 있으면 검색창 안에 지역 칩 + ✕, 레인 제목 「{지역} 숙소」·「{지역} 장소」, 인기 숙소가 오면 숙소 레인이 「인기 숙소」로 바뀐다.
- `explore-region-clear` 칩 ✕ → `region` 을 비우고 전국 랜딩으로.
- `explore-region-unresolved` 코드를 카탈로그에서 못 찾음·카탈로그 실패 → 칩 라벨이 코드 그대로, 두 레인 모두 재시도 얼굴(재시도 = 카탈로그 재조회).
- `explore-loading` 숙소·장소 중 하나라도 첫 조회 중 → 숙소 2·장소 3 스켈레톤, FAB 미렌더.
- `explore-stay-lane` 숙소 카드 press → 숙소 상세, ♥ 담기/해제, 「모두 보기」 → 숙소 검색(stay-search.md).
- `explore-stay-error` 숙소 레인 실패 → 「숙소를 불러오지 못했어요」 + 「다시 시도」.
- `explore-stay-save-error` 숙소 ♥ 실패 → 「담기에 실패했어요. 잠시 후 다시 시도해 주세요.」 배너.
- `explore-place-lane` 장소 카드 press → 장소 상세, ♥ 담기/해제, 「모두 보기」 → 장소 탐색(explore-places.md).
- `explore-place-error` 장소 레인 실패 → 「장소를 불러오지 못했어요 · 다시 시도」.
- `explore-place-empty` 장소 0장 → 「가볼 만한 장소 둘러보기 ›」(누르면 장소 탐색).
- `explore-place-save-error` 장소 ♥ 실패 → 담기/해제별 안내 배너.
- `explore-saved-menu` ♥ FAB → 「담은 장소」·「저장한 숙소」 미니 FAB + 딤.
- `explore-create-trip` ＋ FAB → 위저드 1/4(드래프트 초기화).
- `region-picker-render` 앱바(목적별 「지역 선택」/「여행지 선택」), 헤딩, 검색 입력, 「인기 지역」/「인기 여행지」 스트립, 「지역별 둘러보기」 시도 행 목록.
- `region-picker-drilldown` 시도 행·인기 카드 press → 「{시도} 전체」 + 구군 카드, 「지역 목록」으로 1단 복귀.
- `region-picker-search` 검색어 입력 → 「검색 결과」 평면 카드(구군엔 시도명 부제), 0건이면 「검색 결과가 없어요」.
- `region-picker-select` 선택 가능 카드 press → 목적별 복귀(explore = 탐색 탭 필터).
- `region-picker-disabled` 장소 0곳 지역 = 흐린 카드 「추천 장소 없음」(눌러도 무반응), 묶음(선택 불가) 지역 = 회색 행.
- `region-picker-loading` 카탈로그 조회 중 스켈레톤 4칸 / `region-picker-error` 「지역을 불러오지 못했어요」 + 「다시 시도」.
- `destination-redirect` 옛 주소 `/explore/destination/{코드}` → 같은 코드로 거른 탐색 탭으로 즉시 리다이렉트.

## How to get to it (user POV)

- 하단 탭바 「탐색」(`shell-tabbar-tab-explore`) — tab-bar.md.
- 홈 도시 카드(서울·부산·제주) → `/explore?region={코드}` — home.md.
- 홈 검색바 → 지역 선택 `/explore/region?purpose=explore` → 고르면 `/explore?region={코드}`.
- 탐색 랜딩 검색창 → 같은 지역 선택(purpose=explore).
- 지역 선택의 다른 목적(이 파일은 화면만 다루고 결과 화면은 각 파일 소관): 숙소 검색 지역 칩·「지역 바꾸기」 → `purpose=stay`(→ `/stays`, stay-search.md) · 위저드 「도시 추가」 → `purpose=trip`(→ 위저드에 1박으로 담고 뒤로) · 장소 탐색 지역 칩·「다른 지역 보기」 → `purpose=places`(→ `/explore/places?region={이름}`, explore-places.md).
- `(tabs)` 밖 복제 탭바(장소 탐색·숙소 검색)의 「탐색」 → 쌓인 화면을 걷고 탐색 탭으로.
- 딥링크: `trippilot:///explore`·`trippilot:///explore?region=26`(로그인 필요 — `(tabs)` 가드), `trippilot:///explore/region?purpose=explore`(가드 밖), `trippilot:///explore/destination/26`(가드 밖 리다이렉트지만 도착지 `/explore` 는 `(tabs)` 라 로그인 필요).
- 푸시 알림·도우미에서 이 세 화면으로 오는 길은 없다(도우미는 장소 상세로만 보낸다).

## Driving it with agent-device

Preconditions:

- 로그인 완료 계정. 레인을 채우려면 서버에 서울·부산·제주 장소·숙소가 있어야 한다. 지역 필터 증명은 카탈로그(`GET /regions`)에 그 코드가 있어야 한다(서울 `11`·부산 `26`·제주 `50`).
- 인기 숙소 레인은 그 지역 인기 숙소 응답이 비어 있지 않을 때만 보인다(dev-api 제휴 모드에 따라 다름 — 확인 필요).

- **랜딩.** 「탐색」 탭을 연다. testID: `explore-landing`, 헤딩 testID: `explore-landing-heading` 에 「무엇을 둘러볼까요?」·「숙소·장소를 둘러보고 담아요」, 검색창 testID: `explore-landing-search` 에 「도시 검색」.
- **로딩.** 콜드 진입 직후 스켈레톤 접두 testID: `explore-landing-skeleton-stay`(뒤에 `-0`·`-1`, 2개)·testID: `explore-landing-skeleton-place`(`-0`~`-2`, 3개)가 보이고 testID: `explore-fab-stack` 이 없다.
- **숙소 레인.** testID: `explore-lane-stay` 제목 「숙소」, 카드 testID: `explore-stay-card-${card.key}` press → `/stays/{stayId}` 숙소 상세(stay-search.md). 하트 testID: `explore-stay-save-${card.key}` press → `selected` true·글리프 testID: `explore-stay-heart-filled-${card.key}`. 「모두 보기 ›」 testID: `explore-lane-stay-seeall` → `/stays?region={첫 카드 지역}`.
- **숙소 레인 실패.** 숙소 조회 실패 시 「숙소를 불러오지 못했어요」와 testID: `explore-lane-stay-retry` 「다시 시도」. 담기 실패 시 testID: `explore-stay-save-error`.
- **장소 레인.** testID: `explore-lane-place` 제목 「장소」, 카드 testID: `explore-place-card-${poiId}` press → `/explore/places/{poiId}`. 하트 testID: `explore-place-save-${poiId}` → `selected` true(글리프 testID: `explore-place-heart-filled-${poiId}` 는 실화면 접근성 트리에 노출되지 않는다 — `selected` 로 판정). 「모두 보기 ›」 testID: `explore-lane-place-cta` → `/explore/places`.
- **장소 레인 실패·빈.** 실패면 testID: `explore-lane-place-retry`(「장소를 불러오지 못했어요 · 다시 시도」), 0장이면 testID: `explore-lane-place-empty`(「가볼 만한 장소 둘러보기」 → 장소 탐색). 담기 실패면 testID: `explore-place-save-error`.
- **담은 곳 메뉴.** testID: `explore-saved-menu-toggle`(라벨 `담은 장소 {N}곳`)를 누른다. 라벨 「담은 곳 메뉴 닫기」, 딤 testID: `explore-saved-menu-backdrop`, 미니 testID: `explore-saved-places-fab`(라벨 `담은 장소 {N}곳` → `/explore/saved-places`)·`explore-saved-stays-fab`(「저장한 숙소」 → `/stays/saved`).
- **여행 만들기.** testID: `explore-create-trip-fab`(「여행 만들기」) → `/trips/new/step1`.
- **지역 선택 진입.** `explore-landing-search` 를 누른다. testID: `explore-region-back` 옆 앱바 「여행지 선택」, 헤딩 「어디로 떠날까요?」·「가고 싶은 도시를 먼저 골라요」, 입력 testID: `explore-region-search`(placeholder 「도시·지역 검색」), 「인기 여행지」 스트립 testID: `explore-region-popular-strip`.
- **로딩·오류.** 카탈로그 대기 중 testID: `explore-region-loading`, 실패면 testID: `explore-region-error`(「지역을 불러오지 못했어요」·「잠시 후 다시 시도해 주세요」)와 testID: `explore-region-error-retry` 「다시 시도」.
- **시도 드릴다운.** 「지역별 둘러보기」의 시도 행 testID: `explore-region-sido-${group.sidoCode}`(예: 부산 `26`)나 인기 카드 testID: `explore-region-popular-${group.sidoCode}`(라벨 `{시도}, {태그라인}` 예 「부산광역시, 바다 · 야경」 — 시도명은 서버 값)을 누른다. 「{시도} 전체」 제목과 구군 카드 testID: `explore-region-${region.regionCode}`, 1단 복귀 testID: `explore-region-drilldown-back`(「지역 목록」).
- **앱바 뒤로 두 단계.** 드릴다운이 열린 채 `explore-region-back`(라벨 「뒤로」)을 누르면 시도 목록으로만 돌아가고, 한 번 더 누르면 지역 선택을 나간다.
- **검색.** `explore-region-search` 에 「해운대」를 `fill` 한다. 제목이 「검색 결과」로 바뀌고 평면 카드(구군은 시도명 부제)가 뜬다. 「경복궁」 같은 장소명은 「검색 결과가 없어요」 — 지역 이름만 걸린다.
- **선택 → 필터.** 「부산 전체」 카드(부산 SIDO 행, `explore-region-${region.regionCode}`)를 누른다. 지역 선택이 걷히고 탐색 탭에 칩 testID: `explore-region-chip`(지역 이름), 레인 제목 「{이름} 숙소」(또는 「인기 숙소」)·「{이름} 장소」가 뜬다. 「모두 보기」는 `/stays` 에 `region`·`regionCode`·`sido` 를, 장소 「모두 보기」는 `/explore/places?region={이름}` 을 싣는다.
- **인기 숙소.** 필터 중 인기 숙소가 오면 숙소 레인 제목이 「인기 숙소」, 몸통이 testID: `curated-stays` 블록으로 바뀐다(전체 보기 버튼 없음). 카드·제휴 시트는 stay-search.md 소관.
- **필터 해제.** testID: `explore-region-chip-clear`(라벨 「지역 필터 해제」)를 누른다. 칩이 사라지고 레인 제목이 「숙소」·「장소」로 돌아온다(검색창 본체를 누르면 대신 지역 선택이 열린다).
- **선택 불가 지역.** 장소 0곳 지역 카드는 흐리고 「추천 장소 없음」, 묶음 지역은 회색 행 — 눌러도 화면이 그대로다.
- **미해결 코드.** `trippilot:///explore?region=99999`(카탈로그에 없는 코드). 칩 라벨이 「99999」, 숙소 레인 「숙소를 불러오지 못했어요」, 장소 레인 `explore-lane-place-retry`. 재시도는 카탈로그만 다시 부른다.
- **옛 여행지 상세.** `trippilot:///explore/destination/26`. 탐색 탭에 부산 칩이 붙은 화면으로 바로 바뀐다.

## Gotchas

- 지역 선택은 서비스 지역(서울 11·부산 26·제주 50, 테스트 빌드는 `EXPO_PUBLIC_TEST_REGIONS` 지역 추가) 밖 시도를 목록에서 뺀다 — 다른 시도가 안 보이는 건 정상.
- 지역 선택 카드·시도 행은 `accessibilityRole` 이 없다(인기 카드만 `button`). 접근성 트리에서 버튼으로 안 보일 수 있으니 testID 로 잡는다.
- 목적은 URL `purpose` 로만 정해지고 모르는 값은 조용히 `stay` 로 떨어진다. 딥링크로 증명할 땐 철자(`stay`·`trip`·`explore`·`places`)를 정확히 쓴다.
- 지역 선택 → 탐색 탭 복귀는 `dismissTo` 라 탭 화면을 재마운트하지 않고 params 만 바꾼다. 지역이 바뀌면 본문이 `key` 로 다시 만들어져 담기 실패 배너·대기 표식·메뉴 열림이 사라지는 게 정상이다.
- **[실화면 전용]** 홈 검색바에서 지역을 고르면 홈 탭에서 탐색 탭으로 예고 없이 바뀐다(QA 실측). 스택에 (tabs) 가 없을 때(지역 선택 딥링크 직진입) 어디에 닿는지 확인 필요.
- 필터 없는 숙소 레인은 서버가 전국 1회 응답을 주고 클라가 주소로 3지역만 남긴다 — 주소 없는 숙소는 빠진다. 숙소가 0장이고 오류도 아니면 레인이 제목만 남고 비어 보인다(빈 안내 없음).
- 필터 숙소 레인은 서버가 이름으로 동명 구(서울·부산 「강서구」)를 합쳐 주므로 카탈로그 시도로 한 번 더 거른다 — 주소 없는 숙소는 남긴다.
- 랜딩 로딩 스켈레톤은 숙소·장소 **둘 중 하나라도** 대기면 두 레인 모두 스켈레톤이다.
- **[실화면 전용]** 시도→구군 드릴다운 레이아웃·「전체」 카드 구분·「인천광역시 전체」식 문구 중복, 딤 전면 커버, 세로 스크롤 중 FAB 숨김(멈춘 뒤 250ms 복귀) 은 실화면으로만 확인된다.
- 탐색 탭 저장 하트는 `(tabs)` 가드 덕에 로그인 전제다 — 게스트 분기 없음.
- 검색창 문구는 「도시 검색」이지만 장소·숙소 검색은 안 된다(지역 선택만) — 과거 QA 의 「도시 · 장소 · 숙소 검색」 지적은 문구가 바뀐 뒤다.
- **[실화면] 2026-10-31 딥링크는 `com.trippilot.travel://…` 스킴으로만 화면이 바뀐다** — `simctl openurl "trippilot:///…"` 는 앱만 앞으로 오고 라우팅되지 않았다(이 dev build Info.plist 에 `trippilot` 스킴이 네이버 로그인 urlScheme 으로 한 번 더 등록돼 있다, [결함 의심 FM-L1-04]).
- [실화면] 2026-10-31 도달 불가 — `explore-loading`(순간 상태)·`explore-stay-error`·`explore-stay-save-error`·`explore-place-error`(미해결 코드 경로의 숙소 레인 실패만 확인)·`explore-place-empty`·`explore-place-save-error`·`region-picker-loading`·`region-picker-error`(네트워크 차단 수단 없음), `region-picker-disabled`(서비스 3지역에 장소 0곳 구군을 못 찾음).
- [실화면] 2026-10-31 지역 필터 중 숙소 레인은 「인기 숙소」 + 인기 숙소 줄이어도 레인 머리 「모두 보기 ›」(`explore-lane-stay-seeall`)는 그대로 있다. 없는 것은 인기 숙소 위젯의 「Trip.com에서 전체 숙소 보기」다.
- [결함 의심 FM-L1-03] 이 화면에서 인기 숙소 카드로 연 제휴 시트의 버튼이 탭바 아래 깔린다(tab-bar.md).
- [결함 의심 FM-L1-05] ♥ 메뉴 딤이 탭바를 덮지 않는다(home.md).
