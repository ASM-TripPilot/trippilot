---
session: 1b098b1e-561c-4b1a-bd3b-4e4fb038d0b9
area: root
cwd: .
branches_seen: [develop]
current_branch: develop (작업은 전부 /Users/juna/dev/trippilot/wt-* worktree 에서)
span_kst: "10-18 21:46 → 11-04 12:30 (이어짐)"
ended_by: —
status: 진행중
resume_local: "claude --resume 1b098b1e-561c-4b1a-bd3b-4e4fb038d0b9"
related_prs: [1421, 1422, 1423, 1438, 1441, 1443, 1859, 1861, 1862, 1863, 1865, 1866, 1867, 1869, 1872, 1873, 1874, 1876, 1879, 1880, 1883, 1884, 1885, 1886, 1889, 1890, 1899, 1901, 1902, 1905, 1907, 1913, 1919, 1920]
tickets: [TRIP-1446, TRIP-1668, TRIP-1707, TRIP-1758, TRIP-1759, TRIP-1760, TRIP-1761]
---
# 상황 감지(Plan-B) 에픽 종료 → 알림(리마인드·푸시) 끝에서 끝 점검·수리가 이어지는 중

## 이 문서가 다루는 것
이 세션(`trippilot-79`)은 두 갈래를 맡았다.
1. **Plan-B 변수 상황 감지**(10-18~10-30) — **종료.** 서버 스윕·선계산 대안·기회 카드까지 전부 머지됐고 10-30 운영·개발 전원 켜짐(판단 기록 #1699). 10-20 판의 WIP 브랜치 표는 더는 유효하지 않다 — 이어받지 말 것.
2. **알림(리마인드 문구 → 푸시) 끝에서 끝**(11-04~) — **진행 중.** 아래.

## 알림 갈래 — 한 줄 요약
사용자 질문 "알림이 사용자한테 가는가 / 학생 모델(local LLM)이 만든 문구가 푸시로 잘 나가는가" 에 대한 점검(운영 48시간 로그 + 코드 5곳 조사 + 반박 검증)과 서버 쪽 수리.
**결론: 지금까지 푸시는 한 건도 도착하지 않았다**(앱 빌드에 aps-environment 가 없어 토큰 등록 시도 0건 → 서버가 보낸 46건 전부 `NO_DEVICE`). 학생 모델 문구는 예약의 15% 만 AI 문구였다(콜드스타트·일부 실패 폐기·행당 예산 부족·단발 재시도). 수리 뒤 첫 실측은 아래 "운영 반영 상태".

## 한 일(머지) — 전부 서버/AI/인프라, 앱 코드는 안 건드렸다
| 영역 | PR |
|---|---|
| 문구 채움 | #1859 거짓 경고 정리 · #1862 일부만 성공해도 쓰기 · #1865 빠진 행만 제자리에서 점점 늘려 재시도(3·8·16·29·50분)+묶음 3건·마감 10.5s · #1873 문구 근거 지문(`copy_basis`)을 발화 직전 일정과 대조 · #1866(AI) 게이트가 허용 장소명을 지운 뒤 소요시간을 본다 · #1876(AI) 게이트 드롭 규칙명 로그 · #1884 기동 때 대기열 복원(재시작에 사라지는 인메모리 재시도) |
| 푸시 발송·도착 | #1861 Expo 호출 시한 · #1863 `NO_DEVICE` 원인 분리(NO_TOKEN/NOT_GRANTED)+소리·보관 시간 · #1867 토큰 해제 DELETE 대괄호 · #1869 티켓 id 기록 · #1872 영수증 폴러(TRIP-1707) · #1883 티켓 기록 세이브포인트 · #1889 등록 줄 토큰 모양(`format`) |
| 경보·관측 | #1874 CloudWatch 경보(`push_dispatch_failed`·`push_alert`) · #1880 접수 단계 `push.alert stage=ticket` · #1885 `outbox.abandon` 경보 → **#1913 로그 그룹당 regex 패턴 5개 한도에 걸려 와일드카드로** · #1886 발화 줄 `reminder.fire copy=AI|CONSTANT|STALE` |
| 계정 | #1879 삭제 요청 시 리마인드 중단·철회 시 복원(TRIP-1760) → **#1901 이 이벤트 순서가 아니라 처리 시점의 계정 상태(`auth.api.AccountStatusFacade`)를 따르게 고침** — 푸시 토큰은 지우지 않고 발송 지점이 유예 계정에 MUTED |
| 독립 리뷰가 찾은 결함 | #1899 발화 때 일정 읽기 실패 → rollback-only 로 같은 푸시 매분 재발송(#1873 의 잠복 결함, 11-04 06:38 수리 배포) · #1901 삭제 요청·철회 순서 의존 · #1902 낮은 심각도 정리 · #1905 안티패턴 3건 |
| 예약 재계산·관측 정밀도 (11-04 낮, develop 만) | #1920 여행 기간을 고치면 `TripPeriodChanged` → 예약 재적재(예약이 한 번이라도 적재된 여행만 `onlyIfScheduled`·적재 366일 상한, TRIP-1758 완료) · #1919 `MUTED` 사유를 `reason=DELETION_PENDING\|PUSH_OFF` 로 로그·지표에 + 재료 없음만 남은 문구 채움 포기 줄은 INFO |

## 운영 반영 상태(11-04 08:30 기준 · 12:30 보강)
- **알림 갈래 PR 은 전부 운영에 있다.** 2차 승급 #1878(11건)은 03:28, 나머지 후속은 승급 #1906 + #1914 로 06:38(run 41721357956)에 배포됐다. #1906 의 첫 배포는 terraform apply 에서 `outbox_abandon` 필터(#1885)가 CloudWatch **로그 그룹당 regex 패턴 5개** 한도에 걸려 중단됐고, 와일드카드로 고친 #1913 을 실은 #1914 로 다시 배포해 통과했다(알람 이름이 `trippilot-dev-…` 인 것은 이 AWS 스택 이름이 dev 인 탓 — 운영 네임스페이스만 센다).
- 운영 로그로 확인(06:3x): 새 백엔드 파드 2대 — 스키마 v2.90 그대로(마이그레이션 없음) · `push=expo reminder=http` · 기동 때 문구 채움 대기열 복원 14건(#1884) · `push.alert`·`outbox.abandon`·ERROR 0건.
- **학생 모델 문구 — 수리 뒤 첫 실측**: 배포 직후 1회차(06:38 KST)는 모델 콜드스타트라 AI 호출 56건이 전부 `ModelNotReadyException` 이었다(정상 — 못 받은 행은 상수 문구로 남는다). 2회차(06:44, 시작 +8분)에서 28건이 전부 성공(지연 p50 1.1초)해 **재시도 대상 32행 중 28행(88%)에 AI 문구가 붙었다.** 남은 4행은 그날 일정에 장소가 없어 물을 재료가 없는 행(`askable` 이 슬롯 있는 행만 받는다)이라 상수 문구가 맞다. 종전 15%(45/295)와 견줄 수 있지만 표본은 48시간 안 14개 여행뿐이었다.
- **실제 발화 실측(11-04 08:00:08 KST, 08:22 점검)**: `reminder.fire` 21건 — **AI 19 · CONSTANT 2 · STALE 0 = 90%.** CONSTANT 2건은 사다리 끝에 `재료 없음` 으로 남은 행에 속한다(재료가 있는 예약은 19건 전부 AI 문구). 푸시는 여전히 0 — `push.dispatch` 는 `NO_DEVICE reason=NO_TOKEN` 20 · `MUTED` 1(그 시점엔 사유 로그가 없었다 — 푸시 끔 또는 삭제 유예. #1919 이후 `reason=PUSH_OFF|DELETION_PENDING`) · `SENT` 0, `push.token.register` 줄 0. `push.alert`·`outbox.abandon`·새 ERROR 종류 0.
- 알아 둘 것: 사다리 마지막 회차(시작 +50분)마다 `리마인드 문구를 끝내 못 채웠습니다 … 재료 없음 N건` WARN 이 남는다. `재료 없음` 이 남은 행 수와 같으면 평소 상태다 — 일정이 뒤늦게 생기는 날을 위해 재료 없는 행도 끝까지 재시도하고 포기 때 한 줄 남기는 설계(INV-4)인데, 남은 행이 전부 재료 없음일 때도 WARN 이었다(두 파드가 각자 복원해 줄이 2배) — #1919 부터 그 경우는 INFO, 물었는데 못 받은 행이 있을 때만 WARN 이다(운영은 다음 승급 뒤).
- **#1919·#1920 은 develop 에만 있다**(11-04 12시대 머지) — 운영에는 다음 승급 열차에 실린다(배포 담당). 승급 뒤 확인: `push.dispatch outcome=MUTED … reason=` 이 `DELETION_PENDING`/`PUSH_OFF` 로 찍히는지, 기간을 고친 여행에서 `리마인드 예약 N건을 적재했습니다` 줄이 새 날짜 수로 다시 나오는지.
- **순서**: (서버는 끝남) → (사용자) Expo APNs .p8 업로드·프로비저닝 프로파일 확인 → 새 iOS 빌드 → 팀 TestFlight → 사용자 릴리스.

## 다음에 이어서 할 일
1. 날마다 운영 로그의 `reminder.fire kind=… copy=AI|CONSTANT|STALE` 로 AI 문구 비율을 센다(첫 08:00 실측은 위 90%, 종전 15%). 같이 `push.alert`·`outbox.abandon` 이 0 · `push.token.register … format=` 이 `expo` · `push.dispatch` 가 아직 전부 `NO_DEVICE`(토큰 0)인지. 로그는 `.github/workflows/aws-dev-logs.yml` 을 **`--ref develop`** 으로 디스패치(main 판에는 `namespace` 입력이 없다 → 422).
2. 첫 실기기 시험이 나오면 로그 순서: `push.token.register platform=… format=expo` → `push.dispatch outcome=SENT` → 15분 뒤 `push.receipt outcome=…`. `format=other` 면 앱이 Expo 토큰이 아닌 값을 보낸 것(앱 담당). `push.alert stage=ticket|receipt` 는 자격 문제 — .p8·`PUSH_EXPO_ACCESS_TOKEN`.
3. 매일 08:22 크론(`77b35d3d`, 세션 한정·7일)이 `scratchpad/t6tools/daily_check.py` 로 요약한다 — 이 스크립트는 로컬 scratchpad 에만 있다(리포 밖). 클라우드 세션은 못 돌린다.
4. 사람·제품 결정이 필요한 것(「내가 할 일」 페이지 https://claude.ai/artifact/A8MsxLJ6hP9evGhyd4CUfB 에 올라 있다): Expo .p8 업로드·프로파일 확인 · 스토어 빌드 요청 · SLOT_PRE(일정 시작 전 알림) 구현 여부 — 설정 행과 온보딩 문구가 약속하는데 생산자가 없다 · 인앱 알림 OFF 가 푸시까지 막는 계약 불일치 · 회고 푸시(TRIP-1759, 회고 담당) · 안드로이드 FCM·채널(출시 전) · 여행 길이 상한(TRIP-1761 — 서버 어디에도 없다, 숫자는 제품 결정. 알림 적재만 366일 방어선).
5. 서버 쪽 남은 것(작은 것): 08:00 동시 도래(계정 1~2천 넘으면 꼬리 취소, 지금은 무관). 끝난 것 — TRIP-1758(여행 기간 PATCH 후 예약 재계산)은 #1920, 삭제 대기 계정을 거르는 공용 판정은 #1901 의 `AccountStatusFacade`.

## 함정 / 주의
- **푸시는 아직 한 번도 도착하지 않았다.** "잘 가고 있다"고 말하기 전에 `push.dispatch outcome=SENT` 와 영수증을 본다. `SENT` 는 Expo 가 접수했다는 뜻일 뿐이다.
- **삭제 유예 계정의 푸시 토큰은 지우지 않는다**(#1901). 앱이 같은 서명이면 토큰 등록을 건너뛰어(TRIP-1348) 서버가 잃은 토큰을 다시 올리지 않는다 — 푸시를 막는 것은 `PushDispatchService` 의 계정 상태 검사다. 토큰 삭제를 다시 넣지 말 것.
- 이 갈래의 PR 은 **독립 리뷰(리뷰어 + 반박)** 에서 실제 결함 둘이 나왔다. 트랜잭션 합류 읽기·삼킨 DB 쓰기·이벤트 순서는 단위 테스트 대역(트랜잭션 없음)으로 안 보인다 — 실 트랜잭션 IT(`NotificationFireTxIT`·`AccountDeletionNotificationIT`·`PushTicketIT`)로 잰다. 안티패턴 로그(#1905)에 3건.
- **CloudWatch 로그 필터는 로그 그룹당 regex 패턴 5개가 한도다**(`application` 그룹은 5/5 — `gateway_5xx`·`refresh_reuse`·`llm_call_failed`·`push_dispatch_failed`·`push_alert`). 새 필터는 `"*…*"` 와일드카드로 쓴다(#1885 → #1913). `terraform test`·`validate` 는 못 잡고 apply 에서만 깨진다.
- develop 대상 PR 은 `origin/develop` 에서 딴 브랜치로 올린다 — main 위에서 딴 브랜치는 develop 의 `aws-dev-logs.yml`(`namespace` 입력) 등을 main 사본으로 덮는다(#1912, 머지 전에 막음). 둘 다 안티패턴 로그에 있다.
- 접은 것(재제안 금지): 푸시 data 의 `notificationId`(앱이 안 읽는다) · 주기 DB 훑기(성공 호출마다 5분 창 과금 — 기동 복원으로 대체) · TRIP_PRE 지각 알림(전날 밤 일정이면 안 와도 정상) · 운영 계정 허용목록(첫 사용자가 팀 TestFlight).
- 선언적 `PROPAGATION_NESTED` 는 이 앱의 트랜잭션 관리자가 막는다(`NestedTransactionNotSupportedException`) — 세이브포인트는 JDBC 로 직접(#1883). 전역 설정을 바꾸지 말 것.
- PR 본문·제목에 티켓 키를 쓰면 Jira 자동화가 닫을 수 있다(#1872 는 안 닫았다). 부분·진단 PR 은 키 없이.
- 머지 도우미는 `gh pr checks --watch` 를 믿지 말고 상태를 직접 센다(#1865 가 CI 대기 중 머지된 사고).
- 로컬 OpenTofu 는 `tftest` 의 `override_during` 를 몰라 `tofu test` 불가 — `terraform test` 는 CI(`infra-validate`).
- 세션 메모리(`~/.claude/projects/-Users-juna-dev-trippilot-trippilot/memory/notification-pipeline-audit-1104.md`)에 가장 세밀한 상태가 있다 — **로컬 전용**.

## 참조
- 정본: `aidlc/aidlc-docs/construction/u6-notification-settings/functional-design/` (BR-U6-xx), 상황 감지는 `.../situation-awareness/`
- BE: `backend/modules/notification/`(리마인드 `NotificationScheduleService`·`ReminderCopyRetries`, 푸시 `PushDispatchService`·`PushReceiptPoller`·`ExpoPushAdapter`), 릴레이 `backend/app/.../OutboxRelay.kt`
- AI: `ai/src/trippilot/llm_gateway/gates/content/reminder_copy.py`, 계약 `ai/docs/openapi.json`(`/ai/v1/notification/copies`)
- 인프라: `infra/terraform/stack/alerts.tf`
- 앱 쪽 갭(F4~F10)·안드로이드: Jira TRIP-1668 댓글 11087
