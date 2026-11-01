---
id: my-tab
band: l
status: live-verified
live_verified_at: 2026-11-02 (f153fe245)
routes:
  - app/(tabs)/my.tsx
---

# 마이 탭

마이 탭(l03)은 프로필(닉네임·이메일·취향 태그)과 확정된 여행 수(예정·진행 중·종료)를 보여 주고, 숫자를 누르면 일정·기록 탭으로 보낸다. 그 아래 스타일 요약 카드, 예정 여행이 없을 때만 열리는 "지난 여행" 섹션, 그리고 등록 숙소·여행 스타일 분석·설정으로 가는 메뉴 카드가 있다. 이 화면은 데이터를 바꾸지 않는다 — 모든 조작은 다른 화면으로의 이동이다.

## Sub-features

- `my-profile` 프로필 카드에 닉네임 이니셜 아바타·닉네임·이메일·태그 줄을 보인다.
- `my-profile-unknown` 닉네임을 아직 모르면 이름 자리에 회색 막대, 이메일이 없으면 이메일 줄을 생략한다.
- `my-counts` 예정·진행 중·종료 3칸에 **일정이 확정된** 여행 수를 보인다(초안은 세지 않는다).
- `my-counts-unknown` 여행 목록이나 여행 하나의 일정이라도 조회 중·실패면 세 칸 모두 `–`.
- `my-counts-nav` 예정·진행 중 칸 → 일정 탭, 종료 칸 → 기록 탭으로 바뀐다(replace).
- `my-style-official` 정식 분석이면 디스크립터 칩 + 3축 점 게이지(여유로움·미식 취향·활동성) + `상세 분석 ›`.
- `my-style-insufficient` 정식 분석 미달이면 "10곳 이상 쌓이면 분석을 제공해요 (현재 N곳)" 한 줄만.
- `my-style-missing` 스타일 조회 전·실패면 카드 자체가 없다.
- `my-past` 예정 여행이 0건일 때만 "지난 여행" 섹션과 `캘린더 ›` 링크가 열린다.
- `my-past-empty` 섹션이 열렸는데 종료 여행이 0건이면 "아직 종료된 여행이 없어요".
- `my-past-row` 지난 여행 행(제목·기간·`사진 N`) → 그 여행의 기록 화면.
- `my-menu-stays` `등록 숙소` 행 → 등록 숙소 목록(상세는 `stay-register.md`).
- `my-menu-style` `여행 스타일 분석` 행 → 스타일 분석 화면(상세는 `record-style.md`).
- `my-menu-settings` 헤더 톱니와 하단 `설정` 행 → 설정(`settings.md`).
- `my-profile-look` 프로필 숫자 칸의 ›는 라벨 옆 별도 글자다(프로필 [편집] 버튼은 화면에 없다 — Gotchas). 스타일 게이지 점은 라벨 바로 뒤에 붙는다(양끝 벌림 아님). *(2026-11-01 jest 축소로 실화면 전용 · 2026-11-02 실화면 — 지도 정정)*

## How to get to it (user POV)

- 하단 탭바의 마이 탭(맨 오른쪽).
- 딥링크 `trippilot:///my`(시뮬에선 `com.trippilot.travel://my` — `trippilot://` 는 네이버 SDK가 가로챈다) — 탭 그룹 안으로 열려 탭바가 보이고 마이 탭이 선택된다(2026-10-31 실측).
- 다른 화면에서 이 탭으로 오는 버튼은 없다(탭바만).

## Driving it with agent-device

Preconditions:

- 로그인된 계정, HOME 진입 상태(탭바가 보인다).
- 숫자 3칸 검증에는 일정이 **확정된** 여행이 각 단계별로 있어야 한다. 초안(일정 없음·미확정) 여행은 어느 칸에도 안 잡힌다.
- 스타일 정식 카드는 누적 방문 10곳 이상인 계정에서만, 미달 카드는 그 미만 계정에서 보인다.
- "지난 여행" 섹션은 예정 여행이 0건인 계정에서만 열린다 — 예정 여행이 있는 계정으로는 이 섹션을 증명할 수 없다.

- **진입.** 탭바 마이 탭을 좌표로 누른다(trippilot-sim-qa §2 탭바 좌표). testID: `my-page-root` 가 보이고 헤더에 "마이페이지".
- **프로필.** testID: `my-profile-card` 안에 닉네임과 이메일이 보이고, 태그가 있으면 testID: `my-profile-tag` 칩이 1개 이상. 정식 분석이면 태그는 정식 분석 디스크립터, 미달이면 온보딩 취향 미리보기 디스크립터다.
- **숫자 3칸.** testID: `my-profile-count-upcoming-value`·`my-profile-count-active-value`·`my-profile-count-ended-value` 의 값이 숫자 또는 `–`. 라벨은 "예정"·"진행 중"·"종료". 값을 일정 탭 카드 수와 대조한다.
- **숫자 → 탭.** testID: `my-profile-count-upcoming` 를 누른다 → 일정 탭으로 바뀐다(마이 탭이 스택에 남지 않는다). `my-profile-count-ended` → 기록 탭. 각 확인 뒤 마이 탭으로 돌아온다.
- **스타일 카드(정식).** testID: `my-style-card` 에 "내 여행 스타일", testID: `my-style-chip` 칩들, testID: `my-style-gauge` 3행. 각 행의 testID: `my-style-dot-filled` 개수가 그 축 값이다(0~5). testID: `my-style-detail`("상세 분석 ›")을 누르면 스타일 분석 화면 — 이후는 `record-style.md`.
- **스타일 카드(미달).** testID: `my-style-card` 에 "10곳 이상 쌓이면 분석을 제공해요 (현재 N곳)" — 게이지·칩·`my-style-detail` 이 없다.
- **지난 여행.** (예정 0건 계정) "지난 여행" 제목과 testID: `my-past-calendar`("캘린더 ›")가 보인다. 누르면 기록 탭 캘린더(`/records`)로 push. 행은 testID: `my-trip-reflection-<tripId>` — 누르면 그 여행 기록(`/trips/<tripId>/records`). 종료 여행이 없으면 "아직 종료된 여행이 없어요".
- **메뉴.** testID: `my-menu-card` 안에 "등록 숙소"(testID: `my-stays-row`)·"여행 스타일 분석"(testID: `my-style-analysis-row`)·"설정"(testID: `my-settings-row`) 3행. 각 행을 눌러 등록 숙소 목록·스타일 분석·설정 헤더 "설정"이 뜨는지 보고 뒤로 돌아온다.
- **헤더 톱니.** testID: `my-header-settings`(접근성 라벨 "설정") → 설정 화면.
- **증거.** 프로필 카드·숫자 3칸·메뉴 카드가 함께 보이는 상태에서 스냅샷과 스크린샷을 남긴다.

## Gotchas

- 숫자 칸 testID는 `my-profile-count-${bucket}`·그 뒤 `-value` 꼴이다(예 `my-profile-count-upcoming-value`). 지난 여행 행도 `my-trip-reflection-${trip.tripId}`.
- 브리프에 적힌 "세그먼트·여행 카드"는 TRIP-1123에서 걷혔다 — 이 화면에 여행 목록·세그먼트·[새 여행 만들기]는 없다. 여행 목록 입구는 숫자 3칸뿐이다.
- 숫자는 서버 `Trip.status`가 아니라 "일정 확정 × 서울 오늘"로 센다. 일정 탭에 보이는 초안 여행이 마이 숫자에 안 잡히는 것은 정상이다.
- 일정 조회가 하나라도 실패하거나 늦으면 세 칸 모두 `–`이고 "지난 여행" 섹션도 닫힌다 — 섹션이 안 보인다고 바로 "예정 여행 있음"으로 판정하지 않는다.
- "내 일정 공개/공유 설정"·"내가 공유한 일정"·"숨긴 사용자 관리" 행은 아직 화면에 없다(U7 전). 찾으면 안 나오는 것이 정상이다.
- 프로필 [편집] 버튼(`my-profile-edit`)은 페이지가 콜백을 안 넘겨 화면에 없다. 닉네임 변경은 설정에서만 한다(`settings.md`).
- 숫자 칸·`등록 숙소`·`여행 스타일 분석`·스타일 상세는 연타 가드(`guardPress`)가 있지만 헤더 톱니·`설정` 행·`캘린더 ›`·지난 여행 행에는 없다 — 연타 시 같은 화면이 두 번 쌓이는지는 실화면 전용으로 본다. [실화면 전용]
- 프로필 태그와 스타일 칩이 같은 문구를 두 번 보이는 것은 지난 QA(20261021 N-053)에서 지적된 현 상태다 — 결함 판정은 사람 몫.
- 스타일 조회가 실패하면 카드가 조용히 사라진다(오류 표면 없음). 카드가 없다고 "미달"로 판정하지 않는다.
- [실화면] 2026-10-31 숫자 3칸은 접근성 트리에 testID 대신 라벨 `4, 예정, ›`·`1, 진행 중, ›`·`6, 종료, ›` 로 잡힌다 — `role=button label="<값>, 예정, ›"` 로 누른다(값이 바뀌면 라벨도 바뀐다). `-value` testID는 트리에 따로 없다. 헤더 톱니도 라벨 "설정"이 하단 `설정` 행과 겹치니 `role=button`(톱니)·`role=cell`(행)로 가른다.
- [실화면] 2026-10-31 도달 불가 — `my-past`·`my-past-empty`·`my-past-row`: 계정에 예정(확정) 여행이 4건이라 "지난 여행" 섹션이 닫혀 있다. `my-profile-unknown`·`my-counts-unknown`·`my-style-missing`: 조회 중·실패 얼굴은 만들 수단이 없었다(네트워크 차단 미실시). `my-style-insufficient`: 계정이 정식 분석 상태.
- [실화면] 2026-11-02 실패 주입(sim-qa §2 `_dev/fault`)으로 열림 — `my-profile-unknown`·`my-style-missing`(`/me/profile`·`/me/style` 500 — 이름 자리 회색 막대, 스타일 카드 없음)·`my-counts-unknown`(`/trips` 500 — 세 칸 `–`).
