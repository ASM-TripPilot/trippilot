---
id: itinerary-method
band: h
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/itinerary/method.tsx
---

# 일정 만드는 방식 고르기

여행을 만든 뒤(위저드 3/4) 일정을 어떻게 짤지 세 방식 중 하나를 고른다 — 완전 AI가 짜기, AI와 같이 짜기, 직접 짜기. 이 화면은 생성 요청을 직접 보내지 않고 다음 화면으로 보내기만 한다. 같이 짜기는 이미 일정이 있거나 조회 중이면, 완전 AI는 이 여행의 생성이 도는 중이거나 조회 중이면 인라인 확인 카드를 먼저 띄운다. 1박 이상 여행이면 거점 숙소를 다시 고르는 링크도 보인다.

## Sub-features

- `method-full-ai` 완전 AI 카드 → 꼭 갈 곳(모드 없음)으로 간다. 세부는 `must-visits.md`·`ai-generate.md`.
- `method-copick` AI와 같이 짜기 카드 → 꼭 갈 곳(`mode=CO_PLAN`)으로 간다. 세부는 `copick.md`.
- `method-manual` 직접 짜기 카드 → 직접 짜기 편집기로 간다. 세부는 `manual-plan.md`.
- `method-regenerate-confirm` 같이 짜기를 눌렀는데 기존 일정이 있거나 아직 조회 중이면 덮어쓰기 확인 카드가 먼저 뜬다.
- `method-inprogress-confirm` 이 여행의 생성이 도는 중(서버가 진행 세션 id를 준 상태)이거나 조회 중이면 완전 AI·같이 짜기 둘 다 "생성 중" 문구의 같은 확인 카드가 뜬다.
- `method-confirm-cancel` 확인 카드의 [취소]는 카드만 닫는다. [계속]은 누른 방식대로 간다.
- `method-rebase` "거점 숙소 다시 고르기" 링크 → 거점 숙소 화면(여행 단위)으로 push. 0박(당일치기)이면 링크가 없다.
- `method-back` 앱바 뒤로 → 이전 화면.
- `method-blocked` (현재 도달 불가) 다른 여행 생성 중 차단 안내 — 서버 판정이 없어 항상 꺼져 있다.

## How to get to it (user POV)

- 여행 만들기 2/4(거점 숙소)의 출구 CTA → 2/4를 걷고 이 화면을 push한다. 여행 만들기 기능 파일 소관.
- 여행 만들기 1/4에서 0박(당일치기) 여행을 만들면 2/4를 건너뛰고 곧장 이 화면으로 온다.
- 거점 숙소 화면에서 돌아올 때 히스토리가 없으면 이 화면으로 replace.
- 홈 히어로 카드(testID: `home-trip-hero-cta`)·일정 탭 카드(testID: `my-trip-card-${tripId}`)·기록 달력에서 **일정이 없는(404)** 여행을 누르면 이 화면으로 push.
- 완성 일정 보기 화면의 "아직 일정 없음" 얼굴 CTA(testID: `itinerary-plan-create-cta`) → push. `itinerary-view.md` 소관.
- 여행 중 허브의 "아직 일정이 없어요" 얼굴 [일정 만들기](testID: `execution-live-notfound-create`) → push.
- 도우미 시트의 다음 행동 `OPEN_ITINERARY_METHOD`·`OPEN_REGENERATE`, 또는 일정 열기에서 404일 때.
- 리다이렉트: 생성 중 화면을 모드 없이(관찰 모드) 열었는데 일정이 404면 이 화면으로 replace.
- 딥링크: `/trips/{tripId}/itinerary/method`.

## Driving it with agent-device

Preconditions:

- 로그인 상태, 서버에 이 사용자의 여행 하나가 있다. **일정이 없는(404) 여행**과 **일정이 이미 있는 여행** 두 개를 준비하면 확인 카드 분기를 둘 다 볼 수 있다.
- "거점 숙소 다시 고르기"를 보려면 1박 이상 여행이어야 한다.
- 이 화면은 AI를 부르지 않는다 — AI 서버 모드(fake/http)와 무관하다.

- **화면 확인.** 진입하면 앱바 제목 `일정 만들기`, 진행 표시 3/4, 본문 제목 `어떻게 만들까요?`, 부제 `마음에 드는 방식을 골라주세요`, 하단 안내 `어떤 방식이든 마지막엔 직접 고칠 수 있어요`가 보인다. 소요시간 문구가 없다.
- **세 카드.** testID: `itinerary-method-fullai`(제목 `완전 AI가 짜기`), testID: `itinerary-method-copick`(`AI와 같이 짜기`), testID: `itinerary-method-manual`(`직접 짜기`) 세 카드가 같은 모양으로 보인다.
- **완전 AI(일정 없음).** 404 여행에서 `itinerary-method-fullai`를 누른다. 확인 없이 꼭 갈 곳 화면(제목 `꼭 갈 곳`)이 열린다.
- **같이 짜기(일정 없음).** 404 여행에서 `itinerary-method-copick`을 누른다. 확인 없이 꼭 갈 곳 화면이 열리고, 안내가 `일정은 이어서 함께 골라요`다.
- **같이 짜기(일정 있음) → 덮어쓰기 확인.** 일정이 있는 여행에서 `itinerary-method-copick`을 누른다. 같이 짜기 카드 바로 아래 testID: `itinerary-method-regenerate-confirm`이 뜨고 제목 `기존 일정을 새로 만들어요`, 본문 `AI와 같이 다시 짜면 지금 일정이 새 초안으로 바뀌어요. 계속할까요?`다.
- **확인 취소.** testID: `itinerary-method-regenerate-confirm-cancel`(`취소`)을 누른다. 카드가 사라지고 화면에 그대로 남는다.
- **확인 계속.** 다시 열고 testID: `itinerary-method-regenerate-confirm-continue`(`계속`)를 누른다. 꼭 갈 곳 화면(CO_PLAN 안내)으로 간다.
- **생성 중 확인.** 생성이 도는 여행으로 이 화면에 들어와(홈·일정 탭 카드는 생성 중이면 생성 화면으로 보내므로 딥링크나 도우미 `OPEN_REGENERATE`로 들어온다) `itinerary-method-fullai`를 누른다. 같은 확인 카드가 제목 `지금 만들고 있는 일정이 있어요`, 본문 `새로 만들면 진행 중인 생성을 멈추고 새 초안으로 바꿔요. 계속할까요?`로 뜬다.
- **직접 짜기.** `itinerary-method-manual`을 누른다. 확인 없이 직접 짜기 편집기(시트 제목 `일정 만들기`)가 열린다.
- **거점 다시 고르기.** 1박 이상 여행에서 testID: `itinerary-method-rebase`(`거점 숙소 다시 고르기`)를 누른다. 거점 숙소 화면이 push되고, 그 화면의 CTA로 돌아오면 이 화면이 다시 보인다.
- **당일치기.** 0박 여행으로 들어오면 `itinerary-method-rebase`가 트리에 없다.
- **뒤로.** testID: `itinerary-method-back`을 누른다. 이전 화면으로 돌아간다.

## Gotchas

- 완전 AI는 **이미 완성된 일정이 있어도** 확인 없이 진행한다 — 덮어쓰기 확인은 같이 짜기에만 있다. 완전 AI의 확인 카드는 "생성 중"일 때만이다.
- 확인 카드는 바텀시트가 아니라 같이 짜기 카드 아래 인라인으로 그려진다. 완전 AI 카드를 눌러 떴어도 위치는 같이 짜기 카드 아래다.
- 조회가 끝나기 전(로딩)에 같이 짜기·완전 AI를 누르면 일정 유무와 상관없이 확인 카드가 뜬다(fail-safe). 새 여행에서 확인이 떴다면 조회가 늦은 것이니 잠시 기다려 다시 시도한다. 404는 재시도하지 않아 보통 1 RTT 안에 끝난다.
- "생성 중" 판정은 일정의 `generationState`가 아니라 서버가 주는 진행 세션 id 유무다. PARTIAL인데 세션이 없으면(멈춘 생성) 생성 중이 아니다 — 확인 카드가 안 뜬다.
- testID: `itinerary-method-blocked-reason`·`itinerary-method-goto-active`는 서버 판정이 없어 항상 꺼져 있다(실화면 도달 불가).
- 거점 링크는 여행 조회가 끝나기 전·실패 시에도 보인다(0박인지 모를 때 종전대로 노출).
- [실화면] 2026-10-31 생성 중 확인 카드는 완전 AI 생성을 시작하고 ‹ 로 백그라운드로 뺀 직후 `com.trippilot.travel://trips/{id}/itinerary/method` 딥링크로 들어와 `itinerary-method-fullai` 를 눌러 띄웠다. 당일치기(0박) 여행에서 `itinerary-method-rebase` 가 트리에 없음을 확인했다. 3/4 ‹ 는 위저드에서 왔으면 1/4로 간다(2/4 아님).
- [실화면] 2026-10-31 도달 불가 — `method-blocked`(서버 판정 없음, 지도 기대대로 항상 꺼짐).
