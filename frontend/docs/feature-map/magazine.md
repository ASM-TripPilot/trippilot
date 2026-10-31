---
id: magazine
band: a
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/magazine.tsx
---

# 매거진 (여행지 둘러보기)

「여행지 둘러보기」 앱바 아래 「책장 넘기듯, 여행을 상상해요」 헤딩, 필터 칩 5개, 이 주의 에디토리얼 카드, 「테마로 골라보기」 6카드 매서너리 그리드를 보여 주는 보기 전용 화면이다. 데이터는 전부 앱에 박힌 고정 샘플(서버 API 없음)이고, 칩은 선택 하이라이트만 옮길 뿐 카드를 거르지 않는다. 앱 안에서 들어오는 길이 없어 딥링크로만 닿는다.

## Sub-features

- `magazine-render` 앱바 「여행지 둘러보기」·헤딩·부제 「가고 싶은 곳을 눈으로 먼저 다녀오세요」·에디토리얼(「이 주의 여행 이야기」 / 「골목마다 색이 다른 마을」)·6카드(「전포 카페 투어」 등)가 그려진다.
- `magazine-chip-select` 칩(「전체」·「당일치기」·「1박 2일」·「2박 3일」·「한 달 살기」) press → 그 칩만 검은 배경(선택)으로, 카드 목록은 그대로.
- `magazine-back` 앱바 뒤로 → 직전 화면.
- `magazine-dead-controls` 검색 아이콘·카드·카드 하트는 누를 수 있어 보여도 아무 동작이 없다(배선 없음).

## How to get to it (user POV)

- 딥링크만 있다. 실화면에서 통하는 것은 `com.trippilot.travel://magazine` 이다(`trippilot:///magazine` 은 라우팅 안 됨 — Gotchas).
- 홈 도시 카드는 매거진이 아니라 탐색 탭으로 간다. 앱 안에서 매거진으로 가는 버튼은 없다.
- `(tabs)` 밖·가드 밖 라우트라 미인증 상태에서도 딥링크로 열린다.

## Driving it with agent-device

Preconditions:

- 앱이 떠 있고 dev build 가 이 워크트리 번들을 서빙 중. 로그인 여부 무관.

- **진입.** `xcrun simctl openurl booted "com.trippilot.travel://magazine"`. testID: `magazine-root` 와 앱바 「여행지 둘러보기」가 보인다.
- **고정 콘텐츠.** testID: `magazine-editorial` 안에 「이 주의 여행 이야기」·「골목마다 색이 다른 마을」, testID: `magazine-grid-head` 에 「테마로 골라보기」·「전체」, testID: `magazine-masonry` 안 카드 testID: `magazine-card-${index}`(0~5).
- **칩 선택.** 칩 testID: `magazine-chip-${i}` 중 i=1(「당일치기」)을 누른다. 그 칩이 선택 스타일이 되고 「전체」(i=0)가 풀린다. 카드 6장은 그대로다.
- **죽은 조작 확인.** testID: `magazine-appbar-search`, `magazine-card-${index}`, 하트 testID: `magazine-heart-${index}` 를 눌러도 화면이 바뀌지 않는다 — 지금은 이것이 기대 동작이다.
- **뒤로.** testID: `magazine-appbar-back`(라벨 「뒤로가기」)를 누른다. 딥링크로 바로 열면(직전 화면 없음) 뒤로가 먹지 않는다 — 결함 의심 FM-L1-02.

## Gotchas

- 과거 QA 여러 회차에서 `simctl openurl trippilot:///magazine` 가 화면을 바꾸지 못했다(포트 8082 dev client 등 환경 탓으로 추정, 미확정). Metro 를 8081 로 띄운 이 워크트리 번들인지 먼저 확인하고, 그래도 안 바뀌면 `live-unreachable` 로 남긴다.
- 칩 하이라이트는 jest 가 상태 이동만 잠근다 — 칩 선택이 카드를 거르지 않는 것은 설계다(결함으로 보고하지 않는다).
- 검색 아이콘·카드는 `Pressable` 이라 접근성 트리에서 눌림 대상처럼 보일 수 있다. 무반응은 의도된 미배선(심사 감사로 홈 진입을 막은 상태)이다.
- 히스토리 없는 딥링크 진입에서 뒤로가 무반응일 수 있다(홈 폴백 없음) — 확인 필요.
- 사진은 번들 플레이스홀더다. **[실화면 전용]** 매서너리 높이 엇갈림·사진 표시는 눈으로만 본다.
- **[실화면] 2026-10-31 딥링크는 `com.trippilot.travel://…` 스킴으로만 화면이 바뀐다** — `simctl openurl "trippilot:///…"` 는 앱만 앞으로 오고 라우팅되지 않았다(이 dev build Info.plist 에 `trippilot` 스킴이 네이버 로그인 urlScheme 으로 한 번 더 등록돼 있다, [결함 의심 FM-L1-04]). 과거 QA 의 「openurl 이 화면을 못 바꿨다」도 이 원인으로 보인다(추정).
- [결함 의심 FM-L1-02] 앱이 꺼진 상태에서 딥링크로 콜드 진입하면(히스토리 없음) 앱바 뒤로가 무반응이고 dev 빌드에 「The action 'GO_BACK' was not handled by any navigator」 경고가 뜬다 — 화면에 갇힌다. 앱이 떠 있을 때 진입하면 뒤로가 직전 화면(홈)으로 간다.
- [실화면] 2026-10-31 칩 선택은 화면에서만 바뀐다 — 칩에 접근성 `selected` 상태가 없어 트리로는 판정 못 하고 스크린샷으로 본다.
