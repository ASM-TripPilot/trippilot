---
id: stay-register
band: e
status: live-verified
live_verified_at: 2026-11-02 (f153fe245)
routes:
  - app/stays/register.tsx
  - app/my/stays.tsx
---

# 숙소 직접 등록 (e05) · 마이 등록 숙소 (l04)

사용자는 이미 예약한 숙소를 앱에 직접 등록한다. 「지도 검색」 탭에서 숙소명·주소로 검색해 후보를 고르거나, 「핀 지정」 탭에서 지도를 움직여 가운데 핀으로 위치를 맞춘 뒤 숙소명을 적고 등록한다. 등록에 성공하면 들어온 화면으로 돌아가 「숙소를 등록했어요」 토스트가 뜬다. 등록·저장한 숙소는 마이 → 「등록 숙소」(Figma l04)에서 출처·날짜·연결 여행과 함께 보이고, 거점으로 쓰이는 숙소에선 「거점 변경」으로 그 여행의 거점 화면에 간다. 링크 붙여넣기 탭은 없다.

## Sub-features

- `register-mapsearch` 「지도 검색」 탭: 미리보기 지도 + 「숙소 검색」 입력(「숙소명 · 주소」) + [검색]. 검색은 검색 키나 [검색]을 눌렀을 때만 나간다.
- `register-search-loading` 후보 스켈레톤 2줄.
- `register-search-empty` 「검색 결과가 없어요」.
- `register-search-multi` 후보 2개 이상이면 「여러 숙소가 검색됐어요. 정확한 곳을 선택해 주세요」 + 라디오 후보 목록.
- `register-search-pick` 후보를 고르면 좌표가 바로 확정되고 선택 숙소 카드가 얹히며 버튼이 「이 숙소 등록」이 된다.
- `register-search-fail` 지오코딩 실패면 지도·검색이 빠지고 「지도 검색을 사용할 수 없어요」 / 「핀으로 직접 지정해 주세요」 + [다시 시도] + [핀으로 직접 지정] + 「숙소명」 입력.
- `register-map-pin` 지도 검색 탭 미리보기 지도와 지도 시트는 고른 후보 좌표를 가운데로 옮기고 그 자리에 숙소(침대) 마커 하나를 찍는다. 고르기 전에는 기본 위치(서울시청)이고 마커가 없다. *(2026-11-01 B안으로 실화면 전용)*
- `register-pin` 「핀 지정」 탭: 가운데 고정 핀 지도 + 안내 「지도를 움직여 핀을 원하는 위치에 맞춰 주세요」 + 역지오코딩 주소(없으면 「주소 미확인」) + 「숙소명」 입력.
- `register-pin-address-fail` 역지오코딩 장애면 「주소 미확인 — 숙소명을 직접 입력해 주세요」(등록은 막지 않는다).
- `register-coord-confirm` 좌표 미확정이면 「지도에서 위치를 확인해 주세요」 안내, 좌표가 있으면 [지도에서 위치 확인] → 지도 시트 [이 위치로 확인](지도 키 없으면 「지도를 불러오지 못했어요」 + [이 주소로 확인]).
- `register-name-missing` 이름이 비고 후보 이름도 없을 때 [등록하기]를 누르면 「등록하려면 숙소명을 입력해 주세요」.
- `register-submit` [등록하기]/[이 숙소 등록] → 「등록 중…」 → 성공 시 뒤로 + 토스트, 실패 시 「등록에 실패했어요」 + [다시 시도].
- `my-stays-list` 마이 → 「등록 숙소」: 숙소마다 이름·날짜 칩(`M.D ~ M.D`)·출처 칩(「예약 사이트」/「탐색에서 저장」/「직접 등록」)·「예약번호 미입력」 칩·연결 여행(`연결 여행 · {여행 이름}` 또는 「연결된 여행 없음」)·「거점」 배지.
- `my-stays-change-base` 거점으로 쓰이는 행의 「거점 변경」 → 그 여행의 거점 화면(편집 모드)으로 push. 좌표 미확정 숙소면 잠긴다. 거점이 아닌 행엔 버튼이 없다.
- `my-stays-empty` 「숙소를 탐색하고 등록하면\n일정을 만들 수 있어요」 + [숙소 탐색] → 숙소 검색.

## How to get to it (user POV)

- 숙소 검색 결과(e02) 우하단 분홍 ＋ FAB(testID: `stay-search-fab-register`, 라벨 「숙소 등록」).
- 숙소 검색 결과 빈 상태의 「이미 예약한 숙소가 있나요?」 카드(testID: `stay-search-register`)와 조회 실패의 [숙소 직접 등록](testID: `stay-search-error-register`).
- 저장한 숙소(e04) 목록 아래 [숙소 직접 등록](testID: `saved-stay-register`).
- 딥링크 `com.trippilot.travel://stays/register`(`trippilot://` 스킴은 실화면에서 라우팅되지 않는다).
- 등록 숙소 목록: 마이 탭 메뉴 「등록 숙소」 행(testID: `my-stays-row`) → `/my/stays`.
- 등록 숙소 목록: 알림함에서 `STAY_DETAIL` 알림(`savedStayId` 있음) 탭 → `/my/stays`. 같은 사영을 푸시 알림 탭 라우팅도 쓴다.
- 등록 숙소 목록: 여행 거점 화면(편집 모드)을 딥링크로 열어 뒤로 갈 곳이 없을 때의 폴백(뒤로가 등록 숙소 목록으로 간다).
- 딥링크 `com.trippilot.travel://my/stays`.

## Driving it with agent-device

Preconditions:

- 소셜 로그인 완료. dev-api `GET /stays/geocode?q=`가 후보를 돌려주는 검색어 하나(예: 실재 호텔 이름)와 0건이 되는 검색어 하나.
- 지도 확인 시트의 지도 얼굴은 `EXPO_PUBLIC_NAVER_MAP_CLIENT_ID`가 빌드에 있어야 뜬다. 없으면 「지도를 불러오지 못했어요」 얼굴이다.
- 「거점 변경」을 보려면 어떤 여행의 거점으로 지정된 저장 숙소가 있어야 한다.
- 이 기능은 서버 데이터를 만든다 — 테스트용 이름(예: `QA 등록 숙소`)을 쓰고, 끝나면 저장한 숙소(e04) 하트로 지운다.

- **진입.** 숙소 검색 결과에서 testID: `stay-search-fab-register`를 누른다. testID: `stay-register-root`, 제목 「숙소 등록」, 뒤로 testID: `stay-register-back`(라벨 「뒤로 가기」), 세그먼트 testID: `stay-register-tab-mapsearch`(「지도 검색」, 선택)·testID: `stay-register-tab-pin`(「핀 지정」)이 보인다.
- **첫 화면 상태.** 지도 미리보기 testID: `stay-register-map-preview`, 입력 testID: `stay-register-search-input`, [검색] testID: `stay-register-search-submit`(입력이 비면 disabled), 안내 testID: `stay-register-coordnotice` 「지도에서 위치를 확인해 주세요」, 버튼 testID: `stay-register-submit` 「등록하기」(disabled)가 보인다.
- **검색.** 입력에 검색어를 `fill`하고 [검색]을 누른다. 잠깐 testID: `stay-register-candidate-skeleton-0`·testID: `stay-register-candidate-skeleton-1`이 보이고, 후보가 testID: `stay-register-candidate-0`부터 라디오 행으로 뜬다. 2개 이상이면 testID: `stay-register-candidate-hint` 「여러 숙소가 검색됐어요. 정확한 곳을 선택해 주세요」가 위에 붙는다. 타이핑만으로는 요청이 나가지 않는다.
- **0건.** 없는 검색어로 검색한다. testID: `stay-register-candidate-empty` 「검색 결과가 없어요」.
- **후보 선택.** testID: `stay-register-candidate-0`을 누른다. 그 행이 checked가 되고 testID: `stay-register-selected-card`(이름·주소)가 얹히며, 안내 testID: `stay-register-coordnotice`가 사라지고, 버튼이 enabled 「이 숙소 등록」이 된다. testID: `stay-register-mapconfirm` 「지도에서 위치 확인」도 보인다.
- **재검색 초기화.** 후보를 고른 뒤 다른 검색어로 다시 검색한다. 선택·확정이 풀리고 버튼이 「등록하기」 disabled로 돌아간다.
- **지도 확인 시트.** testID: `stay-register-mapconfirm`을 누른다. testID: `stay-register-mapsheet`가 열리고 인라인 지도는 숨는다. 지도 키가 있으면 [이 위치로 확인], 없으면 「지도를 불러오지 못했어요」 + 후보 이름·주소 + [이 주소로 확인] — 둘 다 testID: `stay-register-mapsheet-confirm`이다. 누르면 시트가 닫히고 좌표가 확정된다. testID: `stay-register-mapsheet-close` 「닫기」는 확정 없이 닫는다.
- **등록 성공.** testID: `stay-register-submit`을 누른다. 잠깐 「등록 중…」 뒤 들어온 화면으로 돌아가고 토스트 testID: `stay-register-saved` 「숙소를 등록했어요」가 뜬다. 저장한 숙소(e04)와 마이 → 등록 숙소에서 그 이름(출처 칩 「직접 등록」)을 다시 확인한다.
- **등록 실패.** 네트워크를 끊고 [이 숙소 등록]을 누른다. testID: `stay-register-submitfail` 「등록에 실패했어요」와 testID: `stay-register-submitfail-retry` [다시 시도]가 뜬다. 입력·선택은 그대로 남는다.
- **검색 장애.** 지오코딩이 실패하는 상태(네트워크 끊김)에서 검색한다. testID: `stay-register-searchfail` 「지도 검색을 사용할 수 없어요」 / 「핀으로 직접 지정해 주세요」, testID: `stay-register-searchfail-retry` [다시 시도], testID: `stay-register-pinfallback` [핀으로 직접 지정], 숙소명 입력 testID: `stay-register-name-input`이 보인다. [핀으로 직접 지정]을 누르면 「핀 지정」 탭으로 바뀐다.
- **핀 지정.** testID: `stay-register-tab-pin`을 누른다. testID: `stay-register-pin-panel` 안에 지도 testID: `stay-register-pin-map`(가운데 핀 testID: `map-center-pin`)과 안내 testID: `stay-register-pin-hint` 「지도를 움직여 핀을 원하는 위치에 맞춰 주세요」가 뜬다. 지도를 끌어 멈추면 안내가 사라지고 testID: `stay-register-pin-address`에 주소(없으면 「주소 미확인」)가 뜬다. 역지오코딩 장애면 testID: `stay-register-pin-addressfail` 「주소 미확인 — 숙소명을 직접 입력해 주세요」.
- **핀 확정·등록.** 핀 좌표는 미확정이라 testID: `stay-register-coordnotice`가 남고 [지도에서 위치 확인]이 보인다. 시트에서 확정한 뒤 testID: `stay-register-name-input`에 이름을 넣고 「이 숙소 등록」을 누른다.
- **이름 누락.** 핀으로 좌표를 확정하고 이름을 비운 채 [이 숙소 등록]을 누른다. 요청 없이 testID: `stay-register-name-missing` 「등록하려면 숙소명을 입력해 주세요」가 버튼 위에 뜬다.
- **등록 숙소 목록.** 마이 탭에서 testID: `my-stays-row`(「등록 숙소」)를 누른다. 제목 「등록 숙소」, 뒤로 testID: `my-stays-back`(라벨 「뒤로」), 행 testID: `my-stays-row-{savedStayId}`가 보인다. 출처 칩은 OTA 사전 코드면 「예약 사이트」, 그 밖 출처면 「탐색에서 저장」, 출처 없으면 「직접 등록」이다.
- **거점 변경.** 「거점」 배지가 있는 행의 testID: `my-stays-base-toggle-{savedStayId}` 「거점 변경」을 누른다. 그 여행의 거점 화면(`/trips/{tripId}/bases?mode=edit`)이 열리고, 뒤로 가면 이 목록으로 돌아온다. 거점이 아닌 행엔 이 버튼이 없다.
- **등록 숙소 빈 상태.** 저장·등록 숙소가 0곳인 계정에서 연다. testID: `my-stays-empty-icon`과 「숙소를 탐색하고 등록하면 / 일정을 만들 수 있어요」, testID: `my-stays-explore` [숙소 탐색] → testID: `stay-search-root`.

## Gotchas

- 등록 숙소 목록(l04)에는 로딩 얼굴이 없다(응답 전 빈 화면). 저장 숙소·여행 조회가 실패하면(받아 둔 목록이 없을 때) testID: `my-stays-error` 「등록 숙소를 불러올 수 없어요」/「잠시 후 다시 시도해 주세요」 + testID: `my-stays-retry` [다시 시도]가 뜬다(2026-11-02 실패 주입 `/saved-stays` 500 으로 확인). 받아 둔 목록이 있으면 재조회 실패에도 목록을 유지한다.
- 마이 메뉴 행 testID testID: `my-stays-row`는 등록 숙소 행 접두 testID: `my-stays-row-{id}`와 앞부분이 같다. 정확히 일치하는 id로 누른다.
- 「거점 변경」 행은 첫 여행 기준이다 — 한 숙소가 여러 여행의 거점이면 목록상 먼저 나온 여행만 보인다.
- 이 기능은 서버에 저장 숙소를 만든다. 지우지 않으면 저장한 숙소(e04)·여행 위저드 거점 후보에 계속 남는다. 거점으로 지정한 뒤엔 409로 해제가 막힌다.
- 지도 검색 탭에서 후보를 고르면 시트 확인 없이 바로 등록 가능하다. [지도에서 위치 확인]은 선택 수단이다. 반대로 핀 경로는 시트 확인 없이는 버튼이 열리지 않는다.
- 후보 2개 이상 + 미확정 상태에서 testID: `stay-register-coordnotice`가 함께 보이는 것은 Figma와 다르지만 의도된 동작이다(traps-stay 「e05」).
- 지도 검색 중 「지도 검색을 사용할 수 없어요」는 지오코딩 조회 실패면 원인과 무관하게 뜬다. 빈 검색어로는 요청이 나가지 않는다.
- [실화면 전용] 가운데 고정 핀 지도·미리보기 지도·시트 안 지도는 네이버 네이티브 SDK다. 지도를 끌어 멈추는 동작과 역지오코딩 주소 갱신은 실화면으로만 확인된다. 지도 화면은 접근성 캡처가 워치독 타임아웃날 수 있어 스크린샷+좌표가 필요할 수 있다(sim-qa §2).
- [실화면 전용] 지도 확인 시트(testID: `stay-register-mapsheet`)는 배경막을 눌러도 닫히지 않게 되어 있다 — 닫기는 [닫기]·[확인]뿐이다. 실제 열림·배경막은 실화면으로만 확인된다.
- [실화면 전용] 지도 확인 시트는 다른 시트와 달리 접근성 묶음을 풀지 않는다. 시트 안 [닫기]·[이 위치로 확인]은 2026-10-31 실화면에서 접근성 트리에 개별 버튼으로 잡혔다(testID 로 눌림).
- 핀 패널은 「핀 지정」 탭에서만 그려지고, 첫 지도 멈춤이 바로 좌표를 채운다. 그래서 이름 누락 안내는 [등록하기]를 누른 뒤에만 뜬다.
- 키보드가 떠 있으면 첫 탭은 키보드 닫기에 쓰일 수 있다(sim-qa §2). [검색]을 눌러도 키보드가 안 내려가 후보가 가려질 수 있다(2026-10-21 QA N-017).
- 2026-10-16 QA 시점 "📍 지도에서 핀 위치를 확인하세요" 캡션은 지워졌다. 그 문구를 찾지 마라.
- 링크 붙여넣기 탭은 계약이 없어 그리지 않는다 — 세그먼트는 두 칸이다.
- [결함 의심 FM-L1-06] 지도 검색 후 키보드가 내려가지 않은 채(N-017) [지도에서 위치 확인]을 누르면 지도 확인 시트의 [이 위치로 확인]·[닫기]가 키보드 아래 깔려 누를 수 없다 — 탭이 키보드에 들어가고 [이 숙소 등록]도 딤에 막힌다. 키보드를 내리는 수단은 키보드 「검색」 키뿐인데 그러면 재검색으로 선택이 풀린다(후보를 다시 고르면 키보드 없이 진행된다).
- [실화면] 2026-10-31 도달 불가 — `register-search-loading`(순간 상태)·`register-search-fail`·`register-pin-address-fail`·`register-submit` 실패 얼굴(네트워크 차단 수단 없음)·`my-stays-empty`(계정에 저장 숙소 3곳). 등록 숙소 행의 날짜 칩·「예약번호 미입력」 칩은 계정 데이터에 해당 값이 없어 못 봤다.
- [실화면] 2026-10-31 지도 확인 시트로 확정하면 인라인 지도가 다시 그려진다. 등록 성공 토스트는 저장한 숙소(e04)로 돌아온 화면 하단에 뜬다.
