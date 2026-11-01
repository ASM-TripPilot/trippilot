---
id: saved-places
band: d
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/explore/saved-places.tsx
---

# 담은 장소 · 이 장소들로 여행 만들기

담은 장소(d02)는 사용자가 ♥로 담은 장소를 담은 순서대로 번호를 붙여 보여 준다(앱바 「담은 장소」 + `{N}곳 · 담은 순서대로`). 행의 하트를 누르면 행이 사라지지 않고 흐려진 채 빈 하트와 「해제됨」이 남고, 다시 누르면 같은 자리에서 되담긴다(서버도 실제로 해제·재담김). 하단 「이 장소들로 여행 만들기」는 지금 담긴(해제 안 한) 장소를 꼭 갈 곳으로 심은 새 여행 위저드 1/4를 연다. 같은 라우트가 `mode=select` 로 열리면 담기/해제 대신 「꼭 갈 곳 고르기」 체크 화면이 되어, 위저드 드래프트나 이미 만든 여행에 꼭 갈 곳을 더한다.

## Sub-features

- `saved-list` 담은 순서(오름차순) 번호 행 — 번호·사진·상태 배지(「폐업」/「미확인」)·이름·지역·첫 태그·하트.
- `saved-release` 하트 press → 낙관적으로 빈 하트 + 「해제됨」, 서버 DELETE, 실패면 찬 하트로 원복 + 배너.
- `saved-restore` 해제된 행 하트 press → 찬 하트로, 서버 재담김, 실패면 빈 하트로 원복 + 배너.
- `saved-row-open` 행 press → 장소 상세.
- `saved-create-trip` 「이 장소들로 여행 만들기」 → 드래프트 초기화 후 담긴 장소를 꼭 갈 곳으로 시드, `/trips/new/step1`(담긴 곳 0이면 버튼 없음).
- `saved-loading` 앱바 「담은 곳 불러오는 중」 + 스켈레톤 + 회색 비활성 CTA.
- `saved-error` 「담은 장소를 불러올 수 없어요」 + 「다시 시도」(남은 목록이 있으면 행·CTA 유지).
- `saved-empty` 0곳 → 「마음에 드는 곳을 담아 보세요」 + 「장소 둘러보기」.
- `saved-region-empty` `region` 파라미터로 걸렀더니 0건 → 「이 여행 지역에 담은 곳이 없어요」 + 「장소 둘러보기」.
- `saved-guest` 토큰 없음 → 「로그인하면 담은 장소를 볼 수 있어요」 + 「로그인하기」.
- `saved-remove-error` 해제/재담김 실패 배너 + 「다시 시도」/「로그인하기」.
- `pick-wizard` `mode=select`(tripId 없음) — 위저드 목적지 기준 안/밖 구분, 체크 후 「완료」 → 드래프트 시드, `/trips/new/step1`.
- `pick-outside-confirm` 선택에 지역 밖이 섞이면 확인창 `이 여행 지역 밖 {N}곳이 함께 들어가요` — 「빼고 완료」/「그대로 넣기」.
- `pick-trip` `mode=select&tripId=` — 이미 등록된 곳은 체크 잠금, 「완료」 → 새로 고른 곳마다 꼭 갈 곳 POST 후 뒤로, 일부 실패면 배너.
- `pick-states` 지역 안 0건 `{지역}에 담은 곳이 없어요`, 진짜 0곳 「아직 담은 곳이 없어요」, 로딩, 오류 「담은 곳을 불러오지 못했어요」.

## How to get to it (user POV)

- 홈 ♥ FAB → 미니 「담은 장소」 `home-saved-places-fab` — home.md.
- 탐색 랜딩 ♥ FAB → 미니 `explore-saved-places-fab` — explore-destination.md.
- 장소 탐색 ♥ FAB `explore-places-saved-fab`(위저드 출처가 아닐 때) — explore-places.md.
- 위저드 1/4 꼭 갈 곳 「더 담기」·「전체 보기」 → `?mode=select&region={목적지들}&from=wizard`.
- 꼭 갈 곳 목록(h02) 「꼭 갈 곳 추가」 → `?mode=select&tripId={id}`.
- 딥링크 `com.trippilot.travel://explore/saved-places`(가드 밖 — 미인증이면 게스트 얼굴), `…/explore/saved-places?region=부산`(지역 필터 save 모드). `trippilot:///` 스킴은 실화면에서 라우팅되지 않는다(Gotchas).

## Driving it with agent-device

Preconditions:

- 로그인 계정에 담은 장소 2곳 이상(목록·해제·되담기·CTA 증명). 빈 상태는 담은 곳 0 계정, 게스트 얼굴은 로그아웃 상태 딥링크.
- 지역 빈 상태는 담은 곳이 있으나 그 지역엔 없을 때(`?region=` 에 담은 곳 없는 지역 이름).
- select 여행 모드는 꼭 갈 곳을 더할 수 있는 기존 여행 id 가 필요하다.

- **진입·목록.** 홈 ♥ → 「담은 장소」. testID: `explore-saved-root`, 앱바 「담은 장소」와 testID: `explore-saved-subtitle`(`{N}곳 · 담은 순서대로`), 목록 testID: `explore-saved-list`, 행 testID: `explore-saved-item-${saved.savedPlaceId}`(라벨 `{번호}, {배지}, {이름}, {지역}, {태그}` — 배지 없으면 빠지고, 해제된 행은 끝에 `, 해제됨`이 붙는다), 번호 testID: `explore-saved-rank-${saved.savedPlaceId}`, 배지 testID: `explore-saved-badge-${saved.savedPlaceId}`.
- **행 열기.** 행을 누른다. 장소 상세 `/explore/places/{poiId}` 가 열린다 — explore-places.md.
- **해제.** 하트 testID: `explore-saved-remove-${saved.savedPlaceId}`(라벨 `{이름} 저장`, `selected` true)를 누른다. 행은 남고 `selected` false, 글리프 testID: `explore-saved-heart-outline-${saved.savedPlaceId}`, 아래 testID: `explore-saved-released-${saved.savedPlaceId}` 「해제됨」, 부제 개수가 1 줄어든다. 결과를 홈·탐색의 해당 장소 하트(빈 하트)에서 한 번 더 읽는다.
- **되담기.** 같은 하트를 다시 누른다. 같은 자리에서 찬 하트 testID: `explore-saved-heart-filled-${saved.savedPlaceId}` 로 돌아오고 「해제됨」이 사라진다.
- **해제 실패.** 네트워크를 끊고 하트를 누른다. 찬 하트로 원복되고 testID: `explore-saved-removeerror` 에 「연결이 불안정해 해제하지 못했어요」 + testID: `explore-saved-removeerror-retry` 「다시 시도」(같은 조작 재시도). 되담기 실패면 「연결이 불안정해 담지 못했어요」. 로그인 풀림이면 testID: `explore-saved-removeerror-login`.
- **여행 만들기.** testID: `explore-saved-createtrip`(「이 장소들로 여행 만들기」)를 누른다. 위저드 1/4 가 열리고 꼭 갈 곳에 해제하지 않은 담은 곳만 들어 있다. 여행지는 비어 있다(추정하지 않음) — 위저드 화면 내용은 위저드 기능 파일 소관(확인 필요). 위저드를 끝까지 진행하지 않고 이탈까지만 한다.
- **로딩.** 진입 직후 testID: `explore-saved-loading`, 스켈레톤 testID: `explore-saved-skeleton-${index}`, 부제 「담은 곳 불러오는 중」, CTA 회색 비활성.
- **오류.** 네트워크를 끊고 진입. testID: `explore-saved-error`(「담은 장소를 불러올 수 없어요」·「잠시 후 다시 시도해 주세요」) + testID: `explore-saved-error-retry` 「다시 시도」.
- **빈 상태.** 0곳 계정. testID: `explore-saved-empty`(「마음에 드는 곳을 담아 보세요」), testID: `explore-saved-browse` 「장소 둘러보기」 → `/explore/places`. CTA 없음.
- **지역 빈 상태.** `com.trippilot.travel://explore/saved-places?region=서울`(그 지역에 담은 곳 없음 — URL 인코딩해서 연다). testID: `explore-saved-region-empty`(「이 여행 지역에 담은 곳이 없어요」) + testID: `explore-saved-region-empty-browse` 「장소 둘러보기」 → `/explore/places`(지역 없이).
- **게스트.** 로그아웃 후 `trippilot:///explore/saved-places`. testID: `explore-saved-guest`(「로그인하면 담은 장소를 볼 수 있어요」) + testID: `explore-saved-guest-login` 「로그인하기」 → 로그인 화면.
- **뒤로.** testID: `explore-saved-back`(「뒤로」) → 직전 화면.
- **꼭 갈 곳 고르기(위저드).** 위저드 1/4 에서 「더 담기」로 들어온다. testID: `mustvisit-pick-root`, 앱바 「꼭 갈 곳 고르기」, 행 testID: `mustvisit-pick-row-${place.poiId}`, 체크 testID: `mustvisit-pick-check-${place.poiId}`(찬 체크 `mustvisit-pick-check-filled-${place.poiId}`). 지역 밖 머리글 testID: `mustvisit-pick-region-outside`(`이 여행 지역 밖 {N}곳`). testID: `mustvisit-pick-complete` 「완료」 → `/trips/new/step1`.
- **지역 밖 확인.** 지역 밖 행을 체크하고 「완료」. testID: `mustvisit-pick-outside-confirm` 에 `이 여행 지역 밖 {N}곳이 함께 들어가요`, testID: `mustvisit-pick-outside-exclude` 「빼고 완료」 / testID: `mustvisit-pick-outside-keep` 「그대로 넣기」.
- **더 담기.** testID: `mustvisit-pick-addmore`(「+ 탐색에서 더 담기」) → `/explore/places?region={여행 지역}&from=wizard`(＋ 없음, ♥ 는 뒤로). 지역 안 0건이면 testID: `mustvisit-pick-region-empty` + testID: `mustvisit-pick-region-empty-browse`(`탐색에서 {지역} 장소 담기`).
- **꼭 갈 곳 고르기 상태.** 0곳 testID: `mustvisit-pick-empty`(「아직 담은 곳이 없어요」) + testID: `mustvisit-pick-browse` 「장소 둘러보기」, 오류 testID: `mustvisit-pick-error`(「담은 곳을 불러오지 못했어요」) + testID: `mustvisit-pick-error-retry`, 로딩 testID: `mustvisit-pick-skeleton-row-${r}`.
- **꼭 갈 곳 고르기(여행 모드).** 꼭 갈 곳 목록 「꼭 갈 곳 추가」로 들어온다. 이미 등록된 곳은 체크된 채 잠긴다. 새 곳을 체크하고 「완료」 → 서버에 꼭 갈 곳 POST(데이터 변경 — 증명용 여행에서만) 후 뒤로, 꼭 갈 곳 목록에서 추가분을 다시 읽는다. 일부 실패면 testID: `mustvisit-pick-complete-error`.

## Gotchas

- 행·하트 testID 는 `poiId` 가 아니라 `savedPlaceId` 다. 방금 담은 장소는 서버 확정 전 임시 id 이고 맨 끝에 붙는다 — 담은 직후엔 접근성 트리로 id 를 다시 읽는다.
- 정렬은 담은 순서 **오름차순**이다(가장 최근이 맨 아래).
- 해제한 행은 이 화면을 떠나면(재마운트) 사라진다 — 「해제됨」 유지는 한 방문 안에서만이다. 다른 화면에서 해제 결과를 확인한 뒤 돌아오면 행이 없는 게 정상이다.
- 개수 부제·CTA 활성은 해제된 행을 빼고 센다 — 전부 해제하면 행은 남는데 CTA 가 사라진다.
- 「이 장소들로 여행 만들기」는 지금 **보이는**(지역 필터 적용 후) 목록만 시드한다.
- 게스트 판정은 화면 진입 시 토큰 유무로 즉시 한다 — 로딩보다 먼저 게스트 얼굴이 뜬다.
- 「로그인하기」가 로그인 화면을 실제로 여는지 확인 필요.
- `region` 파라미터 지역 판정과 select 모드 안/밖 판정은 다른 규칙이다(save = 이름 필터, select = 위저드·여행 목적지의 regionCode 접두). select 모드는 URL `region` 을 판정에 쓰지 않는다.
- 여행 모드(`tripId`)의 「+ 탐색에서 더 담기」도 `from=wizard` 를 싣는다 — 장소 탐색에서 ＋ 가 숨고 ♥ 가 뒤로가 된다.
- **[실화면 전용]** 확인창(`mustvisit-pick-outside-confirm`)은 조건부 렌더 오버레이라 딤·중앙 정렬·터치 차단은 실화면으로만 확인된다. 버튼 연타 잠금은 ref 라 실기에서 두 번 눌러도 한 번만 진행되는지 본다.
- **[실화면 전용]** 꼭 갈 곳 고르기 → 장소 탐색 ♥가 실제로 고르기 화면으로 돌아가는지는 실화면으로만 확인된다.
- select 모드 「완료」(위저드)는 드래프트를 교체한다 — 위저드에 이미 있던 꼭 갈 곳 중 체크를 푼 것은 사라진다.
- **[실화면] 2026-10-31 딥링크는 `com.trippilot.travel://…` 스킴으로만 화면이 바뀐다** — `simctl openurl "trippilot:///…"` 는 앱만 앞으로 오고 라우팅되지 않았다(이 dev build Info.plist 에 `trippilot` 스킴이 네이버 로그인 urlScheme 으로 한 번 더 등록돼 있다, [결함 의심 FM-L1-04]).
- [실화면] 2026-10-31 도달 불가 — `saved-loading`(순간 상태)·`saved-error`·`saved-remove-error`(네트워크 차단 수단 없음)·`saved-empty`(계정에 담은 곳 5곳, 지우면 뒤 묶음이 깨짐)·`saved-guest`(로그아웃 금지)·`pick-trip`(꼭 갈 곳 목록을 쓸 여행이 진행 중 제주 여행뿐, 수정 금지)·`pick-states`(0곳·오류·로딩 미재현, 지역 안 0건은 미시도).
- [결함 의심 FM-L1-01] 꼭 갈 곳 고르기 「완료」가 위저드를 새로 push 해 스택이 쌓인다 — 「더 담기」→「완료」를 두 번 하면 위저드 1/4 뒤로가 위저드를 나가지 않고 옛 고르기 화면(옛 선택 수)·옛 위저드를 차례로 다시 보여 준다(뒤로 4번 만에 담은 장소).
