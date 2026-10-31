---
id: notifications
band: l
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/notifications.tsx
---

# 알림함 · 푸시 탭 이동

알림함(l01)은 받은 알림을 "오늘"·"이전" 두 묶음 카드로 보인다. 행마다 미읽음 점, 종류 아이콘, 제목, 본문(2줄), "라벨 · 상대시각"이 있고, 서버가 목적지를 준 알림은 누르면 그 화면(일정·요약·재계획·회고·등록 숙소)으로 가며 읽음 처리된다. 재계획 알림은 행 대신 "대안 일정 보기 ›" 링크로 간다. 미읽음이 있으면 헤더 [모두 읽음]이 생긴다. 푸시 알림을 탭해도 알림함 행과 **같은 목적지**로 바로 간다(알림함을 거치지 않는다).

## Sub-features

- `inbox-list` "오늘"(기기 로컬 날짜가 같은 알림)·"이전" 묶음, 묶음 안은 서버 순서.
- `inbox-row` 행: 미읽음 점(미읽음일 때만)·아이콘·제목·본문(공백뿐이면 생략)·"라벨 · N분 전" 메타. 라벨은 숙소·일정·재계획·회고·커뮤니티·시스템.
- `inbox-navigate` 목적지 있는 행 → 그 화면으로 push, 동시에 그 알림 읽음 요청(이동이 먼저).
- `inbox-planb-link` 재계획 알림은 행이 아니라 "대안 일정 보기 ›" 링크가 이동한다.
- `inbox-no-route` 목적지 없는 알림(모르는 종류·필수 값 없음)은 눌러도 아무 일 없다.
- `inbox-mark-all` 미읽음이 하나라도 있으면 헤더 "모두 읽음" → 전부 읽음, 점이 사라지고 버튼도 사라진다.
- `inbox-mark-all-error` 모두 읽음 실패 → "일부 알림을 읽음 처리하지 못했어요".
- `inbox-empty` 알림 0건 → 점선 상자 벨 + "아직 받은 알림이 없어요" / "새로운 소식이 오면 여기에서 알려드릴게요".
- `inbox-error` 목록을 한 번도 못 받고 실패 → "알림을 불러올 수 없어요" / "잠시 후 다시 시도해 주세요" + [다시 시도].
- `push-tap` 푸시 탭 → 같은 목적지로 push(로그인 전·부팅 중이면 보류했다가 홈이 그려진 뒤 한 번). 목적지가 없으면 이동 없음.
- `push-receive` 푸시를 받거나 탭하면 알림함 목록을 다시 받게 한다.

## How to get to it (user POV)

- 홈 인사 헤더 오른쪽 끝 벨 — testID `home-dashboard-bell`(모든 홈 얼굴 공통).
- 딥링크 `trippilot:///notifications`.
- 푸시 알림 탭은 알림함이 아니라 **알림의 목적지 화면**으로 간다 — 알림함 진입 경로가 아니다.
- 일정 알림(`TRIP_ITINERARY`)으로 연 일정 화면은 `from=notification` 표식을 받아 뒤로가기가 알림함으로 돌아오게 한다(일정 레인 소관).
- 마이·설정에는 알림함 진입이 없다.

## Driving it with agent-device

Preconditions:

- 로그인된 계정, HOME. 목록 검증에는 서버에 알림이 쌓인 계정이 필요하다(여행 생성·숙소 등록·회고 등으로 생긴다). 빈 얼굴은 알림 0건 계정이 필요하다.
- 행 이동 검증은 종류별 알림이 있어야 한다: 일정(`TRIP_ITINERARY`) · 요약(`TRIP_SUMMARY`) · 재계획(`PLANB_REPLAN`, `triggerId` 필요) · 회고(`REFLECTION_DAILY`, `dayDate` 필요) · 숙소(`STAY_DETAIL`, `savedStayId` 필요).
- 행 누르기·모두 읽음은 읽음 상태를 바꾼다(되돌릴 수 없다) — 미읽음 점 검증을 먼저 끝낸다.
- 푸시 탭 검증은 `xcrun simctl push` 페이로드(trippilot-sim-qa §2 — 데이터는 Expo 형식 `body` 안)로 한다. 실제 서버 푸시 수신은 별개다.

- **진입.** 홈 → testID: `home-dashboard-bell`. testID: `notification-inbox-header` 에 "알림", testID: `notification-inbox-back`.
- **목록.** 묶음 제목 "오늘"/"이전", 행 testID: `notification-inbox-row` 여러 개. 미읽음 행엔 testID: `notification-inbox-unread-dot`, 본문은 testID: `notification-inbox-body`. 메타 문구가 "일정 · 3시간 전" 꼴인지 본다.
- **행 이동.** 회고 알림 행을 누른다 → `/trips/<tripId>/records/reflection/<dayDate>` 회고 화면. 뒤로 → 알림함에서 그 행의 미읽음 점이 사라졌는지(재조회 뒤) 한 번 더 읽는다. 일정 알림 → 일정 화면, 요약 알림 → 여행 요약, 숙소 알림 → 등록 숙소 목록(상세가 아니라 목록).
- **재계획 링크.** 재계획 알림 행에 testID: `notification-inbox-action` "대안 일정 보기 ›" → `/trips/<tripId>/planb?triggerId=<id>` 재계획 시트. 행 몸통을 눌러도 이동하지 않는다.
- **모두 읽음.** 미읽음이 있을 때 testID: `notification-inbox-mark-all`("모두 읽음") → 점이 전부 사라지고 버튼도 사라진다. 실패면 testID: `notification-inbox-mark-all-error` "일부 알림을 읽음 처리하지 못했어요".
- **빈 얼굴.** (알림 0건 계정) testID: `notification-inbox-empty`·`notification-inbox-empty-box`, "아직 받은 알림이 없어요", "새로운 소식이 오면 여기에서 알려드릴게요". [모두 읽음] 없음.
- **오류 얼굴.** (첫 조회 실패 — 네트워크 차단 등) testID: `notification-inbox-error` "알림을 불러올 수 없어요"·"잠시 후 다시 시도해 주세요", testID: `notification-inbox-retry`("다시 시도") → 재조회 중 비활성, 성공하면 목록.
- **푸시 탭.** 홈에 있는 상태에서 `xcrun simctl push` 로 `{"actionType":"REFLECTION_DAILY","tripId":…,"dayDate":…}` 를 보내고 배너를 탭한다 → 회고 화면으로 바로 간다(알림함 아님). 앱을 끈 상태에서 탭하면 부팅·홈이 그려진 뒤 한 번 이동한다. 모르는 `actionType` 이면 이동 없음.
- **뒤로.** testID: `notification-inbox-back` → 홈.

## Gotchas

- 첫 조회 중엔 로딩 얼굴이 없어 **빈 얼굴("아직 받은 알림이 없어요")이 먼저 잠깐 보인다** — 진입 직후 빈 얼굴로 판정하지 말고 조금 기다려 다시 읽는다(결함 후보).
- "오늘"/"이전"은 기기 로컬 날짜로 가른다 — 시뮬 시각·시간대에 따라 묶음이 바뀐다. 지난 QA(20261021 N-056)는 24시간 기준처럼 보인다고 적었다(서버 `occurredAt` 시간대 확인 필요).
- 숙소 알림(`STAY_DETAIL`)은 등록 숙소 **목록**(`/my/stays`)으로 간다 — 상세 화면이 없어서다. 목록으로 가는 것이 정상.
- 회고 알림인데 `dayDate` 가 없거나, 재계획인데 `triggerId` 가 없으면 행이 눌리지 않는다(정상 — 목적지 없음).
- 행 읽음 요청 실패는 안내 없이 삼킨다 — 재조회 뒤 점이 그대로 남는 것으로만 드러난다.
- 푸시 탭 보류는 메모리 한 칸이다 — 로그인 전에 탭한 푸시는 로그인 뒤 홈이 그려지면 한 번 간다. 안드로이드 Activity 재생성 땐 사라진다. 실제 탭·이동 시점은 실화면으로만 확인된다. [실화면 전용]
- 푸시 페이로드 데이터를 최상위 키에 두면 탭해도 이동이 없다(trippilot-sim-qa §2) — 이동 없음을 결함으로 판정하기 전에 페이로드 형식을 본다.
- 홈 벨에는 미읽음 빨간 점이 없다(읽음 처리 미배선이라 뺐다) — 벨만 보고 미읽음 여부를 판정할 수 없다.
- `/notifications` 는 HOME 가드 밖 라우트다 — 미인증 딥링크로도 틀이 열린다(데이터는 401 → 오류 얼굴).
- [실화면] 2026-10-31 "첫 조회 중 빈 얼굴이 잠깐 보인다"(위 결함 후보)는 관찰되지 않았다 — 앱 재기동 직후 첫 진입을 화면 녹화(15fps)로 봤는데 전환 프레임부터 목록이 그려져 있었다(홈이 미리 받았거나 응답이 빨랐던 것으로 추정). 증거 `notifications/02-first-entry-frame.png`.
- [실화면] 2026-10-31 행은 testID `notification-inbox-row` 대신 라벨(`<제목>, <본문>, <라벨> · <상대시각>`)로 잡히고 상대시각이 분마다 바뀐다 — 라벨 셀렉터보다 `snapshot -i` 의 ref 로 누른다. 목적지 없는 알림 행("회고를 만들지 못했어요")은 `[other]` 로 잡혀 눌리지 않는다. 메타는 "회고 · 어제"·"일정 · 2일 전" 꼴도 있다.
- [실화면] 2026-10-31 푸시 탭(`simctl push` `REFLECTION_DAILY` 2일차)은 홈에서 회고 화면으로 바로 갔고, 그 화면 뒤로는 홈이 아니라 **기록 탭(여행 캘린더)** 으로 돌아왔다(판단 필요 — 회고 화면이 기록 스택 소속인 것으로 보인다). 배너는 1초 안에 눌러야 한다(늦으면 사라진다). 증거 `notifications/09-push-tap-result.png`.
- [실화면] 2026-10-31 도달 불가 — `inbox-planb-link`(재계획 알림 없음), `inbox-mark-all-error`·`inbox-error`(실패 유도 수단 없음), `inbox-empty`(알림 있는 계정), `push-receive`(재조회는 화면으로 구분 불가).
- [실화면] 2026-10-31 [결함 의심 FM-L6-01] 콜드 딥링크로 이 화면을 바로 열면(`simctl terminate` → `simctl openurl com.trippilot.travel://…`) 헤더 뒤로가 무반응이고 엣지 스와이프도 안 먹어 화면에 갇힌다 — 개발 콘솔에 `The action 'GO_BACK' was not handled by any navigator`. 뒤로가 `router.back()` 뿐이라 쌓인 화면이 없으면 갈 곳이 없다. 실측: `settings`·`settings/personalization`·`settings/notifications`·`notifications`. 앱이 떠 있을 때(웜) 딥링크는 정상. 증거 `settings/07-cold-deeplink-back.png`, `settings-preferences/08-pers-cold-back.png`.
