---
id: assistant
band: b
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/assistant/index.tsx
---

# AI 도우미

✦ AI 도우미(b01~b07)는 지금 화면 위에 투명 모달로 뜨는 채팅 시트다. 연 화면 종류(홈·여행 중 등)와 여행 id만 문맥으로 가져가 서버 세션을 열고, 사용자는 입력창이나 추천 칩으로 묻는다. 답은 글·검토·후보 장소·정보·범위 밖 안내·거절·폴백·일정 변경 제안 카드로 오고, 제안은 [적용]/[취소]할 수 있으며, 답마다 엄지 평가를 남긴다. 답에 붙은 다음 행동 버튼은 시트를 그 화면으로 바꾸거나(일정·편집·재계획 등) 시트 위에 상세를 쌓는다(장소·숙소·회고 등). 헤더 ⋮로 이번 여행의 도우미 변경 이력과 이전 대화를 보고 이력을 지울 수 있다.

## Sub-features

- `assist-loading` 세션 여는 중: 시트 안 로딩 표시.
- `assist-open-failed` 세션 열기 실패: "지금 도우미를 열지 못했어요. 지금 화면은 그대로 쓸 수 있어요." + [다시 시도].
- `assist-unauthorized` 세션 열기 401: 시트가 스스로 닫힌다(오류 화면 없음).
- `assist-ready` 여행 문맥 있음: 입력 카드 칩 "이 일정에 관해 질문하기"(숙소 상세면 "이 숙소에…", 숙소 검색이면 "이 검색 결과에…") — 누르면 추천 질문이 펼쳐진다.
- `assist-no-context` 여행 없이 연 일반 도움 모드: 칩이 "내가 할 수 있는 것 보기" 버튼, 추천 질문 펼침 없음.
- `assist-send` 입력(1~500자, 공백만 불가) 후 보내기 → 내 말풍선이 바로 뜨고 "답을 준비하고 있어요…" + [대기 취소].
- `assist-slow` 15초가 지나면 "응답이 늦어지고 있어요"로 바뀌고 [대기 취소]가 강조된다.
- `assist-cancel` [대기 취소] → 요청 중단, 입력 문구를 입력창에 되돌린다.
- `assist-send-failed` 보내기 실패 → "보내지 못했어요 · 임시 보관 중" + [다시 보내기](같은 턴 id로 재전송).
- `assist-rate-limited` 429 → "잠시 후 다시 시도해 주세요 (N초)", 그동안 보내기·칩 잠김.
- `assist-quick-reply` 서버가 준 추천 칩/응답 보기 칩을 누르면 그 항목으로 턴을 보낸다.
- `assist-capabilities` "내가 할 수 있는 것 보기" 칩 → 능력 안내 턴.
- `assist-cards` 답 종류별 카드: 검토(문제 + 고치기), 후보 장소(고르기·장소 보기), 정보, 범위 밖(외부 예약 이동), 거절, 폴백.
- `assist-fallback` 폴백 카드: 서버 안내 + [다시 시도](있을 때) + 항상 있는 출구 "도우미 없이 계속"(서버 라벨 우선) → 시트 닫기.
- `assist-proposal` 일정 변경 제안: 날짜별 변경 목록(지금/빠짐/추가/변경), 위반이 있으면 경고 카드와 함께 [적용] 없음.
- `assist-proposal-apply` [적용] → 성공 시 "적용했어요"; 실패 시 "이 제안은 지금 적용할 수 없어요" 또는 "적용하지 못했어요. 잠시 후 다시 시도해 주세요".
- `assist-proposal-stale` 일정이 바뀌었거나 만료된 제안 → "일정이 바뀌어 다시 제안할게요"(실패면 "적용하지 못했어요. 다시 제안할게요.") + [다시 제안].
- `assist-proposal-dismiss` [취소] → "취소했어요".
- `assist-next-action` 답 아래 다음 행동 버튼 — 갈 수 없는 것은 숨기고 "내가 할 수 있는 것 보기"로 대신한다.
- `assist-open-itinerary` 「일정 보기」류 → "일정을 확인하고 있어요" 뒤 일정의 알맞은 화면으로; 실패면 "일정을 불러오지 못했어요. 다시 눌러 주세요".
- `assist-feedback` 답 아래 엄지 👍/👎 — 👎이면 이유 칩(틀렸어요·도움이 안 돼요·원한 답이 아니에요·직접 적기) → "의견 고마워요".
- `assist-older` 긴 대화는 맨 위 "이전 대화 더 보기" → 로딩 → 실패 시 "이전 대화를 불러오지 못했어요" + 다시 시도.
- `assist-scroll-down` 위로 올리면 ↓(맨 아래로) 버튼.
- `assist-history` ⋮ → "이번 여행에서 도우미와 한 대화·변경이에요." + 변경 기록(없으면 "아직 도우미로 바꾼 것이 없어요") + "이전 대화" 목록 + [대화 이어서]/[이력 지우기]/[닫기].
- `assist-history-clear` [이력 지우기] → "대화 이력을 지울까요?" [취소]/[지우기].
- `assist-close` ✕·딤 탭·[닫기] → 시트 닫힘(뒤로 갈 곳이 없으면 홈 탭).

## How to get to it (user POV)

- 홈 인사 헤더의 ✦ 버튼(벨 왼쪽) — testID `home-dashboard-assistant`(접근성 라벨 "AI 도우미"). 계획 중·**여행 중**인 여행이 있으면 그 여행 문맥(`READY`), 없으면 일반 도움 모드(`NO_CONTEXT`) — 2026-10-31 진행 중 제주 여행 계정에서 `READY`(칩 접근성 라벨 "이 일정에 관해 질문하기, 제주특별자치도 1박 2일").
- 여행 중 허브 하단 바의 "챗봇" 칸 — testID `execution-live-bar-chatbot`(surface `LIVE`, 그 여행 문맥).
- 딥링크 `trippilot:///assistant?surface=HOME` · `trippilot:///assistant?surface=LIVE&tripId=<tripId>`(시뮬에선 `com.trippilot.travel://…`). 모르는 surface는 HOME으로 접힌다. `surface=HOME` 딥링크는 tripId 가 없어 홈 ✦ 와 달리 `NO_CONTEXT` 로 열린다(실측).
- 시트 안 이력의 "이전 대화" 행 → 그 여행 문맥으로 시트를 다시 연다(replace).
- 숙소 검색·일정 상세·숙소 상세에는 진입이 없다(옛 ✦ FAB은 TRIP-1553에서 삭제). 푸시·알림함에서 오는 경로도 없다.

## Driving it with agent-device

Preconditions:

- 로그인된 계정, 실제 도우미 서버(`dev-api` `/assistant/**`)와 AI가 살아 있어야 답이 온다. 앱은 가짜 어댑터 없이 항상 실서버를 쓴다.
- `READY` 얼굴은 홈에서 "계획 중" 여행이 있는 계정이 필요하다(홈 얼굴 판정은 홈 레인). `LIVE` 는 오늘이 여행 기간인 여행이 필요하다(trippilot-sim-qa §4 여행 중 준비). 여행이 없으면 홈 진입은 `NO_CONTEXT` 다.
- 제안 카드·검토·후보·폴백은 **서버·AI가 그 종류로 답할 때만** 나온다 — 정해진 질문으로 확정 재현할 수 없다. 나오지 않은 카드는 미확인으로 남기고, 생김새만 보려면 `_dev/preview` 의 `assistant-*` 키(예: `assistant-proposal`·`assistant-fallback-error`·`assistant-history-clear`·`assistant-rate-limited`·`assistant-open-failed`)를 쓴다(실서버 검증 아님).
- [적용]은 **실제 일정을 바꾼다** — 테스트 여행에서만 누르고 바뀐 것을 리포트 끝에 적는다. [지우기](이력 지우기)는 되돌릴 수 없다 — 다이얼로그 취소까지만.
- 메시지를 보낼 때마다 실제 LLM 호출이 나간다.

- **홈에서 열기.** 홈 → testID: `home-dashboard-assistant`. testID: `assistant-sheet-root`, 패널 testID: `assistant-sheet-mode-full`, 헤더 ✦(testID: `assistant-sheet-mark`)·⋮(testID: `assistant-history-toggle`, 라벨 "더보기")·✕(testID: `assistant-sheet-close`, 라벨 "닫기"). 처음엔 testID: `assistant-sheet-loading`, 이어 입력 카드 testID: `assistant-input`(placeholder "무엇이든 물어보세요…")와 칩 testID: `assistant-context-chip`.
- **문맥 판정.** 칩 문구가 "이 일정에 관해 질문하기"면 `READY`, "내가 할 수 있는 것 보기"면 `NO_CONTEXT`. `READY` 에서 칩을 누르면 testID: `assistant-chip-suggestions` 가 펼쳐지고 그 안에 testID: `assistant-quick-reply-capabilities` 또는 `assistant-quick-reply-<id>` 칩 — 서버가 준 칩은 id 가 `qr-` 로 시작한다(실측: 빈 대화에서 `assistant-quick-reply-qr-capabilities`·`-qr-review`·`-qr-next`·`-qr-weather`, 대화가 쌓인 뒤엔 앱 고정 `assistant-quick-reply-capabilities` 하나만).
- **허브에서 열기.** 여행 중 허브 → testID: `execution-live-bar-chatbot`("챗봇") → 같은 시트, 칩 "이 일정에 관해 질문하기".
- **보내기.** testID: `assistant-input` 에 한글을 `fill`, testID: `assistant-send`(라벨 "보내기")를 누른다 → 키보드가 내려가고 내 말풍선 testID: `assistant-user-bubble-pending`, 진행 줄 testID: `assistant-progress`("답을 준비하고 있어요…")와 testID: `assistant-progress-cancel`("대기 취소"), 보내기 버튼 testID가 `assistant-send-pending` 으로 바뀐다. 답이 오면 testID: `assistant-message-<id>`·`assistant-message-text-<id>`. 공백만 입력하면 보내기가 비활성.
- **느림·취소.** 15초 넘게 답이 없으면 testID: `assistant-progress-slow` "응답이 늦어지고 있어요". testID: `assistant-progress-cancel` → 입력창에 방금 문구가 돌아오고 "보내지 못했어요 · 임시 보관 중" + testID: `assistant-resend`("다시 보내기"). [다시 보내기]를 누르면 같은 턴이 다시 간다.
- **429.** 짧은 시간에 여러 번 보내 서버가 막으면 testID: `assistant-rate-limited` "잠시 후 다시 시도해 주세요 (N초)", 초가 줄다 0이면 사라진다. 그동안 보내기·칩 비활성.
- **능력 보기.** `NO_CONTEXT` 에서 칩 "내가 할 수 있는 것 보기"(testID: `assistant-context-chip`)를 누른다 → 그 문구로 턴이 나가고 능력 안내 답.
- **다음 행동.** 답 아래 testID: `assistant-next-action-<type>`(예: `assistant-next-action-OPEN_ITINERARY`)을 누른다 → `OPEN_ITINERARY` 는 testID: `assistant-itinerary-checking`("일정을 확인하고 있어요") 뒤 일정 화면으로 시트 자리가 바뀐다(실패면 testID: `assistant-itinerary-failed`). 장소·숙소·회고·요약·스타일은 시트 위에 상세가 쌓이고 뒤로 오면 같은 대화가 남아 있다.
- **제안 카드(서버가 제안할 때).** "남은 일정에서 ○○ 빼줘" 류 요청 → testID: `assistant-proposal-<proposalId>` 에 변경 목록(배지 "지금"/"빠짐"/"추가"/"변경"), 위반이면 testID: `assistant-proposal-violation-<n>` 와 함께 [적용] 없음. testID: `assistant-proposal-dismiss`("취소") → testID: `assistant-proposal-status` "취소했어요". 테스트 여행에서만 testID: `assistant-proposal-apply`("적용") → "적용했어요", 일정 화면에서 바뀐 슬롯을 한 번 더 읽는다. 실패면 testID: `assistant-proposal-error`, 낡은 제안이면 testID: `assistant-proposal-stale` + testID: `assistant-proposal-repropose`("다시 제안").
- **폴백 카드(서버가 줄 때).** testID: `assistant-fallback`, 다시 시도가 있으면 testID: `assistant-fallback-retry`, 출구 testID: `assistant-fallback-continue`(서버 라벨 또는 "도우미 없이 계속") → 시트가 닫힌다.
- **답 평가.** 답 아래 testID: `assistant-feedback-down-<messageId>` → 이유 칩 testID: `assistant-feedback-reason-WRONG-<messageId>` 등과 testID: `assistant-feedback-comment-<messageId>`("직접 적기"). 이유를 고르면 testID: `assistant-feedback-thanks-<messageId>` "의견 고마워요". 실패면 testID: `assistant-feedback-error-<messageId>`. 같은 엄지를 다시 누르면 평가가 풀린다.
- **이전 대화 더 보기.** 긴 세션에서 맨 위로 스크롤 → testID: `assistant-older-more`("이전 대화 더 보기") → testID: `assistant-older-loading` → 옛 메시지가 위에 붙는다. 실패면 testID: `assistant-older-error`. 위로 올린 상태에선 testID: `assistant-scroll-down`(라벨 "맨 아래로").
- **이력.** testID: `assistant-history-toggle` → testID: `assistant-history`, testID: `assistant-history-intro`, 기록이 없으면 testID: `assistant-history-empty` "아직 도우미로 바꾼 것이 없어요", 있으면 testID: `assistant-history-row-<id>`. 다른 세션은 "이전 대화" 아래 testID: `assistant-history-session-<id>`(제목 없으면 "여행 없이 한 대화"). testID: `assistant-history-continue`("대화 이어서") → 대화로 복귀.
- **이력 지우기(취소까지만).** testID: `assistant-history-clear`("이력 지우기") → testID: `assistant-history-clear-dialog` "대화 이력을 지울까요?"·"이미 반영한 일정 변경은 그대로 남아요." → testID: `assistant-history-clear-cancel`("취소"). testID: `assistant-history-clear-confirm`("지우기")은 누르지 않는다.
- **열기 실패.** (서버 장애 때) testID: `assistant-open-failed` 문구와 testID: `assistant-open-retry`("다시 시도") → 재조회.
- **닫기.** testID: `assistant-sheet-close`, 딤 testID: `assistant-sheet-scrim`(라벨 "도우미 닫기"), 이력의 testID: `assistant-history-close`("닫기") 셋 다 시트 전체를 닫고 연 화면으로 돌아간다.

## Gotchas

- "새 대화" 버튼은 없다. 대화를 비우는 길은 이력 지우기뿐이고, 세션은 여행(문맥)마다 하나다.
- 시트는 끌어 내려 닫을 수 없다. 딤 전면 덮임·키보드가 입력 카드를 밀어 올리는지·키보드 모드(`assistant-sheet-mode-compact`/`-shrunk`) 전환은 실화면으로만 확인된다. [실화면 전용]
- 대화가 없는 상태에서 입력칸을 눌러 키보드가 뜨면 패널이 `compact` 로 줄어 헤더(✕·⋮)와 메시지 목록이 사라진다 — 닫기 버튼을 못 찾으면 키보드부터 내린다. [실화면 전용]
- 시트는 루트 투명 모달(전환 없음)이다. 그 위에 push한 상세는 native-stack이 모달로 승격해 **아래에서 올라오는 카드**로 뜬다(traps-shell) — 정상. 상세의 탭바 등으로 나가면 시트도 함께 걷힌다.
- 답·카드 종류는 AI 판단이라 같은 질문도 결과가 다르다 — 지난 QA(20261021 N-025·N-090·N-103)처럼 기본 요청도 실패할 수 있다. "카드가 안 나왔다"를 화면 결함으로 판정하기 전에 서버 응답 종류를 의심한다.
- 컨텍스트 칩의 보이는 문구는 surface별 고정 라벨이고, 서버가 준 문맥 문구는 **접근성 라벨에만** 실린다(`"<라벨>, <서버 문구>"`) — 화면 글자로 찾으면 안 나온다.
- 사용자 낙관 말풍선 testID는 `assistant-user-bubble-pending` 이고 답이 오면 서버 id 말풍선으로 바뀐다. 대부분의 testID가 메시지·제안 id를 붙여 조립된다(`assistant-message-<id>` 등) — 접두로 찾는다.
- 401이면 오류 없이 시트가 그냥 닫힌다 — "열었는데 바로 사라짐"은 인증 문제 신호다. `/assistant` 는 HOME 가드 밖이라 미인증 딥링크로도 열리고, 세션 생성 401로 닫힌다.
- 이력 지우기 실패 시 다이얼로그가 그대로 남고 아무 안내가 없다(결함 후보) — 확정을 누르지 않으므로 QA에선 보통 안 만난다.
- [적용] 연타는 ref 잠금이 막고 이중 적용의 최종 차단은 서버다 — 연타 결과는 실화면 전용. 다음 행동 push 연타는 `guardPress` 가 막는다. [실화면 전용]
- 이력 패널 문구에 내부 용어 "솔버"가 보이는 것은 지난 QA(N-028)의 현 상태다. 같은 리포트의 "이전 대화에 지금 여행이 섞인다" 지적은 같은 여행의 다른 세션이면 다시 보일 수 있다(확인 필요).
- 이름이 진입점마다 다르다 — 홈 ✦ 라벨 "AI 도우미", 허브 칸 "챗봇". 같은 시트다.
- [실화면] 2026-10-31 [결함 의심 FM-L6-02] (판단 필요, low) `대기 취소` → `다시 보내기` 로 답이 정상 도착한 뒤에도 입력창에 방금 보낸 문구("부산 날씨 어때")가 그대로 남는다 — 사용자가 그대로 다시 보내 중복 질문이 될 수 있다. 증거 `assistant/14-resend-reply.png`.
- [실화면] 2026-10-31 "이전 대화"에 지금 여행(제주)의 다른 세션이 함께 보였다 — 위 "확인 필요"는 실화면에서 그렇다. `OPEN_ITINERARY` 는 진행 중 여행이라 여행 중 허브로 갔고 "일정을 확인하고 있어요"는 너무 빨라 못 잡았다.
- [실화면] 2026-10-31 도달 불가 — `assist-loading`·`assist-open-failed`·`assist-unauthorized`·`assist-slow`·`assist-send-failed`·`assist-rate-limited`(실패·지연 유도 수단 없음, 연타 범위 밖), `assist-cards`·`assist-fallback`·`assist-proposal*`(서버가 글 답만 줌), `assist-older`·`assist-scroll-down`(긴 세션 없음).
