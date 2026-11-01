---
id: stay-search
band: e
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/stays/index.tsx
---

# 숙소 검색 결과 (e02)

사용자는 한 지역의 숙소 목록을 보고, 이름·지역으로 좁히고, 가격대·편의시설·숙소 유형으로 거르고, 하트로 저장하고, 카드를 눌러 상세로 간다. 결과가 0곳이면 원인에 따라 다른 안내(빈 결과·필터 0건·이름 검색 0건)와 탈출구(지역 바꾸기·필터 완화·필터 해제·검색어 지우기·숙소 직접 등록)가 뜬다. 목록 머리에는 인기 숙소 줄과 「Trip.com에서 전체 숙소 보기」가 얹히는데, 그 위젯은 `curated-stays` 기능 파일이 다룬다. 이 화면은 `(tabs)` 밖 스택 화면이지만 하단 탭바 복제본(탐색 켜짐)과 우하단 2단 FAB(저장한 숙소·숙소 등록)를 스스로 그린다.

## Sub-features

- `stay-search-list` 지역의 숙소 카드 목록과 머리글 `{지역} · N곳`을 그린다.
- `stay-search-loading` 응답 전 「숙소를 모으는 중」과 스켈레톤 카드 4장을 보인다.
- `stay-search-error` 조회 실패 시 「지금 숙소 정보를 불러올 수 없어요」와 [다시 시도]·[숙소 직접 등록]을 보인다.
- `stay-search-partial` 서버가 `degraded`를 주면 카드는 그대로 두고 「일부 숙소 정보를 불러오지 못했어요」 배너와 [다시 시도]를 얹는다.
- `stay-search-empty` 0곳이고 서버 원인 코드가 없으면 점선 안내 「조건에 맞는 숙소가 없어요」 + [지역 바꾸기]·[필터 완화] + 「이미 예약한 숙소가 있나요?」 등록 유도 카드를 보인다.
- `stay-search-filter-zero` 0곳이고 서버가 `filterZeroReasons`를 주면 「‘{원인}’ 필터가 0건을 만들었어요」 + [‘{원인}’ 필터 해제]·[필터 초기화]를 보인다.
- `stay-search-name` 검색창 「지역·숙소 이름 검색」에 친 글자로 받은 목록을 클라이언트에서 이름·지역 부분일치로 좁힌다.
- `stay-search-name-empty` 이름 검색이 0곳을 만들면 「검색 결과가 없어요」 + [검색어 지우기](+필터가 걸려 있으면 [필터 초기화])를 보인다.
- `stay-search-region` [지역] 칩 또는 빈 상태 [지역 바꾸기]로 여행지 선택(숙소 목적)에 갔다가 고른 지역으로 목록을 다시 받는다. 지역이 바뀌면 가격대·검색어가 초기화된다.
- `stay-search-price` [가격대] 칩 → 가격대 시트(전체·10만원 미만·10만~20만원 미만·20만원 이상)에서 고르면 즉시 적용·닫힘, 칩 라벨이 고른 구간 이름으로 바뀐다. 가격 있는 숙소가 하나도 없으면 칩 자체가 숨는다.
- `stay-search-filter` [필터] 칩 → 필터 시트(편의시설·숙소 유형 토글, [닫기]·[적용])로 서버 재조회. 적용 개수가 [필터] 칩 배지로 뜬다. 지금 결과에 걸 수 있는 값이 없으면 「이 결과에는 걸 수 있는 필터가 없어요」.
- `stay-search-save` 카드 하트로 저장/해제한다. 응답 전엔 하트가 잠긴다. 미인증이면 요청 없이 로그인 화면으로 간다.
- `stay-search-open-detail` 카드를 누르면 testID: `stay-detail`로 간다.
- `stay-search-fab` 흰 하트 FAB → 저장한 숙소(e04), 분홍 ＋ FAB → 숙소 등록(e05).
- `stay-search-tabbar` 하단 탭바 복제본의 탭을 누르면 스택 밑 `(tabs)`의 해당 탭으로 돌아간다.
- `stay-toast-above-fab` FAB 가 있는 화면에서 토스트는 FAB 묶음 위에 떠서 가려지지 않는다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `stay-price-chip` 가격대를 고르면 칩이 연핑크·선택됨으로 바뀌고, 가격대 시트는 아래로 끌어 닫을 수 있다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 도달 불가 — Gotchas)*

## How to get to it (user POV)

- 탐색 탭 숙소 레인 머리의 「모두 보기 ›」(testID: `explore-lane-stay-seeall`). 지역 필터 중이면 `region`·`regionCode`·`sido`를 싣고, 아니면 첫 카드 지역 이름만(`/stays?region=…`) 싣는다.
- 여행지 선택(숙소 목적, `/explore/region?purpose=stay`)에서 지역을 고르면 그 지역으로 거른 이 화면에 돌아온다.
- 저장한 숙소(e04) 빈 상태 [숙소 둘러보기](testID: `saved-stay-browse`) → `/stays`.
- 마이 → 등록 숙소 빈 상태 [숙소 탐색](testID: `my-stays-explore`) → `/stays`.
- 여행 만들기 2/4 거점 숙소의 [숙소 둘러보기](testID: `trip-base-browse`) → `/stays` 또는 `/stays?region=…`.
- 일정의 동선 기준 숙소 추천(h15) 빈 상태 [다른 숙소 둘러보기](testID: `stay-recommend-empty-browse`) → `/stays`.
- AI 도우미 다음 행동 `OPEN_STAY_SEARCH` → `/stays`(replace).
- 딥링크 `trippilot://stays`, `trippilot://stays?region=제주`.
- 푸시 알림 탭으로 오는 경로는 없다.

## Driving it with agent-device

Preconditions:

- 소셜 로그인 완료 상태(저장 하트를 실제로 검증하려면 액세스 토큰이 있어야 한다).
- dev-api `GET /stays/search?region=…`가 숙소를 돌려주는 지역을 하나 안다(과거 QA는 부산·서울에서 결과를 봤다). 가격대 칩은 응답에 `price`가 있는 숙소가 하나라도 있어야 보인다(2026-10-20 QA에선 가격 데이터가 없어 칩이 숨었다).
- 필터 0건(testID: `stay-search-filterzero`)과 부분 실패 배너(testID: `stay-search-partialfailure`)는 서버 응답(`filterZeroReasons`·`degraded`)이 있어야만 뜬다. 지금 dev-api가 그 값을 주는 조건은 확인 필요.

- **기본 진입.** 탐색 탭에서 testID: `explore-lane-stay-seeall`을 누른다. testID: `stay-search-root`가 뜨고 제목 「숙소 검색 결과」, 머리글 testID: `stay-search-header`가 `{지역} · N곳`이다.
- **지역 없는 진입.** 딥링크 `trippilot://stays`로 연다. 머리글이 `부산 · N곳`이다 — `region`이 없으면 부산으로 묻는다.
- **로딩.** 진입 직후 testID: `stay-search-loading`(「숙소를 모으는 중」)과 testID: `stay-search-skeleton-0`~testID: `stay-search-skeleton-3`이 잠깐 보인다. 응답 뒤 사라진다.
- **카드.** 카드는 testID: `stay-card-{externalSource}:{externalId}`이고 사진은 testID: `stay-card-photo-{key}`, 하트는 testID: `stay-card-save-{key}`(빈 하트 testID: `stay-card-save-{key}-outline`, 찬 하트 testID: `stay-card-save-{key}-filled`)다. 카드엔 가격 줄이 없다.
- **이름 검색.** testID: `stay-search-name-input`(placeholder 「지역·숙소 이름 검색」)에 목록에 있는 숙소 이름 일부를 `fill`한다. 카드가 그 이름을 가진 것만 남고 머리글 N이 줄어든다. 서버 요청은 새로 나가지 않는다.
- **이름 검색 0건.** 없는 글자(예: `zzzz`)를 친다. testID: `stay-search-name-empty` 「검색 결과가 없어요」가 뜬다. testID: `stay-search-name-empty-clear` [검색어 지우기]를 누르면 입력이 비고 목록이 돌아온다. 필터가 걸린 채면 testID: `stay-search-name-empty-reset` [필터 초기화]도 보인다.
- **가격대.** testID: `stay-search-filter-price`(「가격대」)를 누른다. testID: `stay-price-sheet`(제목 「가격대」)에 testID: `stay-price-option-all`·testID: `stay-price-option-under-100k`·testID: `stay-price-option-100k-200k`·testID: `stay-price-option-over-200k`가 라디오로 뜬다. `under-100k`를 누르면 시트가 닫히고 칩 라벨이 「10만원 미만」·selected가 되며 가격 없는 숙소는 목록에서 빠진다.
- **가격대 칩 숨김.** 가격 있는 숙소가 0곳인 지역이면 칩 줄에 「지역」·「필터」만 있다.
- **필터 시트.** testID: `stay-search-filter-more`(「필터」)를 누른다. testID: `stay-filter-sheet`(제목 「필터」)에 「편의시설」 칩 `stay-filter-amenity-{값}`과 「숙소 유형」 칩 `stay-filter-staytype-{값}`이 뜬다. 칩 라벨은 서버 값 원문이다(지금은 한글). 하나를 눌러 selected로 바꾸고 testID: `stay-filter-apply` [적용]을 누르면 시트가 닫히고 목록이 다시 로딩된 뒤 [필터] 칩에 배지 `1`이 붙는다. testID: `stay-filter-close` [닫기]는 적용 없이 닫는다.
- **지역 바꾸기.** testID: `stay-search-filter-region`(「지역」)을 누른다. 여행지 선택 화면이 열리고, 다른 지역을 고르면 이 화면으로 돌아와 머리글 지역이 바뀐다. 걸어 둔 가격대·검색어는 비워진다.
- **빈 결과.** 결과가 0곳이 되는 조합(가격대 구간 등)을 만든다. testID: `stay-search-empty` 「조건에 맞는 숙소가 없어요」 / 「지역이나 필터를 바꿔 다시 찾아보세요」, testID: `stay-search-empty-region` [지역 바꾸기], testID: `stay-search-empty-filter` [필터 완화], testID: `stay-search-register` 「이미 예약한 숙소가 있나요?」가 보인다. 필터도 가격대도 없으면 [필터 완화]는 disabled다. [필터 완화]를 누르면 편의시설·유형·가격대가 모두 풀린다.
- **필터 0건.** 서버가 원인 코드를 주는 필터를 건다. testID: `stay-search-filterzero` 「‘{원인}’ 필터가 0건을 만들었어요」, testID: `stay-search-filterzero-clear` [‘{원인}’ 필터 해제](그 값만 뺀다), testID: `stay-search-filterzero-reset` [필터 초기화](전부 푼다). 원인 라벨은 코드의 콜론 뒤 값, 없으면 「숙소 유형」·「편의시설」.
- **조회 실패.** 네트워크를 끊고 진입한다. testID: `stay-search-error` 「지금 숙소 정보를 불러올 수 없어요」, testID: `stay-search-error-retry` [다시 시도](같은 쿼리 재조회), testID: `stay-search-error-register` [숙소 직접 등록](→ 숙소 등록)이 뜬다. 머리글에 `· N곳`이 없다.
- **부분 실패.** 서버가 `degraded: true`를 주면 카드 위에 testID: `stay-search-partialfailure` 「일부 숙소 정보를 불러오지 못했어요」와 testID: `stay-search-partialfailure-retry` [다시 시도]가 뜬다.
- **저장 하트.** 아무 카드의 testID: `stay-card-save-{key}`를 누른다. 찬 하트 testID: `stay-card-save-{key}-filled`로 바뀐다. 결과를 저장한 숙소(e04, testID: `stay-search-fab-saved`)에서 그 이름의 카드로 다시 확인한다. 다시 누르면 `-outline`으로 돌아온다.
- **카드 → 상세.** 카드 testID: `stay-card-{key}`를 누른다. testID: `stay-detail-root`가 열리고 같은 숙소 이름이 제목이다.
- **FAB.** testID: `stay-search-fab-saved`(라벨 「저장한 숙소」) → testID: `saved-stay-root`. testID: `stay-search-fab-register`(라벨 「숙소 등록」) → testID: `stay-register-root`.
- **뒤로·탭바.** testID: `stay-search-back`은 들어온 화면으로 돌아간다. 하단 탭바 복제본의 홈 탭(testID: `shell-tabbar-tab-home`)을 누르면 스택이 걷히고 홈 탭이 뜬다.

## Gotchas

- 숙소 카드 testID 키는 `{externalSource}:{externalId}`라 콜론이 들어간다(`stay-card-LOCALDATA:…`). `id=` 셀렉터에 그대로 넣는다.
- `region` 없이 열면 부산으로 묻는다. 홈·여행 위저드 등 `/stays`만 여는 진입은 늘 부산부터 보인다.
- 이름 검색은 받은 목록 안에서만 거른다 — 다른 지역 숙소 이름을 쳐도 나오지 않는다. 결과가 0곳이면 서버 필터 0건 얼굴이 아니라 testID: `stay-search-name-empty`가 뜬다.
- 목록은 1페이지뿐이다(페이지네이션 파라미터 없음). 끝까지 스크롤해도 더 불러오지 않는 것이 정상이다.
- 가격대는 클라이언트 필터다. 가격 결측 숙소는 「전체」 외 구간에서 모두 빠진다. 가격 데이터가 없는 지역에선 칩이 숨으므로 이 하위 기능은 가격 있는 지역에서만 검증된다.
- 필터 시트 칩 라벨은 서버 값 원문이다 — 2026-10-31 dev-api 는 「리조트」·「생활숙박」·「호텔」·「기타」 같은 한글 값을 줘서 testID 도 `stay-filter-staytype-리조트` 처럼 한글이 붙는다. 편의시설 값이 없는 결과면 「편의시설」 묶음 자체가 안 보인다.
- 동명 구(서울·부산 강서구)는 여행지 선택에서 들어올 때만 `sido`로 다른 시도 숙소를 거른다. `?region=강서구`만 딥링크하면 두 시도 숙소가 섞인다.
- 하트를 서로 다른 두 카드에 거의 동시에 누르면, 한쪽이 실패할 때 다른 쪽의 낙관 표시까지 롤백된다(traps-stay 「동시 토글」). 하트 검증은 한 카드씩, 응답을 기다린 뒤 다음 카드로 간다.
- 미인증 하트 → 로그인 이동은 액세스 토큰이 없어야 재현된다. 정상 로그인 흐름에선 이 화면에 미인증으로 들어올 경로가 확인되지 않는다(확인 필요).
- 키보드가 떠 있을 때 칩을 누르면 화면이 먼저 키보드를 내린다. 첫 탭이 키보드 닫기에만 쓰이는지는 sim-qa §2 함정을 따른다.
- [실화면 전용] 가격대·필터 시트의 실제 열림·딤·드래그 닫기는 실화면으로만 확인된다(gorhom 통과형 목). 카드 하트의 채움 색도 실화면으로만 확인된다 — 찬/빈 하트는 testID 접미사(`-filled`/`-outline`)로 판정하고 색은 스크린샷으로 본다.
- [실화면 전용] 빈 상태·에러 안내가 화면 가운데 오는지, 0건 카드 버튼이 키보드에 덮이지 않는지는 실화면에서만 보인다.
- 이 화면의 하트(`shared/ui/HeartGlyphs`)와 상세·저장 목록의 하트(`StayGlyphs`)는 모양이 다르다 — 결함으로 오인하지 마라(traps-stay).
- 인기 숙소 줄(`stay-search-curated*`)과 「Trip.com에서 전체 숙소 보기」는 `curated-stays.md`에서 검증한다. 그 줄 때문에 목록 첫 카드가 첫 화면 아래로 밀릴 수 있다.
- **[실화면] 2026-10-31 딥링크는 `com.trippilot.travel://…` 스킴으로만 화면이 바뀐다** — `simctl openurl "trippilot:///…"` 는 앱만 앞으로 오고 라우팅되지 않았다(이 dev build Info.plist 에 `trippilot` 스킴이 네이버 로그인 urlScheme 으로 한 번 더 등록돼 있다, [결함 의심 FM-L1-04]). `stays`·`stays?region=부산` 도 같은 스킴으로 열었다.
- [실화면] 2026-10-31 도달 불가 — `stay-search-loading`(순간 상태)·`stay-search-error`·`stay-search-partial`(네트워크 차단·`degraded` 응답 없음)·`stay-search-filter-zero`(`filterZeroReasons` 응답 조건 미확보)·`stay-search-price`(dev-api 숙소에 가격이 없어 칩이 숨음 — 숨김은 확인)·`stay-search-empty`(가격대 없이 0곳 조합을 못 만듦, 이름 검색 0건은 별 얼굴).
- [실화면] 2026-10-31 숙소 이름 검색 중 0건 안내의 [검색어 지우기]를 키보드가 뜬 채 누르면 탭이 예측 단어 막대에 들어가 입력이 바뀐다(`zzzz`→`zzzzero`) — return 으로 키보드를 내리고 누른다. [필터 초기화]는 필터만 풀고 검색어는 남긴다.
- [실화면] 2026-11-02 동작구·중구·해운대구·제주시·강남구·종로구 모두 가격 있는 숙소가 0곳이라 [가격대] 칩이 숨는다 — `stay-price-chip` 도달 불가(실패 주입은 응답 본문을 못 바꾼다). FAB 위 토스트는 화면에 토스트를 띄울 조작이 없어 `nav.mjs --eval` 로 `shared/ui/Toast` `showToast` 를 불러 봤다(sim-qa §2).
- [실화면] 2026-11-02 실패 주입(sim-qa §2 `_dev/fault`)으로 열림 — `stay-search-loading`·`stay-search-error`(`/stays/search` 지연·500).
