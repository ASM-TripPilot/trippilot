---
id: explore-places
band: d
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/explore/places.tsx
  - app/explore/places/[poiId].tsx
---

# 장소 탐색 · 장소 상세 · 장소 저장

장소 탐색(d04)은 「장소 탐색」 앱바, 서버 검색창, 카테고리 칩 11개(「전체」+10), 지역 칩, 2열 장소 그리드(무한 스크롤·진입마다 무작위 순서), 우하단 ♥ 담은 장소·＋ 여행 만들기 FAB, 복제 탭바를 보여 준다. 카드를 누르면 장소 상세(d06)로, 하트를 누르면 담기/해제된다. 장소 상세는 `GET /places/{poiId}` 단건으로 사진·제목·부제(카테고리 · 지역)·상태 배지·태그·영업시간·주소(도로명 주소가 있으면 복사 버튼과 함께)·「네이버 지도에서 보기」·미니맵과 뒤로·공유·저장 버튼을 그리고, 404면 「장소를 찾을 수 없어요」, 그 밖의 실패면 오류 얼굴을 보인다.

## Sub-features

- `places-list` 지역 0곳(서비스 지역 6곳 병렬)·1곳(무한 스크롤)·2곳 이상(병렬 병합) 조회 결과를 2열 카드로.
- `places-search` 검색어 입력 → 300ms 멈춘 뒤 서버 `q` 재조회.
- `places-category` 카테고리 칩(「전체」·「명소」·「맛집」·「카페」·「야경」·「자연」·「쇼핑」·「문화」·「액티비티」·「미술」·「술집」) 선택 → 서버 재조회.
- `places-region-chip` 지역 칩(「전체 지역」 / 한 곳 이름 / `{첫 지역} 외 N곳`) press → 지역 선택(purpose=places) → 고른 지역 하나로 교체.
- `places-same-name` 이름이 같은 지역(경남·강원 고성군, 서울·부산 중구)을 코드로 갈라 그 지역 장소만 보여 준다. 같은 이름 2곳이면 칩은 「중구 외 1곳」. *(TRIP-1809 · 실화면 미검증 — 서버 TRIP-1808 필요)*
- `places-loading` 「장소를 모으는 중」 스켈레톤.
- `places-error` 「지금 장소 정보를 불러올 수 없어요」 + 「다시 시도」(카드가 남아 있어도 헤더에 뜬다).
- `places-partial-failure` 여러 지역 중 일부 실패 → 「일부 지역을 불러오지 못했어요」 + 「다시 시도」.
- `places-filter-zero` 검색어·카테고리 때문에 0건 → `‘{조건}’ 때문에 0건이에요` + 「검색어 지우기」/`‘{카테고리}’ 필터 해제`. 둘 다 걸리면 제목은 검색어 기준, 부제 `‘{카테고리}’ 필터도 함께 걸려 있어요 · …`, 버튼은 「검색어 지우기」+「조건 모두 해제」(실화면 2026-10-31).
- `places-empty` 조건 없이 0건 → 「담긴 장소가 없어요」 + 「다른 지역 보기」.
- `places-load-more` 스크롤 끝 → 다음 장 이어 받기, 하단 로딩 표시.
- `places-memory` 끝까지 내려도 메모리가 크게 늘지 않는다 — 카드는 보이는 화면과 위아래 두 화면만 마운트(약 60장)하고, 손을 떼거나 관성이 멈출 때·화면을 나갈 때 사진 메모리 캐시를 비운다. 위로 돌아가도 디스크에서 읽어 다시 받지 않는다. *(TRIP-1813 · 창 크기는 jest 사각 — 수치는 아래 Gotchas)*
- `places-save` 카드 하트 담기/해제(응답 전 비활성), 실패 배너 + 「다시 시도」/「로그인하기」.
- `places-fab` ♥ → 담은 장소(위저드 출처면 뒤로), ＋ → 위저드 1/4(위저드 출처면 ＋ 숨김).
- `places-tabbar` 복제 탭바 「탐색」 활성, 다른 칸 → 스택 걷고 그 탭으로.
- `place-detail` 단건 상세 렌더(상태 배지 「폐업」/「미확인」, 영업시간·주소 결측은 「미확인」). 주소 행은 도로명 주소 → 없으면 지역명 → 둘 다 없으면 「미확인」.
- `place-detail-address-copy` 도로명 주소가 있을 때만 주소 행 오른쪽 복사 버튼 → 기기 클립보드에 주소를 넣고 토스트 「주소를 복사했어요」, 복사가 안 되면 에러 토스트 「주소를 복사하지 못했어요」(지역명·「미확인」 행에는 버튼 없음). *(TRIP-1799 · 실화면 미검증 — 네이티브 재빌드 필요)*
- `place-detail-save` 저장 버튼 토글(라벨 `{이름} 저장`, 담김은 `selected`), 실패 배너.
- `place-detail-share` 공유 → OS 공유 시트(장소 이름만).
- `place-detail-naver` 「네이버 지도에서 보기」 → 외부 네이버 지도, 실패 시 안내 배너.
- `place-detail-loading` 조회 중 빈 화면 / `place-detail-notfound` 404 / `place-detail-error` 비-404 실패 + 「다시 시도」.
- `place-detail-back` 뒤로 — 히스토리 없으면 홈으로 교체.
- `place-detail-hero` 히어로는 서버 사진(없으면 그 장소 카테고리의 생성 이미지)이고, 부제 앞에 흰 핀이 선다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `place-detail-minimap` 미니맵은 그 장소 위치에 핀 하나를 찍고 손으로 움직이지 않는다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `places-toast-above-fab` FAB 가 있는 화면에서 토스트는 FAB 묶음 위에 떠서 가려지지 않는다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `places-chip-follow` 카테고리 칩을 고르면 칩 줄이 그 칩이 보이도록 가로로 따라간다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*
- `places-fab-scroll-hide` 목록을 세로로 스크롤하는 동안 ♥·＋ 묶음이 투명·터치 불가가 되고, 멈춘 뒤 250ms 에 돌아온다(위저드 출처라 ♥ 만 있어도 같다). *(2026-11-01 B안으로 실화면 전용 · 2026-11-03 실화면 pass — TRIP-1733)*
- `places-grid-deep` 그리드를 깊게 내려도 2열이 유지되고 여백이 그대로다. *(2026-11-03 실화면 pass — 30번 끌기, TRIP-1733 목록 교체 뒤)*
- `place-header-glyph-shape` 장소 상세(d06) 헤더의 뒤로·공유·하트, 담은 장소·지역 선택의 뒤로 아이콘이 통합 전과 같은 모양·크기다. *(TRIP-1829 · 실화면 전용 · 2026-11-08 d06 실화면·`place-detail-default`·`places-default` 전후 0px pass · 지역 선택·담은 장소 뒤로는 프리뷰 토글 바에 가려 판정 제외, 화면 전체 0px)*

## How to get to it (user POV)

- 장소 탐색 `/explore/places`:
  - 홈 「지금 뜨는 장소」 「더 보기」 — home.md.
  - 탐색 랜딩 장소 레인 「모두 보기 ›」·빈 레인 「가볼 만한 장소 둘러보기」(필터 중이면 `?region={이름}&regionCode={코드}`) — explore-destination.md.
  - 지역 선택 purpose=places 에서 지역 선택 → 쌓인 화면을 걷고 그 지역으로 거른 장소 탐색으로 돌아온다.
  - 담은 장소 빈 상태 「장소 둘러보기」, 지역 빈 상태 「장소 둘러보기」 — saved-places.md.
  - 꼭 갈 곳 고르기(d02 select) 「+ 탐색에서 더 담기」·빈 상태 버튼 → `?region={이름들}&regionCode={코드들}&from=wizard`(둘 다 쉼표로 이어 붙는다, 코드 없는 여행지가 있으면 `regionCode` 없음) — saved-places.md.
  - 딥링크 `trippilot:///explore/places`, `trippilot:///explore/places?region=부산`, `trippilot:///explore/places?region=고성군&regionCode=48820`(가드 밖 — 미인증도 열린다).
- 장소 상세 `/explore/places/{poiId}`:
  - 홈 「지금 뜨는 장소」·「요즘 사람들이 담는 곳」 카드.
  - 탐색 랜딩 장소 레인 카드.
  - 장소 탐색 그리드 카드.
  - 담은 장소 행.
  - AI 도우미 next action `OPEN_PLACE`(여행 중 허브에서 연 도우미가 아닐 때) → push.
  - 딥링크 `trippilot:///explore/places/{poiId}`(가드 밖).

## Driving it with agent-device

Preconditions:

- 서버에 서비스 지역 장소가 있어야 목록이 찬다. 담기 증명은 로그인 계정(토큰 있음)이어야 한다 — 장소 탐색·상세는 가드 밖이라 미인증으로도 열리고, 그때 하트는 「로그인하면 마음에 든 장소를 담을 수 있어요」 + 「로그인하기」로 막힌다.
- 상세의 상태 배지·notFound·오류 얼굴은 서버 응답(`dataStatus` CLOSED/LOST/UNVERIFIED, 404, 500)에 달려 있다 — 맞는 poiId 를 미리 확보한다(확인 필요: dev-api 에서 CLOSED 장소 id).

- **진입.** 홈 「더 보기」 `home-spots-more` 를 누른다. testID: `explore-places-root`, 앱바 「장소 탐색」, 검색 testID: `explore-places-search`(placeholder 「장소 · 명소 · 맛집 검색」), 지역 칩 testID: `explore-places-region` 「전체 지역」, 그리드 testID: `explore-places-grid`.
- **로딩.** 첫 조회 중 testID: `explore-places-loading` 에 「장소를 모으는 중」과 스켈레톤 testID: `explore-places-skeleton-${index}`.
- **카드.** 카드 testID: `explore-places-card-${poiId}`, 사진 testID: `explore-places-photo-${poiId}`. 카드 press → 장소 상세.
- **카테고리.** 칩 testID: `explore-places-category-${code}`(code: `all`·`attraction`·`food`·`cafe`·`nightview`·`nature`·`shopping`·`culture`·`activity`·`art`·`bar`) 중 `food`(「맛집」)를 누른다. 그 칩 `selected` true, 목록이 다시 로딩된 뒤 바뀐다.
- **검색.** `explore-places-search` 에 「해운대」 `fill`. 300ms 뒤 목록이 서버 결과로 바뀐다. 「zzqq」처럼 없는 말이면 testID: `explore-places-filterzero` 에 「‘zzqq’ 때문에 0건이에요」, testID: `explore-places-filterzero-clear` 「검색어 지우기」. 카테고리도 걸려 있으면 testID: `explore-places-filterzero-clear-all` 「조건 모두 해제」가 더해진다.
- **지역 바꾸기.** `explore-places-region` 을 누른다. 「여행지 선택」 지역 선택이 열리고, 시도→구군 카드(예 부산 해운대구)를 고르면 장소 탐색으로 돌아와 칩이 그 이름이 된다(누적 화면 없음).
- **빈 결과.** 조건 없이 0건이면 testID: `explore-places-empty`(「담긴 장소가 없어요」·「다른 지역을 둘러보고 ♥로 담아 보세요」)와 testID: `explore-places-empty-region` 「다른 지역 보기」 → 지역 선택.
- **오류.** 네트워크를 끊고 진입. testID: `explore-places-error` 「지금 장소 정보를 불러올 수 없어요」, testID: `explore-places-error-retry` 「다시 시도」.
- **부분 실패.** 지역 0곳 또는 2곳 이상 진입에서 한 지역만 실패하면 testID: `explore-places-partialfailure`(「일부 지역을 불러오지 못했어요」)와 testID: `explore-places-partialfailure-retry` 「다시 시도」.
- **더 받기.** 단일 지역(`?region=부산`)에서 끝까지 스크롤. testID: `explore-places-loading-more` 가 잠깐 뜨고 카드가 늘어난다.
- **동명 지역.** `?region=고성군&regionCode=48820` 으로 연다. 칩이 「고성군」이고 경남 고성 장소만 나온다. 여행 지역이 서울 중구·부산 중구인 위저드에서 꼭 갈 곳 고르기 → `mustvisit-pick-addmore` 로 오면 칩이 「중구 외 1곳」이고 두 중구 장소가 번갈아 나온다. 서버에 TRIP-1808 이 없으면 이름으로 조회돼 동명이 섞인다.
- **담기.** 카드 하트 testID: `explore-places-save-${poiId}` 를 누른다. 응답 전 비활성, 응답 후 담김. 담은 장소(`/explore/saved-places`)에서 그 장소가 목록 맨 아래(담은 순서 오름차순)에 있는지 다시 읽는다.
- **담기 실패.** testID: `explore-places-saveerror` 배너(예 「연결이 불안정해 담지 못했어요」) + testID: `explore-places-saveerror-retry` 「다시 시도」, 게스트면 testID: `explore-places-saveerror-login` 「로그인하기」 → `/(auth)/login`. 배너는 다음 조작(검색·칩·재시도·새 하트)에서 사라진다.
- **FAB.** testID: `explore-places-saved-fab`(「담은 장소」) → `/explore/saved-places`. testID: `explore-places-create-fab`(「여행 만들기」) → `/trips/new/step1`. 둘의 묶음 testID: `explore-places-fab-stack`.
- **앱바 뒤로.** testID: `explore-places-back` → 이전 화면.
- **상세 렌더.** 카드를 눌러 상세로. testID: `explore-place-detail`, 사진 testID: `explore-place-hero`, 제목 testID: `explore-place-title`, 영업시간 testID: `explore-place-openhours`(없으면 testID: `explore-place-unknown-openhours` 「미확인」), 주소 testID: `explore-place-address`(도로명 주소, 없으면 지역명, 둘 다 없으면 「미확인」), 지도 testID: `explore-place-map`.
- **상태 배지.** CLOSED 장소 id 로 진입하면 testID: `explore-place-status-badge` 에 「폐업」, UNVERIFIED·LOST 는 「미확인」, ACTIVE 는 배지 없음.
- **상세 저장.** testID: `explore-place-save`(라벨 `{이름} 저장`)를 누른다. `selected` 가 true 로, 글리프 testID: `explore-place-save-filled` 로 바뀐다(해제면 `explore-place-save-outline`). 저장 중엔 비활성. 실패면 testID: `explore-place-saveerror` + `explore-place-saveerror-retry`/`explore-place-saveerror-login`. 결과를 담은 장소에서 다시 읽는다.
- **주소 복사.** 도로명 주소가 있는 장소에서 testID: `explore-place-address-copy`(「주소 복사」)를 누른다 → 토스트 testID: `explore-place-address-copied`(「주소를 복사했어요」), 실패면 testID: `explore-place-address-copy-failed`(「주소를 복사하지 못했어요」). 지역명·「미확인」 행엔 이 버튼이 없다. 실제 클립보드 내용은 시뮬레이터 검색창·메모에 붙여 넣어 확인한다.
- **공유.** testID: `explore-place-share`(「공유」) → OS 공유 시트(장소 이름). 시트는 취소까지만 한다.
- **네이버 지도.** testID: `explore-place-open-naver`(「네이버 지도에서 보기」) → 외부 앱/웹이 열린다. 실패면 testID: `explore-place-opennaver-error` 「네이버 지도를 열 수 없어요. 잠시 후 다시 시도해 주세요.」.
- **뒤로.** testID: `explore-place-back`(「뒤로」) → 직전 화면. 딥링크 직진입이면 홈 탭으로 교체된다.
- **로딩·없음·오류.** 조회 중 testID: `explore-place-loading`(빈 화면). 없는 UUID `com.trippilot.travel://explore/places/00000000-0000-4000-8000-000000000000` → testID: `explore-place-notfound`(「장소를 찾을 수 없어요」·「목록에서 다시 찾아 담아 보세요」, 버튼 없음) + 뒤로 testID: `explore-place-notfound-back`. 네트워크를 끊거나 UUID 형식이 아닌 id(`…/explore/places/does-not-exist`, 몇 초 재시도 뒤)로 진입 → testID: `explore-place-error`(「장소를 불러오지 못했어요」·「네트워크를 확인하고 다시 시도해주세요」) + testID: `explore-place-retry` 「다시 시도」 + 뒤로 testID: `explore-place-error-back`.

## Gotchas

- 목록 순서는 진입마다 새 무작위 seed 다 — 같은 카드 위치를 두 진입에 걸쳐 기대하지 않는다. 칩·검색·재시도 동안은 같은 seed 를 쓴다.
- 지역 0곳·2곳 이상 진입은 병렬 병합 경로라 무한 스크롤 동작이 단일 지역과 다를 수 있다(어느 쪽이 그려지는지 6-b 실기 확인 필요).
- 위저드 출처(`from=wizard`)면 ＋ FAB 가 없고 ♥ 는 직전 화면(위저드)으로 돌아간다 — 딥링크로 `from=wizard` 를 붙여 들어오면 ♥ 가 스택 밖으로 나가거나 무반응일 수 있다(미확인). 위저드 출처에서 지역 칩으로 지역을 바꾸면 `from` 이 지워져 ＋ 가 다시 생기고 누르면 위저드 입력이 초기화된다(알려진 함정).
- 지역 칩으로 고른 지역은 이름·코드 한 쌍으로 교체된다 — `{첫 지역} 외 N곳` 다지역 상태는 칩 선택 후 사라진다.
- 코드 없이 저장된 옛 여행(이름만으로 코드를 못 정한 `중구` 등)은 이름으로 묻어 동명 지역이 계속 섞인다.
- 서버 지역 필터는 `poi.region` 이 NULL 인 장소를 못 건다(QA: 「익선동」이 종로구 칩에서 0건). 0건 안내는 검색어 탓으로 지목하고 지역 해제 버튼은 없다.
- 지역 미지정 진입은 서비스 지역 6곳만 묻는다 — 「전체 지역」이 전국이 아니다.
- 미인증 딥링크에서 담기 하트·상세 저장을 누르면 「로그인하기」가 로그인 화면을 여는데, 상황에 따라 로그인 화면이 열리지 않을 수 있다(확인 필요).
- `GET /places`·`/places/{poiId}` 가 미인증에 401 을 주는지 확인 필요 — 주면 미인증 딥링크는 오류 얼굴이다.
- **[실화면 전용]** 미니맵(네이버 네이티브)은 Client ID·번들 불일치 시 회색 빈 지도로 조용히 실패한다(`map-failure` 표면은 env 키 부재만 잡는다).
- **[실화면 전용]** 주소 복사는 네이티브 재빌드(`expo-clipboard`) 전 옛 dev build 에서는 눌러도 에러 토스트로 접힌다(크래시 없이). 복사 버튼 44×44·아이콘 중앙·긴 주소 줄바꿈 때 버튼이 안 밀리는지·토스트가 가려지지 않는지는 프리뷰 `place-detail-default` 로 육안 대조한다. 웹은 https 에서만 복사된다.
- **[실화면 전용]** 상세 원형 버튼(뒤로·공유·저장)은 `top-[52px]` 고정이라 기기별 상태바와 겹칠 수 있다. 공유 시트·네이버 앱 열림은 OS 화면이라 증명 후 바로 취소·복귀한다.
- 상세 하트 해제(이미 담긴 장소) 경로는 통합테스트가 없다 — 실화면에서 해제→담은 장소에서 빈 하트/사라짐까지 반드시 다시 읽는다.
- **[실화면 전용]** 우측 열 카드 하트가 ♥ FAB 아래 깔리던 실측이 있었다(현재는 스크롤 중 FAB 숨김). 스크롤을 멈추면 250ms 뒤 FAB 가 돌아오니 그때 하트를 누르면 FAB 가 받을 수 있다.
- 키보드가 떠 있을 때 0건 안내의 첫 탭은 바로 버튼에 간다(`keyboardShouldPersistTaps="handled"`). 키보드에 가려지면 스크롤한다.
- 복제 탭바·FAB 은 `(tabs)` 밖이라 전환 애니메이션 없음(`animation: 'none'`)이 정상이다.
- **[실화면] 2026-10-31 딥링크는 `com.trippilot.travel://…` 스킴으로만 화면이 바뀐다** — `simctl openurl "trippilot:///…"` 는 앱만 앞으로 오고 라우팅되지 않았다(이 dev build Info.plist 에 `trippilot` 스킴이 네이버 로그인 urlScheme 으로 한 번 더 등록돼 있다, [결함 의심 FM-L1-04]).
- **[실화면] 2026-11-07 d04 메모리(TRIP-1813, iOS 시뮬·개발 번들·`footprint`)** — 새로 켠 앱 → d01 → d04 → 플링(`swipe 200 750 200 200`) 40회: 쉬는 값 증가 +69·+79·+98·+147MB(고치기 전 +700~+892, 중앙값 +88 대 +825). 플링 중 순간 최대(`phys_footprint_peak`)는 767~870MB(고치기 전 1,405~1,445MB)라 쉬는 값보다 200MB 넘게 높다. 3번 재진입 끝 650MB(고치기 전 2,338MB)이고, 그래도 재진입마다 조금 오른다(뒤로 600→605→613MB). 위로 40회에 받은 양은 `nettop` 0MB(`none` 은 53MB — 연결이 닫히면 계량이 줄어 0바이트 증명은 아니다). 위로 돌아올 때 회색 칸은 본문 면적 최대 1%로 칸 하나(약 9%)에 못 미친다(develop 0.1%, 번갈아 3회씩). 화면을 나간 효과는 1~5MB 뿐이다 — 쉬는 값이 이미 사진 없는 상태라(CG image 5MB) 남는 것은 할당기·Hermes 힙이 쥔 용량이다. 메모리 경고·실기기·안드로이드는 안 쟀고, 웹은 비우기가 아무 일도 안 한다.
- [실화면] 2026-10-31 도달 불가 — `places-loading`(순간 상태)·`places-error`·`places-partial-failure`·`places-save`의 실패 배너·`place-detail-loading` 정지 화면(네트워크 차단 수단 없음), `places-empty`(조건 없이 0건인 지역을 못 찾음), `places-load-more`(접근성 트리가 보이는 카드만 내줘 개수 증가를 증명 못 함), 상태 배지(CLOSED/UNVERIFIED poiId 미확보).
- [실화면] 2026-10-31 공유 시트를 닫은 직후 「네이버 지도에서 보기」 첫 탭은 씹혔고, 다시 누르면 Safari 가 map.naver.com 검색을 연다.
- [실화면] 2026-10-31 검색어 입력 중 0건 안내 버튼이 키보드 예측 막대 높이(y≈566)에 걸려 첫 탭이 예측 단어에 들어갔다 — 키보드를 return 으로 내린 뒤 누른다.
- [실화면] 2026-11-03 「전체 지역」으로 30번 끌어 바닥까지 내려도 다음 장 이어 받기는 안 일어났다(그 경로는 지역마다 한 장씩만 받는다) — `places-load-more` 는 여전히 미증명이다. 이어 받기를 보려면 한 지역 칩을 골라 끝까지 내린다(미확인).
- [실화면] 2026-11-02 담기 하트는 토스트를 띄우지 않는다 — FAB 위 토스트는 `nav.mjs --eval` 로 `showToast` 를 불러 봤다(위저드 출처라 ♥ 하나 위). 장소 상세 미니맵 핀에는 번호 「1」이 들어 있다.
- [실화면] 2026-11-02 실패 주입(sim-qa §2 `_dev/fault`)으로 열림 — `places-loading`·`places-error`(`/places`)·`place-detail-loading`·장소 상세 오류(`/places/*` 500, 「장소를 불러오지 못했어요」). `places-partial-failure` 는 지역별 요청을 가를 수 없어 못 엶.
