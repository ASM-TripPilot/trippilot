---
id: trip-create
band: g
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/new/_layout.tsx
  - app/trips/new/step1.tsx
  - app/trips/new/step2.tsx
---

# 여행 만들기 (위저드 1/4·2/4)

사용자가 여행지(여러 도시·도시별 박수)·출발일·일과 시간·동행·취향을 요약 카드 다섯 행에서 고르고 [다음]을 누르면 서버에 여행이 만들어진다. 1박 이상이면 2/4 거점 숙소 화면으로, 당일치기(박수 합 0)면 2/4를 건너뛰고 곧장 3/4 일정 방식 선택으로 간다. 위저드 단계는 1/4(g01)·2/4(g02)·3/4(h 밴드 — `itinerary-method.md` 소관)다. 이미 만든 여행으로 1/4에 돌아와 [다음]을 다시 누르면 새로 만들지 않고 고친다. 이미 만든 여행에서 ‹를 누르면 저장하고 나갈지·삭제하고 나갈지 묻는다.

## Sub-features

- `wizard-entry` 여러 입구(홈 FAB·탐색 FAB·장소 탐색 FAB·담은 장소 CTA·일정 탭 빈 상태·기록 탭 빈 상태·도우미)에서 1/4를 연다.
- `step1-summary` 요약 카드 다섯 행(여행지·기간·일과 시간·동행·취향)과 얼굴 셋(loading·empty·default 부제)을 그린다.
- `step1-destination` 여행지 시트에서 도시별 박수 −/+, 도시 빼기, 도시 추가(지역 선택으로 이탈 후 1박으로 담고 복귀)를 한다. 박수 합 상한은 30박이다.
- `step1-period` 기간 시트에서 출발일만 고른다. 종료일은 박수 합으로 정해진다. 과거 날짜와 오늘 달 이전은 막힌다.
- `step1-daywindow` 일과 시간 시트에서 하루 시작·첫날 시작·마지막 날 종료(당일치기면 시작·끝 두 칸)를 휠로 고른다. 깨진 창은 오류 문구와 함께 [적용]·[다음]을 막는다.
- `step1-companion` 동행 시트에서 유형 칩 4종과 인원 스테퍼를 고른다(혼자 1명·연인 2명 고정, 친구·가족 2명 이상).
- `step1-pref` 취향 시트에서 여행 스타일 7칩·선호 활동 8칩을 고른다. 이미 만든 여행이면 열리지 않고 토스트로 이유를 알린다.
- `step1-mustvisit` 꼭 갈 곳 가로 스트립(더 담기·전체 보기·담은 곳 카드)과 지역 밖 안내 줄([빼기]·[그대로 두기])을 다룬다.
- `step1-next-gate` [다음]은 여행지 1곳 이상·기간 선택·일과 시간 유효·담은 장소 조회 완료일 때만 켜진다.
- `step1-submit` [다음] 성공 시 여행 생성(POST) 후 꼭 갈 곳 등록, 0박이면 3/4로, 1박 이상이면 2/4로 간다.
- `step1-submit-fail` 생성·수정 실패 배너 「저장하지 못했어요」+[다시 시도], 국내 밖 차단 다이얼로그, 꼭 갈 곳 등록 실패 배너를 보인다.
- `step1-edit-existing` 이미 만든 여행이면 [다음]이 PATCH로 고치고 꼭 갈 곳을 서버와 맞춘다.
- `step1-leave` 이미 만든 여행에서 ‹·스와이프·하드웨어 뒤로가 이탈 다이얼로그(저장하고 나가기·삭제하고 나가기·계속 작성)를 연다. 삭제 실패는 다이얼로그 안 문구로 알린다.
- `step2-faces` 2/4 거점 숙소 얼굴 다섯(default·loading·empty·error·notrip)을 그린다.
- `step2-exit` [이 거점으로 일정 만들기]/[일정 만들기]·[숙소 없이 시작하기]·[숙소 없이 계속]이 2/4를 걷고 3/4 방식 선택을 연다.
- `step2-assign` 밤 카드를 눌러 숙소 선택 시트에서 거점을 지정한다(상세 손잡이는 `trip-bases.md`).

## How to get to it (user POV)

- 홈 탭 우하단 ＋ FAB(접근성 라벨 「여행 만들기」) — 직전 드래프트를 비우고 1/4를 push한다.
- 탐색 탭 랜딩의 ＋ FAB(라벨 「여행 만들기」) — 드래프트를 비우고 push.
- 장소 탐색(`/explore/places`)의 ＋ FAB — 드래프트를 비우고 push. 위저드에서 들어온 장소 탐색(`from=wizard`)에선 FAB이 숨는다.
- 담은 장소(`/explore/saved-places`, 일반 모드) 하단 「이 장소들로 여행 만들기」 — 드래프트를 비운 뒤 지금 목록을 꼭 갈 곳 시드로 심고 push. 시드가 1/4 스트립에 담긴 채로 열린다.
- 일정 탭 빈 상태 「여행 만들기」 버튼 — 드래프트를 비우고 push(`my-trips.md`).
- 기록 탭 캘린더 빈 상태 「새 여행 만들기」 버튼 — 드래프트를 비우고 push.
- 도우미 시트의 「새 여행 만들기」 류 다음 행동(`CREATE_TRIP`) — 1/4로 **replace**한다(드래프트를 비우지 않는다, Gotchas).
- 2/4 notrip 얼굴 「처음부터」 — 1/4를 push.
- 꼭 갈 곳 고르기(d02 select) 완료 — 위저드 안 재진입으로 1/4를 push(이미 만든 여행 id를 보존한다).
- 딥링크 `trippilot://trips/new/step1`·`trippilot://trips/new/step2` — 위저드는 인증 가드 밖이라 미인증에도 열린다.
- 2/4는 1/4 [다음] 성공(1박 이상)으로만 정상 진입한다. 3/4에서 뒤로는 1/4로 돌아온다(2/4는 3/4 진입 때 스택에서 걷힌다).

## Driving it with agent-device

Preconditions:

- 로그인한 계정(게스트도 1/4는 열리지만 [다음]은 서버 401로 실패한다). 온보딩 취향이 있으면 취향 행에 「내 취향」 배지가 붙는다 — 없으면 취향 행은 「취향 선택」 플레이스홀더다.
- 2/4 default·empty를 가르려면 저장 숙소(♥) 유무를 미리 맞춘다 — 저장 숙소 0곳이고 거점 배정 0건이면 empty다.
- 꼭 갈 곳·지역 밖 안내를 보려면 담은 장소에서 「이 장소들로 여행 만들기」로 들어오거나 더 담기로 고른다.
- 서버 실패 갈래(배너·국내 밖)는 실서버로 재현하기 어렵다 — 네트워크 차단으로 배너만 재현 가능하다.

- **진입.** 홈에서 FAB testID: `home-create-trip-fab` 을 탭한다. 1/4 루트 testID: `trip-wizard-step1-root` 가 뜨고 앱바 제목 「여행 만들기」, 진행 표시 testID: `trip-wizard-progress` 에 「1 / 4」, 막대 testID: `trip-wizard-progress-seg-1` 하나만 채워진다.
- **loading 얼굴.** 진입 직후 취향·담은 장소 조회 중이면 부제 testID: `trip-wizard-step1-subtitle` 가 「여행 정보를 불러오는 중이에요」, 행 값 자리는 스켈레톤 testID: `trip-wizard-summary-skeleton-1` 등, 꼭 갈 곳은 「담아 둔 곳을 불러오는 중이에요」+ testID: `trip-wizard-mustvisit-skeleton-${n}` 이고 [다음]은 꺼져 있다.
- **empty 얼굴.** 새 진입이면 여행지 행 testID: `trip-wizard-summary-destination` 에 「어디로 갈까요?」, 기간 행 testID: `trip-wizard-summary-period` 에 「기간 선택」, 동행 행은 기본값 「혼자」, 부제는 「여행지와 기간만 정하면 나머지는 채워둘게요 · 행을 누르면 바꿀 수 있어요」다. [다음] testID: `trip-wizard-step1-next` 는 비활성.
- **여행지 시트 열기.** 여행지 행을 탭한다. 시트 testID: `trip-wizard-destination-sheet`(제목 「여행지」, 부제 「도시와 머무는 밤을 정해요」)가 뜬다. 0곳이면 [적용] testID: `trip-wizard-destination-apply` 는 비활성.
- **도시 추가.** 「도시 추가」 testID: `trip-wizard-destination-add` 를 탭하면 지역 선택(`/explore/region?purpose=trip`)으로 간다. 인기 카드 testID: `explore-region-popular-${sidoCode}`(또는 시/도 행)를 누르면 시군구 드릴다운이 열리고, 「{시도} 전체」 행 testID: `explore-region-${sidoCode}`(예 `explore-region-26`) 또는 시군구 행 testID: `explore-region-${regionCode}` 를 탭하면 그 도시가 1박으로 담기고 자동으로 1/4로 돌아온다 — 시트는 열린 채다. 도시 행 testID: `trip-wizard-destination-row-${seq}` 에 도시명과 「1박」이 보인다.
- **박수 조절.** 행의 − testID: `trip-wizard-destination-nights-dec-${seq}`(라벨 「{도시} 1박 줄이기」)와 + testID: `trip-wizard-destination-nights-inc-${seq}` 를 누른다. 도시가 하나면 0박까지(당일치기), 둘 이상이면 1박이 하한이다. 합이 30박이면 +·도시 추가가 꺼지고 testID: `trip-wizard-destination-max-note` 「최대 30박까지 정할 수 있어요」가 뜬다. 변경은 [적용] 없이 즉시 요약 행에 반영된다.
- **도시 빼기.** testID: `trip-wizard-destination-remove-${seq}`(라벨 「{도시} 빼기」)를 누르면 행이 사라진다. 꼭 갈 곳이 있으면 testID: `trip-wizard-destination-note` 에 「꼭 갈 곳 N곳은 여행지를 바꿔도 그대로 남아요」 또는 지역 밖 수가 뜬다.
- **여행지 요약.** [적용]으로 닫으면 여행지 행 main은 첫 도시명, 보조 testID: `trip-wizard-summary-destination-sub` 는 「N박 · {둘째 도시} M박」 꼴이다.
- **기간.** 기간 행을 탭한다. 시트 testID: `trip-wizard-period-sheet`(「기간」/「언제 떠나요?」), 달 제목 testID: `trip-wizard-period-month` 「YYYY년 M월」, 안내 testID: `trip-wizard-period-note` 「종료일은 여행지에서 정한 박수로 정해져요」. 날짜 셀 testID: `trip-wizard-period-cell-${date}`(date=`YYYY-MM-DD`)를 탭하면 시작·끝 범위가 박수만큼 칠해지고 testID: `trip-wizard-period-summary` 에 날짜 범위가 뜬다. 과거 셀은 눌리지 않는다. 오늘 달에서는 testID: `trip-wizard-period-prev` 가 꺼지고 24개월 뒤에서 testID: `trip-wizard-period-next` 가 꺼진다. [적용] testID: `trip-wizard-period-apply` 는 시작을 고른 뒤에만 켜진다. 적용하면 기간 행에 「M월 D일(요일) – D일(요일)」+ 보조 「N박 M일」(당일치기면 「M월 D일(요일)」+「당일치기」)이 뜬다. 시트를 **다시 열면** 고른 출발일이 칠해져 있지 않고 오늘 달에서 시작하며 [적용]이 꺼져 있다 — 바꾸려면 날짜를 처음부터 다시 고른다.
- **일과 시간.** 일과 시간 행 testID: `trip-wizard-summary-daywindow` 은 기본 「09:00 시작」+ 보조 「기본」이다. 탭하면 시트 testID: `trip-wizard-daywindow-sheet`(제목 「일과 시간」)가 뜬다. 1박 이상이면 탭 testID: `trip-wizard-daywindow-tab-day`·`trip-wizard-daywindow-tab-first`·`trip-wizard-daywindow-tab-last`(라벨 「하루 시작」·「첫날」·「마지막 날」, 값 미정이면 「따로 안 정해요」)와 휠(접두 `trip-wizard-daywindow-wheel` 에 `-h-wheel`·`-m-wheel`·`-h-{HH}`·`-m-{mm}`, 분은 00·30만)이 있다. 당일치기면 「시작」·「끝」 두 휠(접두 `trip-wizard-daywindow-start`·`trip-wizard-daywindow-end`)이다. 첫날·마지막 날 탭에 값이 있으면 testID: `trip-wizard-daywindow-off` 「따로 정하지 않기」가 보인다. [기본값으로 되돌리기] testID: `trip-wizard-daywindow-reset`, [적용] testID: `trip-wizard-daywindow-apply`.
- **일과 시간 검증 실패.** 하루 시작을 21:00 이상으로 돌리면 testID: `trip-wizard-daywindow-error` 「하루 시작은 일과 종료보다 빨라야 해요」(당일치기는 testID: `trip-wizard-daywindow-error-end` 「종료는 시작보다 늦어야 해요」)가 뜨고 [적용]이 꺼진다. 적용 뒤 박수를 바꿔 창이 깨지면 행 보조가 「시작·종료 시각을 확인해 주세요」로 바뀌고 [다음]이 꺼진다.
- **동행.** 동행 행 testID: `trip-wizard-summary-companion` 을 탭한다. 시트 testID: `trip-wizard-companion-sheet`(「동행」/「누구랑 가세요?」), 칩 testID: `trip-wizard-companion-chip-${code}`(code=`alone`·`friend`·`partner`·`family`, 고른 칩엔 testID: `trip-wizard-companion-chip-active-${code}`), 인원 testID: `trip-wizard-companion-party-value` 「N명」과 −/+ testID: `trip-wizard-companion-party-dec`·`trip-wizard-companion-party-inc`. 「친구」를 고르면 인원이 2명으로 올라간다. [적용] testID: `trip-wizard-companion-apply` 뒤 행이 「친구 2명」(혼자는 「혼자」)이 된다. 적용 전 닫으면 바뀌지 않는다.
- **취향.** 취향 행 testID: `trip-wizard-summary-preference` 를 탭한다. 시트 testID: `trip-wizard-pref-sheet`(「취향」/「이 여행에만 적용돼요」), 「여행 스타일」 칩 testID: `trip-wizard-pref-chip-${slug}`(rest·gourmet·nature·art·activity·sightseeing·shopping), 「선호 활동」 칩 testID: `trip-wizard-pref-activity-chip-${slug}`(nature·history·themepark·foodtour·cafe·exhibition·nightview·shopping). 선택은 접근성 selected로 읽는다. [적용] testID: `trip-wizard-pref-sheet-apply` 뒤 행 main이 라벨 「 · 」 조인이 되고 「내 취향」 배지(testID: `trip-wizard-preference-sparkle`)가 사라진다.
- **꼭 갈 곳 스트립.** 블록 testID: `trip-wizard-mustvisit-block` 머리 「꼭 갈 곳 N곳」. 「더 담기」 testID: `trip-wizard-mustvisit-more` 와 (1곳 이상일 때만) 「전체 보기」 testID: `trip-wizard-mustvisit-see-all` 는 둘 다 담은 장소 고르기 모드(`/explore/saved-places?mode=select&region=…&from=wizard`)로 간다. 담은 곳 카드는 testID: `trip-wizard-mustvisit-${poiId}`.
- **지역 밖 안내.** 꼭 갈 곳 중 여행지 밖 장소가 있으면 하단에 testID: `trip-wizard-outside-notice` 「꼭 갈 곳 중 N곳은 이 여행 지역 밖이에요」가 뜬다. 「빼기」 testID: `trip-wizard-outside-notice-remove` 는 그 장소들을 스트립에서 빼고, 「그대로 두기」 testID: `trip-wizard-outside-notice-keep` 는 줄만 숨긴다. 이 줄은 [다음]을 막지 않는다.
- **[다음] 성공(1박 이상).** 여행지·기간을 채우면 [다음]이 켜진다. 누르면 2/4 루트 testID: `trip-base-step2-root`(제목 「거점 숙소」, 진행 「2 / 4」)가 뜬다. 결과는 일정 탭에서 다시 읽는다 — 새 여행 카드가 「작성중」 배지·「아직 일정이 없어요」로 보여야 한다(`my-trips.md`).
- **[다음] 성공(당일치기).** 도시 하나를 0박으로 줄이고 기간을 고른 뒤 [다음]을 누르면 2/4 없이 3/4 방식 선택이 열린다 — 이후는 `itinerary-method.md`.
- **제출 실패.** 네트워크를 끊고 [다음]을 누르면 testID: `trip-wizard-submit-banner` 「저장하지 못했어요」와 testID: `trip-wizard-submit-banner-retry` 「다시 시도」가 뜨고 화면에 머문다. 아무 행 값을 바꾸면 배너가 걷힌다.
- **국내 밖 차단.** 서버가 400 `OVERSEAS_DESTINATION`을 주면 testID: `trip-wizard-overseas-dialog` 「지금은 국내 여행만 지원해요」/「국내 도시로 만들어볼까요?」, 「국내 도시 고르기」 testID: `trip-wizard-overseas-dialog-confirm`, 「닫기」 testID: `trip-wizard-overseas-dialog-close`, 딤 testID: `trip-wizard-overseas-backdrop` 가 뜬다. 세 손잡이 모두 다이얼로그만 닫는다.
- **꼭 갈 곳 등록 실패.** 여행은 만들어졌는데 꼭 갈 곳 등록이 일부 실패하면 testID: `trip-wizard-mustvisit-banner`(실패 수를 센 문구)와 testID: `trip-wizard-mustvisit-banner-retry` 가 뜨고 2/4로 넘어가지 않는다. [다시 시도]는 남은 장소만 다시 등록한다(여행을 또 만들지 않는다).
- **이미 만든 여행 고치기.** 2/4에서 ‹ testID: `trip-base-back` 으로 1/4에 돌아와 박수·기간을 바꾸고 [다음]을 누른다. 2/4로 다시 가되 일정 탭의 여행은 하나 그대로이고 날짜만 바뀌어야 한다. 이때 취향 행을 누르면 시트 대신 토스트 testID: `trip-wizard-pref-locked-toast` 「이미 만든 여행은 취향을 바꿀 수 없어요」가 뜬다.
- **이탈 다이얼로그.** 이미 만든 여행 상태의 1/4에서 ‹ testID: `trip-wizard-step1-back`(라벨 「뒤로」)을 누르거나 가장자리 스와이프를 한다. testID: `trip-wizard-leave-dialog` 「여행 만들기를 그만둘까요?」/「저장하면 내 여행에 작성 중으로 남아요. 삭제하면 되돌릴 수 없어요.」가 뜬다. 「계속 작성」 testID: `trip-wizard-leave-stay` 는 닫기만, 「저장하고 나가기」 testID: `trip-wizard-leave-save` 는 서버 요청 없이 나가고(일정 탭에 여행이 남아야 한다), 「삭제하고 나가기」 testID: `trip-wizard-leave-delete` 는 여행을 지우고 나간다(일정 탭에서 사라져야 한다). 삭제 실패면 testID: `trip-wizard-leave-error` 「삭제하지 못했어요. 다시 시도해 주세요.」가 다이얼로그 안에 뜨고 다시 누를 수 있다.
- **여행 전 ‹.** 아직 [다음]을 안 눌렀으면 ‹는 다이얼로그 없이 바로 이전 화면으로 간다.
- **2/4 얼굴.** 조회 중이면 「거점을 불러오는 중」+ testID: `trip-base-skeleton-night-${index}`. 저장 숙소 0·배정 0이면 empty — 부제 「저장한 숙소가 없어요 · 밤마다 골라도 되고 나중에 정해도 돼요」, 밤 행 testID: `trip-base-empty-night-${n}`, [숙소 없이 계속] testID: `trip-base-nostay-start`, [숙소 둘러보기] testID: `trip-base-browse`(`/stays?region={첫 도시}`로 이동). 그 밖은 default — 밤 카드 testID: `trip-base-night-card-${n}` 에 「N번째 밤 · M/D(요일) · {지역}」과 「숙소 미정」, 안내 「숙소는 나중에 정해도 돼요 · 동선 기준으로 추천해 드려요」.
- **2/4 오류.** 저장 숙소·거점 조회가 실패하면 testID: `trip-base-error` 「지금 거점 정보를 불러올 수 없어요」/「잠시 후 다시 시도해 주세요」, [다시 시도] testID: `trip-base-error-retry`, [숙소 없이 시작하기] testID: `trip-base-error-nostay`.
- **2/4 notrip.** 딥링크로 `trips/new/step2` 를 바로 열면(만든 여행 없음) testID: `trip-base-notrip` 「여행 정보를 찾을 수 없어요」/「여행 만들기를 처음부터 다시 시작해 주세요」와 「처음부터」 testID: `trip-base-notrip-restart`(1/4 push)만 보인다.
- **2/4 출구.** default에서 주 CTA testID: `trip-base-generate` 는 배정이 하나라도 있으면 「이 거점으로 일정 만들기」, 없으면 「일정 만들기」다. 보조 「숙소 없이 시작하기」 testID: `trip-base-nostay-start`. 어느 것을 눌러도 3/4 방식 선택이 열리고, 3/4에서 뒤로는 1/4로 온다. 거점 지정(밤 카드 → 시트)은 `trip-bases.md` 의 손잡이를 그대로 쓴다.

## Gotchas

- 예산 행은 없다. 요약 카드는 여행지·기간·일과 시간·동행·취향 다섯 행뿐이다(옛 문서의 예산 서술은 낡았다).
- 진행 표시는 「N / 4」다. 3/4는 `itinerary/method`, 4/4는 생성 화면이다. 위저드 레이아웃은 2/4까지만 감싼다.
- 셸이 마운트될 때(새 진입) 만든 여행 id와 꼭 갈 곳 시드를 비운다. 대부분 입구는 그 전에 드래프트를 통째로 `reset` 한다. 단 도우미 `CREATE_TRIP` 은 reset 없이 replace만 해서, 직전 위저드의 여행지·기간·동행이 남은 채 열릴 수 있다(확인 필요).
- 기본 동행이 「혼자」라서 새 진입의 동행 행은 플레이스홀더가 아니라 「혼자」다. 「동행 선택」 플레이스홀더를 찾지 마라.
- empty 부제와 default 부제의 「바꿀 수 있어요」 사이 공백은 NBSP(U+00A0)다. 텍스트 완전 일치로 찾으면 실패할 수 있으니 부분 일치나 testID: `trip-wizard-step1-subtitle` 로 읽는다.
- [다음]은 담은 장소 조회가 끝날 때까지 꺼져 있다(로그인 계정). 비활성인지 보려면 접근성 disabled 상태를 읽는다 — 색은 연회색 채움이다.
- 국내 밖 차단 코드 `OVERSEAS_DESTINATION` 은 서버가 내지 않는 값이고, 지역 선택은 서울·부산·제주만 보여 준다. 실서버로는 사실상 못 띄운다 — `live-unreachable` 후보다. 「국내 도시 고르기」는 이름과 달리 여행지 시트를 열지 않는다(다이얼로그만 닫힘).
- 꼭 갈 곳 고르기 완료와 「이 장소들로 여행 만들기」는 1/4를 **새로 push**한다. 그래서 스택에 1/4가 둘 쌓이거나 1/4 밑에 담은 장소 화면이 남는다. 「저장하고 나가기」·‹ 가 위저드 밖이 아니라 담은 장소 화면으로 갈 수 있다(과거 QA 119 — 생성 뒤 뒤로 연타가 1/4·더 담기까지 되감김).
- 여행은 1/4 [다음]에서 이미 서버에 만들어진다. 2/4의 「숙소 없이 시작하기」나 이탈 다이얼로그 「저장하고 나가기」 뒤에 일정 탭에 작성중 여행이 남는 것은 정상이다. QA 뒤에 그 여행을 일정 탭에서 지워 정리한다.
- 2/4 「숙소 없이 시작하기」는 이미 지정한 거점을 지우지 않는다. 주 CTA와 같은 출구로 3/4로 간다.
- 2/4는 딥링크 notrip 말고는 첫 진입 경로가 1/4 [다음] 하나다. `trip-base-*` testID는 `trip-bases.md` 의 여행 단위 화면과 공유되니 어느 라우트에 있는지 앱바 진행 표시(위저드면 「2 / 4」)로 구분한다 — h04 입구의 여행 단위 화면도 「2 / 4」를 보이므로 직전 화면 기억이 유일한 구분이다.
- 위저드 라우트는 인증 가드 밖이다. 미인증 딥링크로 열려도 화면은 그려지고 [다음]만 401로 배너가 뜬다.
- 연타 가드가 있다(400ms). 시트가 닫힌 뒤 두 번째 탭이 아래 요소로 떨어지는 관통은 과거 QA에서 실측됐다 — 연타 검사는 `trippilot-sim-qa` 스킬 §3 연타 검사(`dt.sh`)를 따른다.
- [실화면 전용] 다섯 편집 시트와 숙소 선택 시트의 실제 열림·딤 덮임·끌어 닫기, 일과 시간 휠 드래그·스크롤 정지 값 확정, 이탈·국내 밖 다이얼로그의 딤 덮임·중앙 정렬·터치 차단은 실화면으로만 확인된다.
- [실화면 전용] 지역 선택에서 돌아온 뒤 여행지 시트가 여전히 열려 있는지, 셸이 실제로 다시 마운트되는지(꼭 갈 곳 고르기 완료·담은 장소 CTA 경로)는 실기로만 확인된다.
- 1/4 ‹는 만든 여행이 없으면 직전 화면으로만 간다 — 딥링크로 바로 열어 돌아갈 화면이 없으면 무반응일 수 있다(확인 필요). 이탈 다이얼로그 경로만 홈 폴백이 있다.
- [실화면] 2026-10-31 지역 선택에서 돌아오면 여행지 시트가 열린 채다(확인). 도시를 빼면 남은 행의 `seq` 가 1부터 다시 매겨진다 — 부산을 추가한 뒤 서울(row-1)을 빼면 부산이 `trip-wizard-destination-row-1` 이 된다. 0박 행의 − 라벨도 「{도시} 1박 줄이기」 그대로다(비활성).
- [실화면] 2026-10-31 일과 시간 시트의 휠 셀 testID(`trip-wizard-daywindow-wheel-h-{HH}`)는 접근성 트리에 안 잡혀 id 탭이 실패했다 — `role=button label="21"` 처럼 보이는 숫자 셀을 차례로 눌러 올린다. 당일치기의 `trip-wizard-daywindow-start-h-{HH}` 는 id 탭이 통했다. 취향 잠금 토스트는 트리에서 문구 노드와 `trip-wizard-pref-locked-toast-success-icon` 으로 보인다.
- [실화면] 2026-10-31 「저장하고 나가기」가 담은 장소 고르기 화면으로 떨어지고, 그 밑의 옛 1/4에서 ‹ 를 누르면 이탈 다이얼로그가 **한 번 더** 뜬다(위 과거 QA 119 계열 재현 — 지도 기대대로).
- [결함 의심 FM-L2-01] 이미 만든 여행을 1/4에서 고쳐(기간 11/16→11/17) [다음]으로 PATCH가 성공해도(2/4 밤 카드는 11/17) 일정 탭 카드는 옛 날짜 「11월 16일 ~ 17일」로 남는다. 앱을 재시작해야 「11월 17일 ~ 18일」로 바뀐다 — 목록 캐시 무효화 누락 추정.
- [실화면] 2026-10-31 도달 불가 — `step1-submit-fail`(저장 실패 배너·국내 밖 다이얼로그·꼭 갈 곳 등록 실패 배너)·이탈 다이얼로그 삭제 실패·2/4 loading/empty/error 얼굴: 시뮬 네트워크 차단 수단이 없고(Metro와 같은 망) 계정에 저장 숙소가 있다. 1/4 loading 얼굴은 순간 상태라 캡처 못 했다. 입구 중 일정 탭 빈 상태·기록 탭 빈 상태는 여행이 있는 계정이라, 도우미 `CREATE_TRIP` 은 이번 묶음에서 시도하지 않았다(AI 응답 비결정). 장소 탐색 FAB은 `com.trippilot.travel://explore/places` 로 연 화면에서 눌렀다.
