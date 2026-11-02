---
id: planb-apply
band: i
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/planb/solving.tsx
  - app/trips/[tripId]/planb/draft.tsx
  - app/trips/[tripId]/live/index.tsx
---

# Plan-B 재계획 진행·초안·적용

재계획 세션을 연 뒤의 흐름이다. **진행 화면**(i05, `planb/solving`)은 지도 위 진행 카드 「AI가 일정을 다시 짜고 있어요」와 시트(「AI 재계획안」 · 방문한 곳 행 + 뼈대 카드)를 띄우고 세션을 폴링한다. 결과가 나오면 **재계획안 화면**(i06, `planb/draft`)으로 replace 되어 초안(행·빠지는 곳·`N곳 · 총거리`)·대안 없음·실패 세 얼굴 중 하나를 그린다. 초안의 「적용하기」가 일정을 바꾸는 유일한 지점이고, 성공하면 허브로 돌아가 「변경 반영됨 · 새 일정이 반영됐어요」 시트(i08)가 한 번 뜬다. 진행·초안에서 나가면 확인 다이얼로그가 붙잡고, 「나가기」는 서버에 아무것도 보내지 않는다(원래 일정 그대로).

## Sub-features

- `solve-progress` 진행 얼굴 — 캡션: 「지금 이후」면 `{H}시 이후 다시 짜는 중`, 「오늘 전체」면 「오늘 일정 다시 짜는 중」, 미래 일차면 `{N}일차 일정 다시 짜는 중`, 응답 전 「일정 다시 짜는 중」. 오늘이면 헤더 meta `방문한 N곳 그대로`.
- `solve-slow` 90초가 지나면 시트 맨 위 「시간이 걸리고 있어요」·「나가도 원래 일정은 그대로예요」(폴링은 계속).
- `solve-cap` 8분 상한 → 「생성이 늦어지고 있어요」 + 「다시 시도」(같은 입력·같은 알림으로 새 세션)·「홈으로」.
- `solve-cancel` 진행 카드 「취소」 → 세션 취소 성공 뒤에만 나간다. 실패하면 「취소하지 못했어요. ‹ 로 나갈 수 있어요」.
- `solve-leave` ‹·iOS 스와이프 → 「나가면 결과를 잃을 수 있어요」 다이얼로그 → 「계속 기다리기」/「나가기」(서버 호출 없음, 뒤가 없으면 허브로).
- `solve-error` 세션 조회 실패(재시도 후) → 「재계획 상태를 불러오지 못했어요」 + 「다시 시도」·「취소」(서버 호출 없이 나가기).
- `solve-closed` 이미 끝난(적용·취소된) 세션 → 「이미 끝난 재계획이에요」 + 「나가기」.
- `draft-face` 초안 → 행(시각 `HH:MM–HH:MM`)·고정 표식·「이번 계획에서 빠지는 곳 N곳」 + 하단 「직접 수정」·「적용하기」. 초안을 받기 전엔 「재계획안을 불러오는 중이에요」, 실패면 「재계획안을 불러오지 못했어요」 + 「적용하기」 잠금.
- `draft-prepared` 서버가 미리 준비한 초안(트리거 진입)이면 머리에 「미리 준비한 대안」.
- `draft-include-missing` 기회 카드에서 넣으려던 장소가 초안에 없으면 「‘{이름}’은/는 이번 안에 넣지 못했어요.」.
- `draft-apply` 「적용하기」 → 허브로 dismissTo + 반영 시트. 미래 일차 세션이면 허브가 그 일차로 열린다.
- `draft-apply-failed` 적용 실패 → 「변경을 반영하지 못했어요」·「원래 일정은 그대로 있어요. 잠시 후 다시 시도해 주세요.」.
- `draft-stale` 적용 409(만료·낡음) → 「시간이 지나 이 대안은 지금 일정과 맞지 않아요」 + 「새 대안 보기」(같은 입력으로 새 세션 → 진행 화면). 지난 날 초안이면 버튼 없음. 「적용하기」는 잠긴다.
- `draft-no-solution` 대안 없음 → 「대안을 찾지 못했어요」·「조건을 줄이거나 직접 고쳐 주세요」 + 「직접 수정」·「조건 바꿔 다시 짜기」(그 세션 입력을 시드로 요청 시트). 오늘 세션이고 내일이 일정에 있으면 「내일 일정 다시 짜기」(실패하면 「내일 일정을 다시 짜지 못했어요. 잠시 후 다시 시도해 주세요」).
- `draft-failed` 실패 → 「다시 짜지 못했어요」·「잠시 후 다시 시도하거나 직접 고쳐 주세요」 + 「직접 수정」·「다시 시도」(같은 입력으로 바로 새 세션). 다시 시작이 실패하면 시작 실패 문장, 지난 날 세션이면 날짜 안내 문장.
- `draft-leave` 초안 얼굴에서 ‹·스와이프 → 「재계획안을 적용하지 않고 나갈까요?」 → 「계속 보기」/「나가기」(적용·취소 안 함).
- `draft-error`·`draft-closed` 세션 조회 실패·이미 끝난 세션 → 진행 화면과 같은 문구의 얼굴(「다시 시도」·「나가기」 / 「나가기」).
- `draft-manual` 「직접 수정」 → 그 날짜로 편집기(`planb-request`의 `manual-edit`).
- `applied-sheet` 허브 위 반영 시트 「변경 반영됨」·「새 일정이 반영됐어요」(+ 초안 캐시가 있으면 요약 배지) → 「확인」으로 닫는다. 시트가 열린 동안 하단 바가 숨는다. 반영 시트가 뜰 때 허브 시트는 펼침으로 열리고, 시트를 닫아도 펼침이 유지된다. 초안 화면은 시트를 가장 낮게 내려도 「직접 수정」·「적용하기」가 보인다.

## How to get to it (user POV)

- 요청 시트 「AI가 다시 짜기」 성공 → 진행 화면(replace). 현재 위치 입력 「이 위치로 계속」도 같다(`live-location`).
- 진입 게이트(위험 상세 「대안 보기」·푸시·알림함 Plan-B 행)가 준비 세션 상태로 진행 화면 또는 재계획안 화면으로 바로 보낸다.
- 진행 화면이 결과를 받으면 재계획안 화면으로 자동 replace.
- 재계획안의 「새 대안 보기」·「다시 시도」·「내일 일정 다시 짜기」 → 새 진행 화면.
- 반영 시트: 「적용하기」 성공 뒤 허브(`live?applied=<sessionId>`).
- 딥링크 `trippilot:///trips/<tripId>/planb/solving?sessionId=<id>`·`…/planb/draft?sessionId=<id>`.

## Driving it with agent-device

Preconditions:

- `planb-request` 전제와 같다: 시작일 = 오늘(KST)인 확정 여행, 여행 도시 안으로 맞춘 시뮬 위치, 서버 `dev-api`(AI 연동이 살아 있어야 초안이 나온다 — AI 장애면 실패 얼굴만 보인다).
- 세션 id 는 진행·재계획안 화면 URL 에서만 보인다 — 딥링크 분기용 id 는 `?sessionId=` 를 Metro 로그·서버 로그로 얻는다(**확인 필요**: QA 에이전트가 세션 id 를 얻는 가장 쉬운 길).
- 대안 없음·실패·낡음 얼굴을 서버로 만드는 방법은 **확인 필요** — 없으면 프리뷰 `planb-noalt`·`planb-draft-error`·`planb-solving-slow`·`planb-solving-error`·`planb-draft-closed`·`planb-applied` 로 표면만 본다.

- **진행 화면.** 요청 시트 제출 직후 진행 카드(testID: `generation-progress-card`) 「AI가 일정을 다시 짜고 있어요」와 캡션(예: 「15시 이후 다시 짜는 중」), 시트 헤더 「AI 재계획안」, 뼈대 카드(testID: `planb-skeleton`)가 보인다.
- **결과 도착.** 기다린다(폴링). 화면이 재계획안으로 바뀌고 행(행 루트 testID `planb-draft-slot-${slotKey}` 는 트리에 안 잡히고 자식 `planb-draft-slot-time-${slotKey}`·`planb-draft-slot-number-${slotKey}`·고정 표식 `planb-draft-fixed-${slotKey}` 로 잡힌다)과 하단 버튼(testID: `sheet-cta-button-0` 「직접 수정」, testID: `sheet-cta-button-1` 「적용하기」)이 보인다.
- **진행 중 나가기 확인.** 진행 카드 ‹(testID: `generation-progress-back`)를 누른다. 다이얼로그(testID: `planb-solving-leave-confirm`) 「나가면 결과를 잃을 수 있어요」 → 「계속 기다리기」(`planb-solving-leave-confirm-stay`)는 닫기만, 「나가기」(`planb-solving-leave-confirm-leave`)는 허브로.
- **진행 중 취소.** 진행 카드 「취소」(testID: `generation-progress-cancel`). 취소 응답 뒤 허브로 돌아간다. 네트워크를 끊고 누르면 「취소하지 못했어요. ‹ 로 나갈 수 있어요」(testID: `planb-solving-cancel-error`).
- **느림 안내.** 90초 이상 결과가 없으면 「시간이 걸리고 있어요」(testID: `planb-solving-slow`).
- **8분 상한.** 8분이 지나도 진행 중이면 「생성이 늦어지고 있어요」(testID: `planb-solving-capped`) + 「다시 시도」(testID: `planb-solving-capped-retry`)·「홈으로」(testID: `planb-solving-capped-home`).
- **진행 조회 실패.** 진행 중 네트워크를 끊는다. 「재계획 상태를 불러오지 못했어요」(testID: `planb-solving-error`) + 「다시 시도」(testID: `planb-solving-retry`)·「취소」(testID: `planb-solving-error-cancel`).
- **초안 적용.** 재계획안 「적용하기」(testID: `sheet-cta-button-1`). 허브로 돌아가 반영 시트(testID: `planb-applied-sheet`) 머리 「변경 반영됨」(testID: `planb-applied-eyebrow`)·제목 「새 일정이 반영됐어요」(testID: `planb-applied-title`)가 뜨고 시트가 펼침으로 올라와 있다. 요약 배지(testID: `planb-applied-badge`)는 초안 캐시가 있을 때만.
- **반영 확인.** 「확인」(testID: `planb-applied-confirm`). 시트가 닫히고 하단 바가 돌아오며, 허브 카드가 초안 행 순서와 같다. 바의 뒤로 한 번에 홈으로 간다(허브가 두 장 쌓이지 않음).
- **초안 나가기 확인.** 재계획안 좌상단 뒤로(testID: `sheet-daychip-back`, 라벨 「뒤로」). 다이얼로그(testID: `planb-draft-leave-confirm`) 「재계획안을 적용하지 않고 나갈까요?」 → 「계속 보기」(`planb-draft-leave-confirm-stay`)/「나가기」(`planb-draft-leave-confirm-leave`). 나간 뒤 허브 일정이 그대로다.
- **빠지는 곳.** 초안에서 빠진 장소가 있으면 「이번 계획에서 빠지는 곳 N곳」 아래 행(testID: `planb-draft-removed-${slotKey}` — 트리에선 `[cell] "원래 HH:MM"` 라벨로만 잡힌다)에 `원래 HH:MM`.
- **미리 준비한 대안.** 트리거 진입 게이트가 준비된 초안으로 보내면 머리에 「미리 준비한 대안」(testID: `planb-draft-prepared`).
- **대안 없음.** 대안 없음 얼굴의 안내(testID: `planb-draft-notice`, 제목 testID: `planb-draft-notice-title` 「대안을 찾지 못했어요」). 「조건 바꿔 다시 짜기」(testID: `sheet-cta-button-1`) → 같은 사유·지시가 켜진 요청 시트. 내일이 일정에 있으면 「내일 일정 다시 짜기」(testID: `planb-draft-next-day`) → 「{N}일차 일정 다시 짜는 중」 진행 화면.
- **실패 얼굴.** 「다시 짜지 못했어요」 + 「다시 시도」(testID: `sheet-cta-button-1`) → 새 진행 화면. 이 얼굴의 뒤로는 확인 없이 나간다.
- **낡은 초안.** 적용이 409 로 거절되면 「시간이 지나 이 대안은 지금 일정과 맞지 않아요」(testID: `planb-draft-stale`) + 「새 대안 보기」(testID: `planb-draft-stale-retry`), 「적용하기」 비활성.
- **끝난 세션 딥링크.** 이미 적용한 세션 id 로 `…/planb/draft?sessionId=<id>`. 「이미 끝난 재계획이에요」(testID: `planb-draft-closed`) + 「나가기」(testID: `planb-draft-closed-leave`). solving 경로면 testID: `planb-solving-closed`·`planb-solving-closed-leave`.

## Gotchas

- **[실화면 전용]** 진행·재계획안은 지도+시트 화면(접근성 캡처 타임아웃 가능 — 스크린샷+좌표). 지도 중심·핀 맞춤·시트 칸(진행·초안은 3칸 `[낮음, 45%, 88%]`, 초안은 88%로 연다)·다이얼로그 딤 덮임은 실화면으로만 확인된다. 진행 지도가 여행 동선이 아니라 기기 위치를 비출 수 있다(N-022).
- 결과 품질(엉뚱한 도시 장소·과한 추가)은 이 지도의 "동작한다" 판정과 별개다 — 화면 흐름을 판정하고 품질은 따로 기록한다(N-021·N-024·N-102). 판정 전 시뮬 위치가 여행 도시 안인지부터 확인한다.
- 「나가기」는 세션을 취소하지 않는다(DRAFT 로 남고 다음 요청이 닫는다). 진행 카드 「취소」만 서버 취소를 보낸다 — 둘을 같은 동작으로 세지 않는다.
- 진행·초안에서 새 요청을 시작하면 서버가 열린 세션을 취소한다. 같은 여행에서 두 세션을 동시에 검증하지 마라.
- 반영 시트 배지는 같은 앱 세션에서 초안을 본 경우에만 뜬다(서버가 확정 뒤 diff 를 비운다) — 앱 재시작 뒤 `?applied=` 딥링크면 배지 줄 없이 뜨는 게 정상이다.
- 적용 직후 허브 트리거 알약이 잠깐 남을 수 있다(서버 소비가 적용 응답보다 늦다 — 트리거 목록을 한 번도 받지 않은 채 적용한 경우).
- 하단 CTA 는 위치 testID(`sheet-cta-button-0`·`-1`)라 얼굴마다 뜻이 바뀐다 — 라벨(「적용하기」/「조건 바꿔 다시 짜기」/「다시 시도」)로 교차 확인한다.
- 다이얼로그 버튼 id(`…-leave-confirm-stay`·`…-leave`)는 루트 testID 에 꼬리가 붙은 값이라 `check.mjs` 대조 밖이다 — 루트 testID 로 다이얼로그를 확인한 뒤 라벨(「계속 기다리기」·「계속 보기」·「나가기」)로 누른다. `${slotKey}` 는 실행 값이다(`slotKey` = `YYYY-MM-DD#<poiId>`).
- 8분 상한·90초 느림 안내는 실시간 대기가 필요하다 — 기다리기 어렵다면 프리뷰 `planb-solving-slow` 로 표면만 보고 "실시간 미검증"으로 남긴다.
- 세션 id 를 얻는 방법·대안 없음/실패/낡음을 서버에서 재현하는 방법은 **확인 필요**.
- [실화면] 2026-10-31 — 실 AI 재계획 3회 모두 약 5초 만에 초안이 나왔다(폴백·실패 없음). 1회째(위치 화면 경유): `6곳 · 52.9km`, 빠지는 곳 2곳(건너뛴 곳·불탑사) → 「나가기」로 미적용. 2회째(요청 시트, 체력 저하·여유 있게·자유 입력): `5곳 · 55.3km`, 빠지는 곳 1곳(불탑사) → **적용**, 반영 시트 배지 「바뀐 곳 2곳」·「방문지 6→5곳」. 3회째는 제출 직후 「취소」를 눌렀는데 1초 안에 허브로 돌아와 취소가 실제로 갔는지 판별 못 했다.
- [실화면] 2026-10-31 — 진행 화면이 5초 안에 끝나 `solve-leave` 다이얼로그(「나가면 결과를 잃을 수 있어요」)·`solve-cancel` 실패 안내를 잡지 못했다. ‹ 를 누르는 사이 초안으로 바뀌어 초안 다이얼로그가 떴다.
- [실화면] 2026-10-31 — 없는 sessionId 로 `planb/draft`·`planb/solving` 을 열면 「이미 끝난 재계획이에요」가 아니라 오류 얼굴(`planb-draft-error`/`planb-solving-error`, 「재계획 상태를 불러오지 못했어요」·「네트워크를 확인해 주세요…」)이 뜬다. 「나가기」/「취소」 → 허브.
- [결함 의심 FM-L4-03] (판단 필요) 재계획안에서 이미 방문한 장소가 방문 시각이 아니라 계획 시각(`09:34–10:49`)·빨간 번호·「고정」으로 그려진다. 직전 진행 화면 시트는 같은 장소를 초록 번호·「06:58 방문」으로 그렸다.
- [결함 의심 FM-L4-05] 기록(j01)에서 건너뛴 장소가 2회째 초안에 다시 일정(`12:19–13:43`)으로 들어갔고 적용 뒤 허브에 예정으로 남는다. 건너뛴 방문은 허브에 [도착]이 서지 않아(ad7ec13ca) 새 일정에 갈 수 없는 칸이 생긴다. 서버 쪽은 475b3c476(재계획이 그날 건너뛴 곳을 제외 목록에 합침)로 고쳐졌다 — 재확인 필요. 1회째 초안은 같은 장소를 「빠지는 곳」으로 뺐다.
- [실화면] 2026-10-31 도달 불가 — `solve-slow`·`solve-cap`(90초·8분 대기 전에 끝남), `solve-error`·`draft-apply-failed`(네트워크 차단 불가), `draft-prepared`(트리거 없음), `draft-include-missing`(기회 없음), `draft-no-solution`·`draft-failed`·`draft-stale`(서버가 매번 성공 — 그래서 대안 없음·실패 얼굴의 콜드 진입 뒤로 무반응 의심도 재현 못 함), `draft-closed`(끝난 세션 id 를 얻을 길 없음).
