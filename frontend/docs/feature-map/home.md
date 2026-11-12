---
id: home
band: a
status: live-verified
live_verified_at: 2026-11-02 (f153fe245)
routes:
  - app/(tabs)/index.tsx
---

# 홈

로그인한 사용자가 처음 닿는 탭이다. 여행 목록(`GET /trips`)을 읽어 얼굴을 셋 중 하나로 고른다 — 진행 중(ENDED 아님) 여행이 없으면 **발견(여행 없음)**, 있으면 가장 이른 여행을 지배 여행으로 삼아 **계획 중(D-N)** 또는 오늘이 여행 기간 안이면 **여행 중(N일차)**, 진행 중 여행이 없고 가장 최근에 끝난 여행이 종료 0~7일 안이면 **여행 후**. 어느 얼굴이든 인사 헤더의 ✦ 도우미·종(알림), 가짜 검색바(지역 선택으로 이동), 서울·부산·제주 도시 카드 캐러셀, 서버 장소로 채운 장소 레인, 우하단 담은 곳(♥)·여행 만들기(＋) FAB 이 있다. 계획 중·여행 중·여행 후는 캐러셀 첫 장이 여행 카드이고 그 CTA 가 일정·기록 화면으로 보낸다.

## Sub-features

- `home-discovery` 진행 중 여행 0건(또는 여행 후 창 밖) — 인사 「오늘은 어디를 상상해볼까요」 + 도시 카드 3장 캐러셀 + 「요즘 사람들이 담는 곳」 + 「지금 뜨는 장소」 2×2.
- `home-planning` 지배 여행이 미래 — 인사 `{여행 제목} D-{n}` + 「일정을 이어서 짜볼까요」, 여행 카드 배지 「계획 중」·`· D-{n}`, 본문은 「요즘 사람들이 담는 곳」 한 섹션뿐.
- `home-traveling` 오늘이 지배 여행 기간 안 — 인사 `{여행 제목} {N}일차예요`, 배지 「여행 중」·`· {N}일차`, 본문에 「지금 뜨는 장소」(여행 첫 목적지 지역 장소)가 더 붙는다.
- `home-post-trip` 진행 중 0건 ∧ 최근 종료 0~7일 — 인사 `{여행 제목} 잘 다녀오셨어요?` + 「기록을 정리하고 나눠볼까요」, 배지 「여행 완료」, CTA 「회고 보기」, 「지난 여행」(나머지 ENDED가 있을 때만)·「다음엔 여기 어때요」.
- `home-trip-cta` 여행 카드·CTA 알약 press → 일정 상태별 목적지로 push(라벨이 목적지를 따라 바뀐다).
- `home-hero-city` 도시 카드 press → 그 시도 코드로 거른 탐색 탭.
- `home-search` 검색바 press → 지역 선택(purpose=explore).
- `home-bell` 종 press → 알림함.
- `home-bell-unread` 종 오른쪽 위에 읽지 않은 알림 개수 배지(testID: `home-dashboard-bell-badge`) — 1~99는 숫자 그대로, 100 이상은 「99+」, 0건·아직 못 받음·조회 실패면 배지가 없다(이미 숫자를 받은 뒤 다시 세기만 실패하면 직전 숫자가 남는다). 종의 낭독 이름은 0건이면 「알림」, 1~99건이면 「알림, 읽지 않은 알림 N개」, 100건 이상이면 「알림, 읽지 않은 알림 99개 이상」이다. 모든 홈 얼굴 공통이고, 홈을 처음 열 때·앱을 내렸다 30초 넘겨 돌아왔을 때·알림함에서 읽음 처리했을 때·푸시를 받았을 때 다시 센다(탭만 오가서는 다시 세지 않는다). 프리뷰 `home-bell-unread`(3건)·`home-bell-unread-99`(100건). **[실화면 전용 — 미확인]** 배지 모양·위치, 알림함에서 읽고 돌아왔을 때 숫자가 곧바로 줄어드는지, VoiceOver 1회 낭독 — Gotchas. *(TRIP-1783 · 2026-11-09 프리뷰 캡처만)*
- `home-assistant` ✦ press → AI 도우미 시트(계획 중·여행 중이면 그 여행 문맥).
- `home-spots` 「지금 뜨는 장소」 카드 press → 장소 상세, ♥ 담기/해제, 「더 보기」 → 장소 탐색.
- `home-collections` 「요즘 사람들이 담는 곳」 카드 press → 장소 상세(3장을 못 채우면 섹션 통째 숨김).
- `home-saved-menu` ♥ FAB → 미니 FAB 「담은 장소」(배지)·「저장한 숙소」(배지) 펼침, 딤 탭으로 닫힘.
- `home-create-trip` ＋ FAB → 여행 만들기 위저드 1/4(직전 드래프트 초기화).
- `home-past-trips-more` 여행 후 「전체 보기」 → 기록 탭.
- `home-loading` 여행 조회 중 — 히어로 통짜 스켈레톤·섹션 스켈레톤, FAB 두 개 미렌더.
- `home-trips-error` 여행 조회 실패(캐시 없음) — 발견 얼굴 위에 「여행 정보를 불러오지 못했어요」 + 「다시 시도」.
- `home-trips-offline` 오프라인 콜드스타트(받은 여행 없음) — 「인터넷에 연결되어 있지 않아요」/「연결되면 자동으로 불러올게요」(버튼 없음), 장소 레인은 숨는다. 연결되면 저절로 얼굴이 정해진다.
- `home-lane-error` 장소 조회 실패 — 섹션 자리에 「장소를 불러오지 못했어요 · 다시 시도」(누르면 재조회).
- `home-spot-save-error` ♥ 실패 — 섹션 위 안내 행(누르면 닫힘).
- `home-fab-scroll-hide` 세로 스크롤 중 FAB 묶음이 투명·터치 불가가 되고 멈춘 뒤 250ms에 돌아온다(메뉴가 열려 있으면 유지). 가로로 도시 카드 캐러셀을 밀 때는 안 숨고(컬렉션 가로 줄은 미확인), 스크롤하는 동안·멈춘 뒤 앱이 죽지 않는다. *(2026-11-03 실화면 pass — TRIP-1733 스크롤 처리 이관 뒤)*
- `home-look` 스팟·컬렉션 카드 사진 칸은 서버 사진(없으면 카테고리 생성 그림), 여행 카드 배경은 그 여행 지역 그림(없으면 도시 그림을 대신 깔지 않는다), 카드 위엔 장식 하트가 없고, 토스트는 FAB 묶음 위에 떠서 가려지지 않는다. *(2026-11-01 B안으로 실화면 전용)*
- `home-photo-credit` 스팟·컬렉션 카드의 서버 사진도 같은 규칙이다 — 관광공사 3유형·유형 모름 사진은 자르지 않고 **어두운 여백** 위에 전체가 보이며, 1유형만 카드를 꽉 채운다. 서버 사진 우하단에 「사진: 한국관광공사」 칩이 붙고 카테고리 그림 카드엔 없다. 칩이 카드 아래쪽 어두운 막·흰 제목·뱃지와 겹치지 않아야 한다. *(TRIP-1740 · 2026-11-08 프리뷰 캡처는 카드 윗부분까지만 봄 · 칩이 붙는 아랫부분은 실화면 미확인 — Gotchas)*
- `home-cover-label` 여행 카드에 첫 목적지와 다른 시도의 그림을 고른 여행이면 CTA 줄 오른쪽(카드 오른쪽 아래)에 어두운 알약 「그림 · 해운대」(testID: `home-trip-hero-cover-label`)가 보이고 CTA·도트와 겹치지 않는다. 이름이 없는 여행은 알약이 없고 CTA 는 왼쪽 정렬·같은 크기다. 계획 중·여행 후 **[실화면 프리뷰]** *(TRIP-1806 · 2026-11-07 프리뷰 `home-planning-cover-label`·`home-post-trip-cover-label`·`home-planning`, 값은 jest)* 여행 중은 같은 컴포넌트라 따로 안 찍었다 **[실화면 전용 — 미확인]**. 큰 글자는 `my-trips.md` `mytrips-cover-label-legibility`.
- `home-lane-fresh-10min` 홈 장소 레인을 본 뒤 30초~10분 안에 탐색 탭을 처음 열어도 `GET /places` 가 안 나간다(TRIP-1713, 여행 없음 얼굴 — 3지역 키 공유). 실기 미검증: TRIP-1714 6-b 계정이 여행 중 얼굴이라 못 봤다.

## How to get to it (user POV)

- 앱 실행 → 스플래시 → 로그인·온보딩이 끝난 계정이면 `(tabs)` 첫 화면으로 착지한다(가드 목적지 HOME일 때만 `(tabs)`가 열린다).
- 아무 탭에서 하단 탭바 「홈」(`shell-tabbar-tab-home`) — tab-bar.md.
- `(tabs)` 밖 화면의 복제 탭바 「홈」(장소 탐색 d04 등)은 쌓인 화면을 걷고 홈 탭으로 돌아온다.
- 장소 상세를 딥링크로 열어 히스토리 없이 뒤로를 누르면 홈 탭으로 떨어진다 — explore-places.md.
- 딥링크 `trippilot:///` (로그인 상태에서만 홈; 미인증이면 가드가 로그인으로 보낸다).
- 다른 기능에서 홈으로 돌아오는 경로(위저드 이탈·회고 완료 등)는 각 기능 파일 소관 — 여기서 확인 필요로 남긴다.

## Driving it with agent-device

Preconditions:

- 로그인 완료 계정(가드 HOME). 얼굴을 고르려면 계정 여행 상태를 맞춘다: 발견 = 비-ENDED 여행 0건 ∧ 최근 종료가 8일 이상 전(또는 여행 0건) / 계획 중 = 시작일이 미래인 비-ENDED 여행 / 여행 중 = 오늘(KST)이 시작~종료일 안 / 여행 후 = 비-ENDED 0건 ∧ 최근 종료일이 오늘로부터 0~7일. 얼굴은 가장 이른 시작일의 비-ENDED 여행 하나로만 정해진다.
- 여행 카드 CTA 목적지는 목록(`GET /trips`)의 지배 여행 일정 상태 칸으로 첫 프레임부터 정해진다(TRIP-1677). 같이 짜기 생성 중일 때만 누르는 순간 일정 조회가 한 번 나간다.
- 장소 레인은 서버 장소가 있어야 그려진다(발견·계획 중·여행 후 = 서울·부산·제주 3지역 각 200곳, 여행 중 = 여행 첫 목적지 지역 200곳).
- 서버를 못 맞추는 얼굴(여행 후·조회 실패·로딩)은 프리뷰 `trippilot:///_dev/preview?state=home-post-trip`·`home-trips-error`·`home-trips-offline`·`home-loading`·`home-planning`·`home-traveling`·`home-saved-menu` 로 본다 — 실서버 증명과 섞지 않는다.

- **루트 확인.** 홈 탭을 연다. `home-dashboard-root` 와 인사 `home-greeting` 이 보인다.
- **발견 얼굴.** 여행 없는 계정. `home-greeting` 안에 「오늘은 어디를 상상해볼까요」·「떠나지 않아도, 구경하고 모으는 즐거움」, 검색바 `home-search-bar` 에 「가고 싶은 도시를 검색해보세요」, 첫 도시 카드 testID: `home-magazine-hero` (「서울 · 남산과 한옥」), 나머지는 testID: `home-hero-slide-${i}`, 페이지 컨테이너 testID: `home-hero-page-${i}`, 도트 testID: `home-hero-dot-${i}`.
- **계획 중 얼굴.** 미래 여행이 있는 계정. 인사가 `{제목} D-{n}` + 「일정을 이어서 짜볼까요」, 캐러셀 첫 장 testID: `home-trip-hero` 안 배지 testID: `home-trip-hero-badge` 가 「계획 중」 + `· D-{n}`, 도시 카드는 testID: `home-hero-slide-${i + 1}`. 「지금 뜨는 장소」 섹션은 없다.
- **여행 중 얼굴.** 오늘이 여행 기간 안인 계정. 인사 `{제목} {N}일차예요`, 배지 「여행 중」·`· {N}일차`, 「지금 뜨는 장소」가 컬렉션 아래에 붙는다.
- **여행 카드 CTA.** testID: `home-trip-hero-cta` 를 누른다(카드 본체 `home-trip-hero` 도 같은 동작). 일정 상태별 push 목적지·라벨: 일정 없음 → 「일정 만들기」 → `/trips/{id}/itinerary/method` · 생성 중 → `/trips/{id}/itinerary/generating` · 초안 → `/trips/{id}/itinerary/draft` · 같이 짜기 → `/trips/{id}/itinerary/copick/...` (이 넷은 「일정 이어서 짜기」) · 확정 → 「확정 일정 보기」(여행 중이면 「여행 일정 보기」) → `/trips/{id}/live`. 일정 조회 중엔 눌러도 아무 일도 없다.
- **여행 후 얼굴.** 인사 `{제목} 잘 다녀오셨어요?`·「기록을 정리하고 나눠볼까요」, 배지 「여행 완료」(초록), CTA 「회고 보기」 → `/trips/{id}/records`. 지난 ENDED 여행이 더 있으면 「지난 여행」 카드 testID: `home-past-trip-card-${index}` 와 「전체 보기」 `home-past-trips-more` → `/records`. 추천 섹션 제목 「다음엔 여기 어때요」.
- **도시 카드.** 도시 카드 `home-magazine-hero`(또는 `home-hero-slide-${i}`)를 누른다. 탐색 탭으로 바뀌고 검색바에 지역 칩 `explore-region-chip` 이 붙는다(서울 11·부산 26·제주 50) — explore-destination.md.
- **검색바.** `home-search-bar` 를 누른다. 「여행지 선택」 앱바의 지역 선택 화면이 열린다(`/explore/region?purpose=explore`) — explore-destination.md.
- **종.** testID: `home-dashboard-bell`(역할 버튼)를 누른다. 알림함(`/notifications`)이 열린다. 접근성 이름은 읽지 않은 알림이 없으면 「알림」, 있으면 「알림, 읽지 않은 알림 N개」(100건 이상은 「…99개 이상」)라서 이름 「알림」 완전일치로 잡는 도구는 미읽음이 있는 계정에서 종을 못 찾는다 — testID 로 잡는다.
- **종 미읽음 배지.** 알림함에 읽지 않은 알림이 있는 계정으로 홈을 연다. 종(`home-dashboard-bell`) 안에 testID: `home-dashboard-bell-badge` 가 있고 글자가 읽지 않은 개수와 같다(100건 이상이면 「99+」). 읽지 않은 알림이 없는 계정(또는 알림 0건)이면 배지 요소 자체가 없다. 알림함(`/notifications`)에서 행 하나를 눌러 읽고 뒤로 오면 숫자가 1 줄고, 「모두 읽음」을 누르고 뒤로 오면 배지가 사라진다 — 읽음 처리는 되돌릴 수 없으니 notifications.md 의 미읽음 점 검증을 먼저 끝낸 뒤 한다. 이 "뒤로 온 직후" 판독이 이 줄의 핵심이다(Gotchas 의 TRIP-1783 줄). 목록 조회를 실패시키면(`_dev/fault?path=/me/notifications&status=500` 뒤 리로드 — 알림함 오류 얼굴을 연 방식과 같다) 배지가 없고 종은 그대로 눌려 알림함으로 간다 *(이 줄은 아직 밟지 않음)*. 프리뷰 `trippilot:///_dev/preview?state=home-bell-unread`(3)·`home-bell-unread-99`(100)는 배지 글자·유무만 본다 — 서버 숫자 증명이 아니다.
- **도우미.** testID: `home-dashboard-assistant`(라벨 「AI 도우미」)를 누른다. `/assistant?surface=HOME`(계획 중·여행 중이면 `tripId` 추가) 시트가 뜬다.
- **지금 뜨는 장소.** 카드 testID: `home-spot-card-${index}`(라벨 `{이름}, #{태그}`)를 누르면 장소 상세 `/explore/places/{poiId}`. 하트 testID: `home-spot-save-${poiId}`(라벨 `{이름} 저장`)를 누르면 담김 — `accessibilityState.selected` 가 true 로, 글리프가 testID: `home-spot-heart-filled-${poiId}` 로 바뀐다. 결과는 담은 장소(saved-places.md)에서 한 번 더 읽는다. 「더 보기」 testID: `home-spots-more` → 장소 탐색 `/explore/places`.
- **요즘 사람들이 담는 곳.** 카드 testID: `home-collection-card-${index}` 를 누르면 장소 상세. 이 섹션엔 「더 보기」가 없다.
- **출처 칩.** 서버 사진이 있는 카드는 사진 testID: `home-spot-photo-${index}`·`home-collection-photo-${index}` 옆에 testID: `home-spot-photo-${index}-credit`·`home-collection-photo-${index}-credit`(「사진: 한국관광공사」)가 있다. 카테고리 그림 카드엔 없다. 칩 아랫부분이 보이도록 카드를 화면 안으로 스크롤해 어두운 막·제목·뱃지와 겹치는지 스크린샷으로 본다.
- **담은 곳 메뉴.** testID: `home-saved-menu-toggle`(라벨 「담은 곳」)를 누른다. 라벨이 「담은 곳 메뉴 닫기」로 바뀌고 딤 testID: `home-saved-menu-backdrop`, 미니 FAB testID: `home-saved-places-fab`(「담은 장소」)·`home-saved-stays-fab`(「저장한 숙소」)이 뜬다. 개수 ≥1 이면 배지 testID: `home-saved-places-badge`·`home-saved-stays-badge`(100 이상은 「99+」). 「담은 장소」 → `/explore/saved-places`, 「저장한 숙소」 → `/stays/saved`, 딤 탭 → 닫힘.
- **여행 만들기.** testID: `home-create-trip-fab`(라벨 「여행 만들기」)를 누른다. `/trips/new/step1` 이 빈 드래프트로 열린다.
- **로딩.** 여행 조회 대기 중 testID: `home-hero-skeleton`·`home-collections-skeleton`·`home-spots-skeleton` 이 보이고 `home-fab-layer` 가 없다.
- **여행 조회 실패.** 실패 주입 `_dev/fault?path=/trips&status=500` 뒤 리로드(네트워크를 끊고 콜드 스타트하면 실패가 아니라 오프라인 얼굴 `home-trips-offline` 이 뜬다). 오프라인 판정은 NetInfo `isConnected` 가 묶인 react-query `onlineManager` 이고 받아 둔 데이터가 없을 때만이다 — 시뮬에서 `nav.mjs --eval` 로 `onlineManager.setOnline(false)` 를 리로드 직후에 걸어 봤지만(2026-11-02) 첫 조회가 이미 나가 있어 오프라인 얼굴은 못 열었다. 프리뷰 키로 본다. 실패 얼굴은 testID: `home-trips-error` 에 「여행 정보를 불러오지 못했어요」, testID: `home-trips-retry` 「다시 시도」(재조회 중 비활성). 나머지는 발견 얼굴로 그려진다.
- **장소 레인 실패.** testID: `home-collections-error`·`home-spots-error` 에 「장소를 불러오지 못했어요 · 다시 시도」, 누르면 재조회.
- **담기 실패.** ♥ 실패 시 testID: `home-spot-save-error` 에 안내(예 「연결이 불안정해 담지 못했어요」, 해제면 「연결이 불안정해 해제하지 못했어요」), 누르면 닫힘.

## Gotchas

- **[미확인 · 실화면 전용] 2026-11-08 TRIP-1740** — 홈 카드(230×300 포트레이트·풀블리드)의 출처 칩은 **어두운 막(스크림)·제목보다 아래층**에 그려져 가려지거나 겹칠 수 있는데 프리뷰 캡처가 카드 윗부분까지만 찍혀(스크롤 도구 없음) 보지 못했다 — 이번 변경에서 가장 크게 바뀌는 곳이라 새 빌드 실화면 1순위. 실데이터 세로형 사진의 여백 모양과 VoiceOver 읽는 순서(제목보다 「사진 출처 한국관광공사」가 먼저 읽히는지)도 미확인이다.
- **[미확인 · 실화면 전용] 2026-11-09 TRIP-1783** — 종 미읽음 배지 셋은 자동 테스트와 프리뷰로 볼 수 없어 새 빌드 실화면에서 처음 본다. 프리뷰 캡처(순수 뷰)에서 확인한 것은 둘뿐이다: 100건 키에서 배지가 그려진다(앞자리 「9」가 보임)·기본 홈(`home-default`)에선 배지가 없다.
  - ① **배지 모양·위치** — 종 원(40) 오른쪽 위 모서리에 지름 20의 분홍 원+흰 테두리로 붙어 종 글리프 오른쪽 위를 약간 덮는다(시안이 없어 담은 곳 배지 모양을 그대로 가져왔다). 프리뷰에선 화면 위쪽 밴드 선택 막대가 홈 헤더 오른쪽 위를 덮어 전체 모양을 못 봤고, 3건 키는 배지가 막대 뒤라 아예 안 보였다. 종 글리프를 지나치게 가리거나 숫자가 잘리면 결함 후보.
  - ② **알림함에서 하나 읽고 뒤로 왔을 때 숫자가 곧바로 줄어 있는가** — 읽음 처리가 홈 숫자를 다시 세게 하는 것은 알림함과 홈을 한 화면 트리에 올린 통합 테스트(3건 → 하나 읽음 → 2건 → 모두 읽음 → 배지 없음)로 증명했다. 그러나 실앱의 홈은 다른 화면에 가려진 동안 멈춰 있고(`freezeOnBlur` — 가려진 탭을 다시 그리지 않고, 돌아올 때 최신 값으로 한 번만 그리는 설정) 그 멈춘 상태에서 읽음 처리가 숫자를 즉시 갱신하는지는 jest 가 원리적으로 못 본다. 돌아온 첫 화면에서 옛 숫자가 보이면(잠깐 뒤 줄어도) 결함 후보 — 몇 초 뒤 줄었는지 함께 적는다.
  - ③ **VoiceOver 가 종을 「알림, 읽지 않은 알림 3개」로 한 번만 읽는가** — 숫자(「3」)가 따로 한 번 더 읽히면 결함.
- 얼굴은 서버 단계값이 아니라 클라가 `status`+날짜(KST)로 파생한다. 계정에 진행 중 여행이 하나라도 있으면 발견·여행 후 얼굴은 실화면에서 못 본다(과거 QA 실측). 여행 후 창 「7일째 포함」은 해석값이다.
- 여행 카드 CTA 라벨은 처음엔 여행 상태 폴백(「일정 이어서 짜기」·「확정 일정 보기」·「여행 일정 보기」)으로 그려졌다가 일정 응답 뒤 목적지 기준으로 덮어써진다. 응답 전 누름은 무시된다 — 라벨이 바뀐 뒤 누른다.
- 프리뷰 픽스처의 CTA 문구는 꺾쇠(›)가 붙어 라이브와 다르다 — 프리뷰로 문구를 증명하지 않는다.
- `home-dashboard-bell` 은 역할 버튼이고 접근성 이름이 있다(「알림」, 읽지 않은 알림이 있으면 「알림, 읽지 않은 알림 N개」 — TRIP-1765 에서 이름이 생겼고 TRIP-1783 에서 개수가 붙었다). 이름 「알림」 완전일치 셀렉터는 미읽음 계정에서 빗나가므로 testID 로 잡는다. 배지 글자는 이 이름에 이미 들어 있어 따로 읽히지 않아야 한다(실기 낭독은 아직 못 들었다 — 위 TRIP-1783 줄).
- 도시 카드 첫 장 testID 는 발견 얼굴에서만 `home-magazine-hero` 다. 계획 중·여행 중·여행 후 캐러셀엔 `home-magazine-hero` 가 없고 도시 카드가 `home-hero-slide-1`~ 이다.
- 「지금 뜨는 장소」·「요즘 사람들이 담는 곳」은 같은 7곳을 나눠 쓴다(앞 4·뒤 3). 컬렉션은 정확히 3장을 못 채우면 섹션이 통째로 사라진다 — "섹션 없음"을 실패로 판정하지 않는다.
- **[실화면 전용]** 캐러셀 스와이프·활성 도트 하이라이트, 딤이 ＋ FAB 까지 덮는지, FAB 하단 여백(탭바와 겹침)은 실화면으로만 확인된다.
- **[실화면 전용]** 스크롤 중 FAB 숨김 — 스크롤 직후 250ms 안에 FAB 를 누르면 `pointerEvents=none` 이라 안 눌린다. 스크롤을 멈추고 기다린 뒤 누른다.
- 카드·CTA 연타 가드(`guardPress`)가 전역 400ms 창을 연다 — 한 번 누른 직후 다른 버튼(「더 보기」 등)을 바로 누르면 무시될 수 있다.
- 서버 「여행 중」 상태(ACTIVE)와 날짜 판정이 다를 수 있다 — 배지는 날짜만 본다.
- 하트 담김은 색이 아니라 `selected` 상태·글리프 testID 로 판정한다(색 fill 은 실화면으로만 확인된다).
- 홈에서 다른 화면으로 돌아오는 진입(위저드 이탈·회고 완료 등) 목록은 확인 필요.
- **[실화면] 2026-10-31 딥링크는 `com.trippilot.travel://…` 스킴으로만 화면이 바뀐다** — `simctl openurl "trippilot:///…"` 는 앱만 앞으로 오고 라우팅되지 않았다(이 dev build Info.plist 에 `trippilot` 스킴이 네이버 로그인 urlScheme 으로 한 번 더 등록돼 있다, [결함 의심 FM-L1-04]).
- [실화면] 2026-10-31 도달 불가 — `home-discovery`·`home-planning`·`home-post-trip`·`home-past-trips-more`: 계정에 여행 중(제주 10/30–31) 여행이 있어 얼굴이 여행 중으로 고정되고, 그 여행은 삭제·수정 금지.
- [실화면] 2026-10-31 도달 불가 — `home-loading`(순간 상태, 캡처 지연보다 짧음)·`home-trips-error`·`home-lane-error`·`home-spot-save-error`(시뮬 네트워크 차단 수단 없음)·`home-fab-scroll-hide`(250ms 창이 agent-device 조작 지연보다 짧음 — 2026-11-03 아래 방법으로 열림).
- [실화면] 2026-10-31 여행 중 얼굴의 「지금 뜨는 장소」·「요즘 사람들이 담는 곳」은 제주 장소로 찬다. 여행 카드 CTA 는 확정 일정이라 「여행 일정 보기」 → 여행 중 허브(지도+시트)로 간다.
- [결함 의심 FM-L1-05] ♥ 메뉴를 펼치면 딤이 본문·＋ FAB 은 덮지만 하단 탭바는 밝게 남고 눌린다(탐색 탭 ♥ 메뉴도 같음, 증거 `home/saved-menu-open.png`).
- [실화면] 2026-11-03 `home-fab-scroll-hide` 열림 — 한 번 끌고 캡처하면 250ms 안에 FAB 이 돌아와 못 잡는다. 끌기를 쉬지 않고 잇고(`agent-device swipe <x1> <y1> <x2> <y2> --count 8 --pause-ms 60 --pattern ping-pong`) 그동안 다른 셸에서 `xcrun simctl io booted screenshot` 을 짧은 루프로 찍으면 "끄는 중 FAB 없음 → 멈춘 뒤 FAB 있음"이 잡힌다. 가로 레인 비영향도 같은 방법(가로 좌표).
- [실화면] 2026-11-02 실패 주입(sim-qa §2 `_dev/fault`)으로 열림 — `home-loading`(`/trips` 지연)·`home-trips-error`(`/trips` 500)·`home-lane-error`(`/places` 500, 「장소를 불러오지 못했어요 · 다시 시도」).
