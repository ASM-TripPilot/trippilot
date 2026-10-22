# U8 Conversational Assistant — Frontend Components

> **아키텍처 정본 = `frontend/README.md`, 현재 배치의 사실 정본 = `frontend/docs/structure.md`(+ 리포).** 층 규약(FSD v2.1)을 옮겨 적지 않는다. 이 문서는 **어느 슬라이스에 무엇을 두고, 무엇을 서버에서 받고, 무엇을 재판정하지 않는가**만 정한다.
> **화면 정본**: 라이브 Figma 밴드 `b` 10프레임(2026-10-12 시각 확인 — business-logic-model 머리말). **✦ FAB는 Figma에 없다**(G-U8-9) — 배치는 BR-U8-50~53이 정한다.
> **현 상태**: `assistant`·`어시스턴트` 매치 0 — 라우트·page·feature 전부 신설. 생성 API 클라에는 `changeLogEntrySourceType.ts`의 `ASSISTANT` 값만 있다.

---

## 0. 층 배치

| 층 | 경로 | 담는 것 |
|---|---|---|
| 라우트 | `frontend/app/assistant/index.tsx` | 얇은 래퍼 — params(`tripId?`·`surface`)만 읽어 `@/pages/assistant/assistant-sheet`에 넘긴다 |
| page | `frontend/src/pages/assistant/assistant-sheet/` | 시트 화면 전체(대화·카드·입력·이력 보기). **카드 컴포넌트는 이 슬라이스 `ui/`에 둔다** — 소비처가 이 화면 하나라 feature로 올리지 않는다(FSD "로컬에 두기") |
| feature | `frontend/src/features/assistant/` | 서버 상태 훅(세션·메시지·턴·제안 적용·이력 삭제) + `nextAction` → 라우트 매핑 순수 함수 |
| feature | `frontend/src/features/open-assistant/` | ✦ FAB(`ui/AssistantFab.tsx`) + 스택 배치 계산(`model/fabStack.ts`) — **4개 page가 쓴다** |
| shared | `frontend/src/shared/ui/Toast.tsx` | 토스트 바닥 오프셋을 화면이 올릴 수 있게 확장(G-U8-10, BR-U8-52) |
| shared | `frontend/src/shared/api/generated/` | `assistant` 태그 코드젠(`pnpm codegen`, 원천 `backend/docs/design/openapi.yaml`) |

- features 간 직접 import 금지 — `open-assistant`(FAB)는 `assistant`(훅)를 import하지 않는다. FAB는 **라우팅만** 한다(`router.push('/assistant', {surface, tripId})`).
- 진입 화면 4개 page(`pages/home`·`pages/stay/stay-search`·`pages/itinerary/itinerary-plan`·`pages/live/live-itinerary`)가 `features/open-assistant`를 import한다(page → feature, 정방향).

## 1. 라우트

| 파일 | 화면 | 비고 |
|---|---|---|
| `frontend/app/assistant/index.tsx` | `b01`~`b07` 전부(한 시트, 상태로 갈림) | 루트 `Stack`에 `presentation: 'transparentModal'`로 등록 — `(tabs)` 밖이라 **탭바가 가려진다**(BR-U8-01). 뒤 화면은 딤 아래 그대로 남는다(Figma `b*`의 회색 딤 + 뒤 화면 헤더) |

- params: `surface`(`HOME`\|`STAY_SEARCH`\|`ITINERARY`\|`LIVE`\|`STAY_DETAIL`) · `tripId?`. **그 외 화면 상태를 params로 넘기지 않는다**(BR-U8-02).
- `b06` 이력은 별도 라우트가 아니라 시트 안 보기 전환(`view = CHAT | HISTORY`) — 시트를 닫았다 여는 깜빡임을 피한다.
- 미인증 딥링크: `/assistant`는 `(tabs)` 밖이라 guard에 안 걸릴 수 있다(U4 FD §1 경고와 같은 함정). 데이터는 서버 401이 막고, 페이지는 세션 생성 401이면 시트를 닫는다.

## 2. 컴포넌트 계층 (`pages/assistant/assistant-sheet/ui/`)

```
AssistantSheetPage            (useAssistantSession · useSendTurn · 판정 1회: resolveSheetState)
+-- AssistantSheetView        (props only)
    +-- SheetHeader           ✦ AI 도우미 · [닫기]
    +-- ContextChip           서버가 준 칩 문구 그대로 (BR-U8-03)
    +-- MessageList           (FlatList, 역순)
    |   +-- UserBubble
    |   +-- AssistantBubble   템플릿 문구
    |   +-- ReviewCard        b01 review — 요약 표 + 문제 행(경고 아이콘 + fix 링크)
    |   +-- CandidateCard     대체 후보(이름 · 거리 · 이유)
    |   +-- ProposalCard      b02 — 지금/변경 행 · [적용] [취소] · 각주
    |   +-- InfoCard          다음 장소 · 거리 · 장소 · 날씨
    |   +-- ScopeCard         b03 — 외부 위임 카드(OTA) · "솔버로 확인"
    |   +-- RefusalNotice     b04 — 거절 + "제가 할 수 있는 것"
    |   +-- FallbackNotice    b05 — 오류 + [다시 시도] + "도우미 없이 계속"
    |   +-- ActionLogRow      b06 — 적용된 필터/반영된 변경 행
    +-- HistoryView           b06 — 세션의 ACTION_LOG 목록 · [대화 이어서] [이력 지우기]
    +-- ProgressRow           진행 표시 + [대기 취소] (BR-U8-44)
    +-- QuickReplyBar         서버 발급 quick reply (+ "내가 할 수 있는 것" 상시)
    +-- Composer              입력창(≤500) + 보내기
```

| 컴포넌트 | props | 재판정 금지 |
|---|---|---|
| `ProposalCard` | `diff[]`·`violations[]`·`applyHint`·`status`·`onApply`·`onDismiss` | **위반이 있으면 [적용]을 그리지 않는다**는 판정은 서버가 `violations` 비어 있음으로 이미 내렸다 — 카드는 `violations.length === 0`만 본다(BR-U8-31). 시각·거리는 `diff`의 문자열 그대로, 소요시간 계산 함수 없음(BR-U8-35) |
| `ReviewCard` | `summary`·`problems[]` | 문제를 클라가 추가 판정하지 않는다(BR-U8-14) |
| `FallbackNotice` | `cause`·`nextActions[]` | `cause`별 문구는 서버 템플릿. 클라는 아이콘만 고른다 |
| `QuickReplyBar` | `replies[]`·`onPick` | 클라가 quick reply를 만들지 않는다 — `SHOW_CAPABILITIES` 하나만 상시 예외(BR-U8-04) |

## 3. 상태

| 상태 | 위치 | 비고 |
|---|---|---|
| 세션·메시지 | TanStack Query — `['assistant','session',tripId ?? 'general']` · `['assistant','messages',sessionId]` | 서버 정본. 시트를 다시 열면 캐시 → 재조회 |
| 보내는 중인 턴 | `useSendTurn` 뮤테이션 + 낙관적 사용자 버블 | `clientTurnId`(uuid)는 **보내기 직전 1회 생성**해 재시도에 재사용(멱등, INV-U8-05) |
| 대기 취소 | `AbortController` | 취소 시 낙관 버블을 "보내지 못함 · 다시 보내기"로 바꾸고 입력 복원. 서버 결과는 다음 조회에서 합쳐진다(BR-U8-44) |
| 임시 보관 | 뮤테이션 실패 상태 | "저장 대기" 표시 + [다시 보내기] — 같은 `clientTurnId`로(BR-U8-21) |
| 시트 보기 | 페이지 로컬 `useState` (`CHAT`\|`HISTORY`) | Zustand 불필요 |
| 15s 타이머 | 페이지 로컬 | 넘으면 진행 표시 유지 + [대기 취소] 강조 |

**판정은 페이지에서 1회**: `resolveSheetState(session, messages, mutation)` → `LOADING`·`READY`·`OPEN_FAILED`·`NO_CONTEXT`(`b07`). 뷰는 재판정하지 않는다(U4 `resolveReplanState` 선례).

## 4. 상호작용 흐름

1. **열기**: 진입 화면 ✦ 탭 → `/assistant?surface=…&tripId=…` → `POST /assistant/sessions` → 칩·직전 메시지·시작 quick reply 렌더. 실패면 `OPEN_FAILED` 오류 + [다시 시도], 닫으면 원래 화면 그대로(BR-U8-07).
2. **발화**: 입력 → `POST /sessions/{id}/turns {clientTurnId, input:{type:TEXT,text}, screen}` → 응답 메시지들을 목록에 붙인다.
3. **quick reply**: 탭 → `input:{type:ACTION, quickReplyId}`. `SEND_TEXT` 종류만 라벨을 사용자 버블로 보인다.
4. **제안 적용**: `ProposalCard` [적용] → `POST /assistant/proposals/{id}/apply` → 성공 시 `ACTION_LOG` + "일정 보기" next action, **일정 쿼리 무효화**(`['itinerary', tripId]` 등 — 뒤 화면이 새 값으로 다시 그려진다 = 대화 ↔ 화면 상태 일관). 409 `STALE`이면 카드를 "낡음"으로 바꾸고 [다시 제안] quick reply.
5. **next action**: `features/assistant/model/nextActionRoute.ts`가 `type` → 라우트로 바꾼다(아래 표). 이동 전에 시트를 닫는다(`router.dismiss` 후 `push`).
6. **이력**: 헤더 메뉴 → `HISTORY` 보기 → [이력 지우기] 확인 다이얼로그 → `DELETE /assistant/sessions/{id}` → 일반 시작 상태로.

### 4.1 `nextActionRoute` (closed-set — 모르는 값은 `null` → `SHOW_CAPABILITIES`로 대체, BR-U8-06)

| `type` | 라우트 |
|---|---|
| `OPEN_ITINERARY` | `/trips/[tripId]/itinerary` |
| `OPEN_ITINERARY_EDIT` | `/trips/[tripId]/itinerary/edit` |
| `OPEN_ITINERARY_METHOD` · `OPEN_REGENERATE` | `/trips/[tripId]/itinerary/method` |
| `OPEN_REPLAN` | `/trips/[tripId]/planb` |
| `OPEN_LIVE` | `/trips/[tripId]/live` |
| `OPEN_PLACE` | `/trips/[tripId]/live/place/[poiId]`(여행 중) · `/explore/places/[poiId]`(그 외) |
| `OPEN_STAY_SEARCH` | `/stays` |
| `OPEN_OTA` | 숙소 상세 `/stays/[stayId]`로 보낸다 — 제휴 고지 시트 `OtaChoiceSheet`는 `pages/stay/stay-detail/ui/`의 **page 로컬 컴포넌트**라 다른 page가 import할 수 없고(FSD), 외부 URL을 도우미가 직접 열면 고지(BR-U1-30)를 건너뛴다 |
| `OPEN_REFLECTION` · `OPEN_TRIP_SUMMARY` · `OPEN_STYLE` | `/trips/[tripId]/records/reflection/…` · `/trips/[tripId]/records/summary` · 마이 스타일(`pages/record/travel-style` 라우트) |
| `CREATE_TRIP` | 여행 만들기 1단계 |
| `RESTORE_REVISION` | 일정 리비전 화면(h36) |
| `RETRY_TURN` · `CONTINUE_WITHOUT_ASSISTANT` · `SHOW_CAPABILITIES` | 시트 내부 동작(재전송 · 시트 닫기 · 능력 목록) |

## 5. ✦ FAB (`features/open-assistant/`)

| 파일 | 책임 |
|---|---|
| `ui/AssistantFab.tsx` | 56×56 원형, ✦ 글리프는 SVG(`*Glyphs.tsx` 관례), `accessibilityLabel="AI 도우미"`. props: `surface`·`tripId?`·`bottom` |
| `model/fabStack.ts` | 순수 함수 `assistantFabBottom(stack)` · `toastBottomWith(stack)` — 기존 단 수(0·1·2)에서 ✦ 바닥과 토스트 바닥을 계산(BR-U8-51·52, **PBT-U8-F1**) |

| 진입 화면 | 기존 스택 | ✦ 위치 | 토스트 |
|---|---|---|---|
| 홈 `pages/home/ui/HomeScreen.tsx` | `home-create-trip-fab` 84 · 담은 곳 미니 FAB 줄 152 | **220** | 288 |
| 숙소 검색 `pages/stay/stay-search/ui/StaySearchScreen.tsx` | `stay-search-fab-register` 84 · `-fab-saved` 152 | **220** | 288 |
| 일정 상세 `pages/itinerary/itinerary-plan` | FAB 없음(탭 밖) | 화면 하단 안전영역 + 24 | 기본 위치 유지(겹침 없음) — 실측 확인 |
| 여행 중 허브 `pages/live/live-itinerary/ui/LiveHubView.tsx` | `execution-live-fab-anchor`(시트 윗변을 따라 움직임) | 같은 앵커 열의 **맨 위**(일정 수정 FAB 위 12) | 앵커 위로 — 시트 위치에 따라 변하므로 6-b 실기 확인 |

- 메모 시트·키보드·다른 시트가 열리면 ✦를 트리에서 뺀다(BR-U8-53 — 기존 `fabHidden`·TRIP-1280 규칙).
- ⚠️ **jest로 겹침을 판정할 수 없다** — 배치 숫자는 `fabStack.ts` 순수 함수로 굳히고, 실제 겹침은 6-b 실기 몫(`Toast.tsx` 머리 주석과 같은 처지).

## 6. API 연동 (backend 신설 — `backend/docs/design/openapi.yaml`에 추가할 초안)

| 훅 (`features/assistant/model/`) | 메서드 · 경로 | 요청 | 응답 |
|---|---|---|---|
| `useAssistantSession(tripId?)` | `POST /api/v1/assistant/sessions` | `{tripId: uuid \| null}` | `{session{id, tripId, contextChip}, messages[], quickReplies[]}` — 있으면 이어 열기(멱등) |
| `useAssistantSessions()` | `GET /api/v1/assistant/sessions` | — | `[{id, tripId, tripTitle?, lastTurnAt}]` — 이전 여행 대화로 돌아가기 |
| `useAssistantMessages(sessionId)` | `GET /api/v1/assistant/sessions/{sessionId}/messages?before=&limit=` | — | `{messages[], nextBefore?}` |
| `useSendTurn(sessionId)` | `POST /api/v1/assistant/sessions/{sessionId}/turns` | `{clientTurnId, input:{type:TEXT, text} \| {type:ACTION, quickReplyId}, screen:{surface}}` | `{messages[](USER 1 + ASSISTANT ≥1), quickReplies[]}` · 429 `Retry-After` |
| `useApplyProposal()` | `POST /api/v1/assistant/proposals/{proposalId}/apply` | — | `{proposal{status}, messages[](ACTION_LOG 등)}` · 409 `STALE`\|`EXPIRED`\|`NOT_APPLICABLE` |
| `useDismissProposal()` | `POST /api/v1/assistant/proposals/{proposalId}/dismiss` | — | `{proposal{status}}` |
| `useClearSession()` | `DELETE /api/v1/assistant/sessions/{sessionId}` | — | 204 |

**메시지 DTO**(공통): `{id, role, kind, text?, payload?, nextActions[{type,label,params}], quickReplies?, proposal?{id, status, diff[], violations[], applyHint}, createdAt}`. **`duration` 필드는 어떤 DTO에도 없다**(INV-3).

## 7. 폼 검증 (UX 사본 — 권위는 서버)

| 대상 | 규칙 |
|---|---|
| 입력창 | 1..500자, 공백만이면 보내기 비활성. 금칙어 판정은 **서버만**(BR-U8-23) — 클라 사전 없음 |
| 연타 | 보내는 중엔 보내기 비활성(`inFlight`), [적용]도 뮤테이션 진행 중 비활성 — 이중 적용은 서버 상태기계가 최종 차단(INV-U8-08) |
| 429 | `Retry-After` 초 동안 보내기 비활성 + 남은 초 표시 |

## 8. testID (규약 `{feature}-{screen}-{role}` — 제안값)

```
assistant-fab
assistant-sheet · -close · -context-chip · -history-toggle
assistant-message-{messageId} · assistant-user-bubble-{messageId}
assistant-review-card · -review-problem-{index} · -review-fix-{index}
assistant-candidate-{poiId}
assistant-proposal-{proposalId} · -proposal-apply · -proposal-dismiss · -proposal-violation-{index} · -proposal-stale
assistant-scope-card · -scope-ota
assistant-refusal · assistant-capabilities
assistant-fallback · -fallback-retry · -fallback-continue
assistant-progress · -progress-cancel
assistant-quick-reply-{quickReplyId}
assistant-next-action-{type}
assistant-input · -send · -send-pending · -rate-limited
assistant-history · -history-row-{messageId} · -history-clear · -history-continue
```

> **[공백]** 제안값이다. 구현이 확정한 값이 다르면 이 절에 소급 기록한다.

## 9. 테스트 범위와 사각

| 대상 | 수단 |
|---|---|
| `fabStack.ts`·`nextActionRoute.ts`·`resolveSheetState` | 단위 + fast-check(**PBT-U8-F1**, PBT-U8-8 FE 몫 — 카드 렌더 모델에 소요시간 문자열 0) |
| 시트 흐름(열기·발화·적용·STALE·폴백) | `pnpm test:integration` — MSW로 서버 응답 고정 |
| **사각(6-b 실기 전용)** | 투명 모달의 딤·뒤 화면 터치 차단 · 키보드가 입력창을 밀어 올리는지 · ✦와 토스트·탭바 실제 겹침 · `live` 앵커를 따라 움직이는 ✦ (repo-traps "바텀시트·오버레이 다이얼로그" 계열 — jest가 원리적으로 못 본다) |
| 이력 지우기 확인 다이얼로그 | testID 트리 + 확정 전 mutate 0회까지만 자동 심판(오버레이 다이얼로그 사각과 같은 처지) |

---

## [개정 · 2026-10-12 · U8 FE 구현 (TRIP-1318 서브 1319~1328)]

> 원문 위 절들은 보존한다(append-only). FE 구현이 현 리포 규칙(`frontend/README.md` pages-first·Steiger, 실제 라우트·테스트 목)과 부딪힌 곳은 **구현을 우선**했고(사용자 결정 2026-10-12), 아래가 그 어긋남의 기록이다. 서버(BE assistant 모듈·ai `/interpret`)는 미구현이라 FE 는 가짜 어댑터로 끝까지 구현했다 — 교체 지점 1곳.

| # | 원문 | 구현(근거 코드) | 이유 |
|---|---|---|---|
| R1 | §0 `features/assistant/` 에 서버 상태 훅 + `nextActionRoute` | `frontend/src/pages/assistant/assistant-sheet/{api,model}/` — `assistantContract.ts`·`assistantPort.ts`·`assistantClient.ts`(교체 지점)·`fakeAssistantAdapter.ts`·`assistantSamples.ts`·`model/assistantQueries.ts`·`nextActionRoute.ts`·`resolveSheetState.ts` | 소비처가 시트 page 하나 — README "pages first"(세 조건 미충족) + Steiger `insignificant-slice`(소비처 1곳 feature 는 `pnpm fsd` 실패) |
| R2 | §6 `shared/api/generated` 코드젠 | 손으로 옮긴 계약 타입(`assistantContract.ts`) + `AssistantPort` 인터페이스 + `FakeAssistantAdapter`. 실패는 `AssistantApiError{code: UNAUTHORIZED·RATE_LIMITED·STALE·EXPIRED·NOT_APPLICABLE·ABORTED·SERVER}` 로 정규화 | openapi 에 assistant 태그 0건. BE 개통 시 http 어댑터를 만들어 `assistantClient.ts` 한 줄 교체 |
| R3 | §6 메시지 DTO | 추가 필드: `footnote?`(Figma `* …` 각주). payload 모양: REVIEW `{title, summary[{label,value}], problems[{slotKey?, reason, fixAction}]}` · CANDIDATES `{candidates[]}` · INFO `{infoKind, title, rows[]}` · REFUSAL `{category, capabilities}` · FALLBACK `{cause, notice?}` · ACTION_LOG `{what, tag?(FILTER/CHANGE/REVIEW), detail?, revisionId?, changeLogEntryId?}` | 클라가 문구를 조립하지 않게(DEC-U8-6) 서버가 표시 문자열을 지어 보내는 모양으로 확정 — BE 계약 초안에 반영 요청 |
| R4 | §5 FAB 이 `router.push('/assistant', …)` | `features/open-assistant` 의 `AssistantFab` 은 `onPress` 만 올리고, 목적지는 `assistantHref(surface, tripId)` 로 각 page 가 push | 진입 page 마다 expo-router 사용 방식(`useRouter` vs 정적 `router`)과 테스트 목이 달라 FAB 이 라우터를 직접 물면 형제 테스트가 깨진다 |
| R5 | §5 일정 상세 ✦ = 하단 안전영역 + 24 | 지도 우상단, 일차 칩 아래(`MapSheetShell` `mapCard` 슬롯) — `ItineraryPlanPage.tsx` | 하단은 MapSheetShell 하단 CTA 바(일정 저장하기·일정 수정)와 시트가 차지 — FD 값이면 겹친다. Figma `b08-[✦] 진입 FAB · 일정 상세` 같은 값 |
| R6 | §5 허브 ✦ = 앵커 열 맨 위 | 그대로 — 단 앵커 윗변을 ✦ 몫(56+12)만큼 올려 수정 FAB 의 시트 추종 자리는 불변(`LiveHubView.tsx` `assistantStack`) | 기존 FAB 추종 계약(TRIP-1083) 보존 |
| R7 | G-U8-10 토스트를 화면별로 올릴 장치 | `shared/ui/Toast.tsx` `useRaisedToastBottom(px)` — 붙어 있는 화면 값 중 최댓값. ✦ 있는 탭 화면 288 | 마운트 기준이라 홈 탭(항상 마운트)이 있는 동안 다른 탭에서도 288 — 겹침이 아니라 '필요보다 높게' 쪽 오차(포커스 기준 전환은 사람 판단) |
| R8 | BR-U8-53 키보드가 열리면 ✦ 숨김 | 미구현 — 시트(숙소 필터·가격, 홈 담은 곳 메뉴, 허브 메모 시트)만 숨김 | 숙소 검색 검색창 포커스 시 ✦ 가 키보드 위에 남는지 6-b 확인 후 판단 |
| R9 | §1·§4 시트 = 투명 모달, next action 은 `router.dismiss` 후 `push` | 투명 모달은 그대로(`SplashGate` 가드 밖 `assistant/index`). 시트 몸체는 gorhom 이 아니라 View + KeyboardAvoidingView(끌어 닫기 없음, 닫기 X·딤 탭). next action 은 `router.replace(href)` 한 번 | 입력창이 하단에 붙는 채팅이라 키보드 회피 우선. replace 는 모달 자리를 목적 화면으로 바꿔 두 걸음 전환을 피한다 |
| R10 | BR-U8-04 상시 "내가 할 수 있는 것" quick reply | 서버가 `SHOW_CAPABILITIES` quick reply 를 줬으면 그 id 로 ACTION, 아니면 라벨을 TEXT 턴으로 보낸다(`AssistantSheetPage.handleCapabilities`) | 클라가 quick reply id 를 지어내면 '발급 id 만 수락' 규칙(위조 차단)에 걸린다 — BE 가 매 응답에 SHOW_CAPABILITIES 1개를 상시 발급하면 TEXT 경로는 죽는다 |
| R11 | §4-4 409 STALE → [다시 제안] quick reply | 카드 안 [다시 제안] 버튼이 그 제안을 부른 사용자 발화를 새 TEXT 턴으로 재전송(`handleRepropose`) | 409 응답 본문에 quick reply 가 없다 — BE 가 재제안 quick reply 를 동봉하면 그쪽으로 바꾼다 |
| R12 | §4-4 무효화 키 `['itinerary', tripId]` | `/trips/{tripId}/itinerary` 로 시작하는 orval 쿼리 키 전부 predicate 무효화(`assistantQueries.invalidateItinerary`) | 실제 키 이름 |
| R13 | §4.1 `RESTORE_REVISION` → h36 리비전 화면 | `nextActionRoute` 가 null → "내가 할 수 있는 것 보기"로 대체 | FE 에 리비전 화면 라우트가 없다 — BR-U8-34 [되돌리기]는 그 화면이 생겨야 작동(갭) |
| R14 | §4.1 `OPEN_PLACE` 여행 중 판정 | 도우미를 연 `surface === 'LIVE'` 면 허브 장소, 아니면 탐색 장소 상세 | 서버 params 에 여행 중 표지가 없다 |
| R15 | §3 `resolveSheetState` 4상태 | + `UNAUTHORIZED`(401 → 페이지가 시트를 닫음) | 오류 얼굴과 닫기를 가르기 위해 |
| R16 | §3 대기 취소 후 서버 결과는 다음 조회에서 합침 | 취소·저장 실패 모두 낙관 말풍선 '보내지 못함' + [다시 보내기] — **같은 clientTurnId** 재사용(`model/useTurnFlow.ts`). 자동 재조회 트리거는 없음 | 멱등 키로 중복 턴이 생기지 않는다. 429 는 말풍선을 거두고 입력 복원(턴 미기록과 일치) |
| R17 | §6 `useApplyProposal()` 인자 없음 | `useApplyProposal(sessionId, tripId)` · `useDismissProposal(sessionId)` · `useMarkProposal(sessionId)`(409 상태 반영) | 메시지 캐시 갱신과 일정 무효화에 세션·여행이 필요 |
| R18 | §8 testID 제안값 | 확정값 추가: `assistant-sheet-root`·`-sheet-scrim`·`-sheet-loading`·`-open-failed`·`-open-retry`·`-quick-reply-capabilities`·`-info-card`·`-action-log-{id}`·`-proposal-status`·`-proposal-repropose`·`-proposal-error`·`-user-bubble-pending`·`-resend`·`-progress-slow`·`-history-empty`·`-history-session-{id}`·`-history-clear-dialog`·`-history-clear-confirm`·`-history-clear-cancel`·`-message-list` | §8 [공백] 소급 기록 |
| R19 | §9 시트 흐름은 MSW 통합 테스트 | `AssistantSheetPage.test.tsx`(node 버킷) — `setAssistantPort` 로 가짜 어댑터 주입 | HTTP 경계가 아직 없다. BE 개통 후 http 어댑터는 MSW 통합 테스트로 덮는다 |
| R20 | G-U8-8·9 Figma | 새 프레임(정본 무변경): `b01-[1차] 도우미 · 숙소 요청 → 숙소 검색 넘기기`(4865:3615) · `b08-[✦] 진입 FAB · 홈/숙소 검색/여행 중 허브/일정 상세`(4864:2944·3054·3141·3303) — b 행 끝 | 이식(정본 교체)·DS FAB 변형 승격은 사람 판단 |

## [개정 · 2026-10-22 · 이전 대화 더 보기 (사이클 20261021-assistant-older-messages)]

> 원문 위 절들은 보존한다(append-only). 서버가 `nextBefore` 를 이미 내려주는데(`AssistantController.kt` "프론트 계약에 없던 칸") FE 계약·정본에 없어 30건 넘는 대화의 앞부분을 못 보던 드리프트의 기록. 사용자 결정 2026-10-21: 트리거는 눌러서 부르는 행 · 세션 재조회는 합치기 · Figma 시안 없이 기존 톤.

| # | 원문 | 구현(근거 코드) | 이유 |
|---|---|---|---|
| R21 | §6 `useAssistantSession` 응답 `{session, messages[], quickReplies[]}` | 응답에 **`nextBefore: string \| null`**(서버 required — 이어 연 대화에 더 오래된 메시지가 있으면 그 커서). `assistantContract.ts` `OpenSessionResponse.nextBefore`, 세션 열기가 메시지 캐시를 심을 때 `nextBefore: response.nextBefore ?? null` | `openapi.yaml` `AssistantOpenSessionResponse` 와 맞춤. 종전 `null` 하드코딩이 서버의 "더 있다"를 버렸다 |
| R22 | §2·§3·§6 더 보기 규칙 없음 | **규칙 신설**: ① 트리거 = 목록 맨 위(inverted FlatList `ListFooterComponent`) Pressable 하나 `assistant-older-more` — `nextBefore !== null` 일 때만 존재(비활성이 아니라 부재) ② 누르면 `getMessages(sessionId, {before})`(커서는 불투명 문자열 그대로, `limit` 미지정 = 서버 기본 30) → 로딩(disabled + 스피너) → 실패는 같은 자리에 `assistant-older-error` + 「다시 시도」(기존 메시지 유지, INV-4) ③ 성공은 `prependMessages(옛 쪽, 현재)` — 옛 쪽 전체 앞, id 중복은 기존 것 유지, **응답 도착 시점의 최신 캐시**에 붙인다 · 캐시 `nextBefore` ← 응답값 ④ 진행 중 재호출 차단, 실패 뒤 재호출 허용 ⑤ 세션 재조회(`useAssistantSession` 재실행)는 캐시가 있으면 `appendMessages(기존, 첫 쪽)` 로 **합치고 기존 커서 유지** — 통째 덮지 않는다(비용: 캐시된 메시지의 제안 상태가 서버 최신값으로 갱신되지 않는다 — 후속) ⑥ 이력 지우기 뒤 도착한 늦은 응답은 캐시를 새로 만들지 않는다 · 세션이 바뀌면 상태 초기화 ⑦ 턴 진행 중에도 누를 수 있다 ⑧ 스크롤 위치 보정 코드 없음(inverted 라 옛 쪽이 리스트 끝에 붙어 구조상 유지 — 실기 확인 항목). 훅 `useLoadOlderMessages(sessionId) → {hasMore, status: idle\|loading\|error, loadOlder}`, 가짜 어댑터는 `before`/`limit`(1~100)을 서버와 같은 규칙으로 거절·자른다 | 정본 공백(US-ASSIST-05 는 "이어 보기"만). `useInfiniteQuery` 는 캐시 모양이 바뀌어 평가·제안 패치 전부에 번져 안 썼다 |
