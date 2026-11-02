---
id: tab-bar
band: a
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/(tabs)/_layout.tsx
---

# 하단 탭바

화면 아래 떠 있는 유리 알약 하나에 5칸(홈·탐색·일정·기록·마이)이 있다. 누르면 그 탭으로 바뀌고 활성 칸은 분홍 채움 아이콘·굵은 라벨이 된다. `(tabs)` 안 5탭은 탭 레이아웃이 진짜 탭바를 그리고, `(tabs)` 밖인데 탭바가 필요한 화면(장소 탐색·숙소 검색·여행 스타일)은 같은 컴포넌트의 복제본을 화면 안에 그려 누르면 스택을 걷어내고 그 탭으로 돌아간다. 여행 중 허브·기록 화면의 「뒤로 원 + 캡슐」 바는 다른 컴포넌트(`widgets/bottom-nav-bar`)로, 여기서는 존재만 가리킨다.

## Sub-features

- `tabbar-switch` 칸 press → 해당 탭(`index`·`explore`·`itinerary`·`records`·`my`)으로 이동, 선택 칸 `accessibilityState.selected=true`.
- `tabbar-active-icon` 활성 칸은 `-active`, 나머지는 `-inactive` 아이콘 컨테이너.
- `tabbar-copy-dismiss` `(tabs)` 밖 복제 탭바 press → 쌓인 화면을 걷고 그 탭으로(탭 화면이 아래에 없으면 지금 화면이 그 탭으로 바뀐다).
- `tabbar-hidden` 화면이 탭바 숨김을 요청하면 그리지 않는다(내 여행 목록의 정렬 시트·삭제 확인창이 열린 동안).
- `tabbar-overlay` 탭바는 콘텐츠 위 투명 띠(최소 96px, 큰 글자면 자란다 — 토스트 바닥은 그 실측 높이로 잡혀 알약을 가리지 않는다)로 뜨고, 띠의 빈 부분 터치는 아래로 통과한다.
- `bar-screen-no-slide` 하단 바를 자기 화면 안에 그리는 화면(기록 j01·회고 j03·요약 j04·여행 스타일 j05·여행 중 허브·Plan-B 요청)으로 갈 때는 슬라이드 없이 바로 바뀌어 바가 옆으로 미끄러지지 않는다. 회고·요약은 가장자리 스와이프 뒤로가 꺼져 있다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass(일부 — Gotchas))*
- `bar-glass` 탭 바·여행 중 하단 바·수정 팝업·기회 카드는 반투명 유리 면(뒤가 흐리게 비침·옅은 테두리·그림자)이고, 유리 면이 그 아래·안쪽 버튼 누름을 막지 않는다. *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 pass)*

## How to get to it (user POV)

- 로그인 후 홈 착지 시 항상 보인다(5탭 전부).
- 장소 탐색 `/explore/places` — 복제본, 「탐색」 활성 — explore-places.md.
- 숙소 검색 `/stays` — 복제본, 「탐색」 활성 — stay-search.md.
- 여행 스타일 `/records/style` — 복제본, 「마이」 활성.
- 탭바가 **없는** 곳: 지역 선택·장소 상세·담은 장소·도우미 시트·위저드 등 `(tabs)` 밖 몰입 화면.

## Driving it with agent-device

Preconditions:

- 로그인 완료 계정(가드 HOME).

- **탭바 존재.** 홈에서 testID: `shell-tabbar-root` 와 칸 5개 testID: `shell-tabbar-tab-${key}`(`home`·`explore`·`itinerary`·`records`·`my`), 라벨 「홈」·「탐색」·「일정」·「기록」·「마이」를 확인한다. 칸은 접근성 role `tab` 이다(단 iOS XCTest·agent-device 트리에선 type `Other` 로 보인다 — role 로 잡지 말고 testID 로 잡는다).
- **탭 전환.** `shell-tabbar-tab-explore` 를 누른다. 탐색 랜딩 `explore-landing` 이 보이고 그 칸의 `selected` 가 true, 아이콘 testID: `shell-tabbar-icon-${key}-active` 가 `explore` 로 바뀐다. 나머지 칸은 `shell-tabbar-icon-${key}-inactive`.
- **5칸 순회.** 「일정」·「기록」·「마이」·「홈」을 차례로 눌러 각 탭 루트가 뜨는지 본다(각 탭 화면 내용은 해당 기능 파일 소관).
- **복제 탭바 복귀.** 홈 → 「지금 뜨는 장소」 「더 보기」로 장소 탐색을 연 뒤 `shell-tabbar-tab-home` 을 누른다. 장소 탐색이 걷히고 홈이 남는다(뒤로 스와이프로 장소 탐색이 다시 나오지 않아야 한다).
- **복제 탭바 다른 탭.** 장소 탐색에서 `shell-tabbar-tab-itinerary` 를 누른다. `(tabs)` 의 「일정」 탭이 뜬다(`/itinerary`).
- **숨김.** 「일정」 탭 내 여행 목록에서 정렬 시트를 연다. 그 동안 `shell-tabbar-root` 가 없다. 닫으면 다시 나온다.

## Gotchas

- 허브·기록 3화면 하단의 「뒤로 원 + 캡슐 칸」 바는 5탭 탭바가 아니다 — 그 바는 여행 중·기록 기능 파일 소관이다.
- 홈 탭 경로는 `/` 가 아니라 `/(tabs)` 다 — `/` 는 온보딩 그룹과 겹쳐 가드에 막힐 수 있다. 딥링크로 홈을 열 땐 탭 전환으로 증명한다.
- `(tabs)` 밖 복제 탭바 화면(`explore/places`·`stays/index`·`records/style` 등)은 진입 전환이 `animation: 'none'` 이다 — 슬라이드 없이 즉시 바뀌는 게 정상이다.
- 숙소 검색 복제 탭바 press 는 연타 가드 창 안이면 무시된다(필터 시트 「적용」 직후).
- 탭바는 홈 인디케이터 안전영역을 더하지 않는다. **[실화면 전용]** 기기별 하단 여백·알약 블러·라벨 대비, 마지막 행이 탭바에 가리는지는 눈으로만 본다.
- **[실화면 전용]** 시트·다이얼로그 딤이 탭바를 덮는지 — 덮지 못하는 화면은 숨김 요청을 따로 해야 한다(현재 내 여행 목록만 한다). 새 시트 화면에서 탭바가 딤 위에 밝게 남으면 결함 후보다.
- 큰 글씨(XXXL)에서 라벨이 칸마다 사라지는 현상이 과거 QA에 있었다(라벨 `adjustsFontSizeToFit`·1줄). 큰 글씨 검증 시 라벨 존재를 접근성 트리로 확인한다.
- 시뮬레이터에서 푸시 토큰 경고 LogBox 가 탭바를 가려 탭이 씹힌 실측이 있다 — LogBox 를 닫고 누른다.
- [실화면] 2026-10-31 도달 불가 — `tabbar-overlay`(띠 빈 부분 터치 통과): 띠 아래에 눌러 볼 수 있는 대상이 없는 화면만 만나 증명하지 못했다.
- [결함 의심 FM-L1-03] 탐색 탭(d01)에서 연 제휴 고지 시트(인기 숙소 카드)의 [취소]·[Trip.com으로 이동] 버튼이 진짜 탭바 아래 깔린다 — 누르면 탭바가 받아 [이동] 자리는 「마이」 탭, [취소] 자리는 「탐색」 탭 재선택(지역 필터 초기화)이 된다. `(tabs)` 밖 숙소 검색(e02)에선 시트가 탭바를 덮어 정상(증거 `curated-stays/explore-sheet-under-tabbar.png`).
- [결함 의심 FM-L1-05] 홈·탐색 ♥ 메뉴 딤이 탭바를 덮지 않는다(home.md).
- [실화면] 2026-11-02 가장자리 스와이프는 `agent-device gesture swipe right` 로 흉내 낸다(설정 → 직전 화면 대조군으로 확인, sim-qa §2). j04 요약·j03 회고에선 같은 조작에 화면이 그대로였다. j05·Plan-B 요청 진입 전환은 안 봤다.
