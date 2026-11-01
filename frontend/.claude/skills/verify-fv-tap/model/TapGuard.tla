---------------------------- MODULE TapGuard ----------------------------
(***************************************************************************)
(* 연타 잠금 — 버튼 하나를 시간 축 위에서 몇 번이고 누를 때.                 *)
(*                                                                         *)
(* 무엇을 모델링하나: 누름 → guardPress(모듈 전역 400ms 창) → 핸들러(잠금 ref *)
(* · 요청 · 이동) → 서버 응답(성공·거절·네트워크 실패, 지연은 비결정) →      *)
(* 콜백(창 다시 열기 · 표면 바뀜 · 실패 안내). 표면이 바뀌면 바뀐 표면의      *)
(* 버튼(guardPress)을 누를 수 있다.                                        *)
(*                                                                         *)
(* 시간: 한 틱 = 100ms, 창 = Window 틱(400ms). 누름·응답은 한 틱 안에 몇     *)
(* 번이든 일어날 수 있다(같은 틱 연타 = JS 같은 프레임 두 이벤트).            *)
(*                                                                         *)
(* 경로마다 잠금 방식이 다르다 — CONSTANT Path 로 고르고, 그 경로의 배선은   *)
(* MCTapGuard.tla 의 Flags 표(CODE MIRROR)에 적는다.                         *)
(* 코드 대응: 각 정의 옆 주석의 파일·함수(경로는 frontend/ 기준).            *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS
  Path,      \* 검사할 경로 이름(Flags 의 키)
  Flags,     \* 경로 → 배선 레코드(MCTapGuard.tla)
  Window,    \* 창 길이(틱) — shared/lib/pressGuard.ts WINDOW_MS 400 / 100
  MaxT,      \* 시간 상한(틱) — 모델 크기 제한
  MaxSends   \* 요청 수 상한 — 가드 없는 경로의 같은 틱 무한 연타를 자른다

F == Flags[Path]
NegInf == -1000   \* pressGuard.ts openedAt 초깃값 -Infinity

VARIABLES
  now,       \* 지금 시각(틱)
  openedAt,  \* pressGuard.ts 모듈 전역 openedAt
  lock,      \* 페이지 잠금 ref(assignLockRef·lockedRef 등) — 경로에 없으면 늘 FALSE
  inflight,  \* 아직 응답 안 온 요청 id 집합
  nextId,    \* 다음 요청 id
  latest,    \* 마지막 mutate 호출 id(TanStack: 호출별 콜백은 마지막 호출에만)
  srvOk,     \* 서버가 이 요청을 한 번이라도 받아들였다
  surface,   \* "src"(누른 버튼이 보이는 표면) | "next"(바뀐 표면) | "after"(바뀐 표면 버튼까지 누름)
  changedAt, \* 표면이 바뀐 시각
  note,      \* 실패 안내가 떠 있다
  sent,      \* 나간 요청 수(이동 경로는 이동 수)
  extra,     \* 유령: 앞 요청이 진행 중이거나 이미 성공했는데 요청/이동이 또 나갔다
  passThrough \* 유령: 표면이 바뀐 지 400ms 안에 바뀐 표면의 버튼이 눌렸다(연타 관통)

vars == <<now, openedAt, lock, inflight, nextId, latest, srvOk, surface, changedAt, note, sent, extra, passThrough>>

(***************************************************************************)
(* ===================== CODE MIRROR (적합성 테스트가 대조) ================ *)
(* shared/lib/pressGuard.ts guardPress — checks/conformance.check.ts 의       *)
(* modelGuardAllows 와 같은 식이어야 한다. 코드를 바꾸면 둘을 함께 고친다.    *)
(*   const elapsed = Date.now() - openedAt;                                *)
(*   if (elapsed >= 0 && elapsed < WINDOW_MS) return;   // 무시(창 안 늘림)  *)
(*   openPressGuardWindow(); handler(...args);          // openedAt = now    *)
(***************************************************************************)
GuardAllows == ~(now - openedAt >= 0 /\ now - openedAt < Window)
(* ========================== CODE MIRROR 끝 ============================= *)

Busy == inflight # {} \/ srvOk
Leave(t) == /\ surface' = "next" /\ changedAt' = t
            /\ extra' = (extra \/ surface # "src")

(***************************************************************************)
(* ASSUMPTION                                                              *)
(*  A1 이동(router.push/replace)은 그 틱에 누른 표면을 치운다 — 전환        *)
(*     애니메이션이 창(400ms)보다 길어 옛 화면이 계속 눌리는 경우는 모델 밖. *)
(*  A2 바뀐 표면의 버튼은 guardPress 로 감싸져 있다(예: 일정 확정 뒤          *)
(*     [일정 수정] goEdit, 위저드 이탈 뒤 홈 히어로 pushDestination).        *)
(*  A3 서버: conflict 경로는 이미 받아들인 뒤 같은 요청을 409 로 거절한다     *)
(*     (ConfirmItineraryService: PLANNED 가 아니면 ConflictDetected).        *)
(*     conflict 가 아니면 다시 받아들인다(삭제 404 → done, 권한 재조회 granted). *)
(*  A4 응답 지연은 0틱 이상 아무 값, 네트워크 실패는 어느 요청에나.           *)
(***************************************************************************)

Init ==
  /\ now = 0
  /\ openedAt = NegInf
  /\ lock = FALSE
  /\ inflight = {}
  /\ nextId = 1
  /\ latest = 0
  /\ srvOk = FALSE
  /\ surface = "src"
  /\ changedAt = NegInf
  /\ note = FALSE
  /\ sent = 0
  /\ extra = FALSE
  /\ passThrough = FALSE

\* 핸들러 본문. 잠금 ref 가 서 있으면 즉시 돌아온다(그래도 guardPress 는 이미 창을 열었다).
Handler ==
  IF F.lock /\ lock
  THEN UNCHANGED <<lock, inflight, nextId, latest, surface, changedAt, note, sent, extra>>
  ELSE IF F.request
  THEN /\ lock' = F.lock
       /\ inflight' = inflight \cup {nextId}
       /\ latest' = nextId
       /\ nextId' = nextId + 1
       /\ sent' = sent + 1
       /\ note' = FALSE          \* setConfirmError(null) · setAssignFailure(null) · setFailed(false)
       /\ extra' = (extra \/ Busy)
       /\ UNCHANGED <<surface, changedAt>>
  ELSE \* 이동 경로 — router.push 가 곧바로 표면을 치운다(A1)
       /\ sent' = sent + 1
       /\ Leave(now)
       /\ UNCHANGED <<lock, inflight, nextId, latest, note>>

\* 사용자가 누른다. pendingDisabled 경로는 요청 중 버튼이 비활성이라 못 누른다.
YouTap ==
  /\ surface = "src" /\ sent < MaxSends
  /\ ~(F.pendingDisabled /\ inflight # {})
  /\ IF F.guard
     THEN /\ GuardAllows      \* 창 안의 누름은 아무것도 바꾸지 않는다(스터터) — 액션으로 두지 않는다
          /\ openedAt' = now
     ELSE UNCHANGED openedAt
  /\ Handler
  /\ UNCHANGED <<now, srvOk, passThrough>>

\* 요청 id 의 호출별 콜백(mutate 두 번째 인자 · .then)이 돈다?
PerCall(id) == ~F.latestOnly \/ id = latest

\* 성공 응답. 훅 수준 onSuccess(모든 호출) → flipOnHookOk 면 표면이 바뀐다(캐시 쓰기).
\* 호출별 onSuccess → openOnOk 면 창을 열고, leaveOnOk 면 표면을 치운다.
RespondOk(id) ==
  /\ id \in inflight
  /\ ~(F.conflict /\ srvOk)
  /\ inflight' = inflight \ {id}
  /\ srvOk' = TRUE
  /\ openedAt' = IF PerCall(id) /\ F.openOnOk THEN now ELSE openedAt
  /\ IF (F.flipOnHookOk \/ (PerCall(id) /\ F.leaveOnOk)) /\ surface = "src"
     THEN /\ surface' = "next" /\ changedAt' = now /\ UNCHANGED extra
     ELSE IF PerCall(id) /\ F.leaveOnOk
          THEN \* 이미 바뀐 표면에서 또 이동(router.replace 두 번째)
               /\ extra' = TRUE /\ UNCHANGED <<surface, changedAt>>
          ELSE UNCHANGED <<surface, changedAt, extra>>
  /\ UNCHANGED <<now, lock, nextId, latest, note, sent, passThrough>>

\* 실패 응답 — 서버 거절(A3) 또는 네트워크. 호출별 onError 만 안내를 띄우고 잠금을 푼다.
Fail(id) ==
  /\ inflight' = inflight \ {id}
  /\ IF PerCall(id)
     THEN \* 안내는 그 상태를 그리는 표면이 남아 있을 때만 보인다(바뀐 표면이 같은 페이지면 noteOnNext)
          /\ note' = (note \/ surface = "src" \/ F.noteOnNext)
          /\ lock' = FALSE
     ELSE UNCHANGED <<note, lock>>
  /\ UNCHANGED <<now, openedAt, nextId, latest, srvOk, surface, changedAt, sent, extra, passThrough>>

RespondRejected(id) == id \in inflight /\ F.conflict /\ srvOk /\ Fail(id)
RespondNetFail(id) == id \in inflight /\ Fail(id)

\* 바뀐 표면의 버튼(guardPress, A2)을 누른다.
YouTapNext ==
  /\ surface = "next"
  /\ GuardAllows
  /\ openedAt' = now
  /\ passThrough' = (now - changedAt < Window)
  /\ surface' = "after"
  /\ UNCHANGED <<now, lock, inflight, nextId, latest, srvOk, changedAt, note, sent, extra>>

TimePasses ==
  /\ now < MaxT
  /\ now' = now + 1
  /\ UNCHANGED <<openedAt, lock, inflight, nextId, latest, srvOk, surface, changedAt, note, sent, extra, passThrough>>

\* 끝 상태(시간 끝 · 응답 다 옴) — 교착이 아니다.
Done == now = MaxT /\ inflight = {} /\ UNCHANGED vars

ServerAccepts == \E id \in inflight : RespondOk(id)
ServerRejects == \E id \in inflight : RespondRejected(id)
NetworkFails == \E id \in inflight : RespondNetFail(id)

Next ==
  \/ YouTap \/ YouTapNext
  \/ ServerAccepts \/ ServerRejects \/ NetworkFails
  \/ TimePasses \/ Done

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* 속성                                                                    *)
(***************************************************************************)
TypeOK ==
  /\ now \in 0..MaxT
  /\ openedAt \in {NegInf} \cup (0..MaxT)
  /\ lock \in BOOLEAN /\ srvOk \in BOOLEAN /\ note \in BOOLEAN
  /\ inflight \subseteq 1..MaxSends
  /\ surface \in {"src", "next", "after"}

\* P1 버튼을 빠르게 여러 번 눌러도 화면 이동·요청은 한 번만 나간다.
\*    (앞 요청이 실패해 안내를 본 뒤 다시 누르는 재시도는 허용 — 그때는 Busy 가 거짓이다.)
OnceOnly == ~extra

\* P2 요청이 다 끝났고 서버가 받아들였으면, 화면에 실패 안내가 보이지 않는다.
\*    (안내 상태가 남아도 그것을 그리는 표면이 치워졌으면 안 보인다 — noteOnNext.)
NoteVisible == note /\ (surface = "src" \/ F.noteOnNext)
NoFalseFailure == (inflight = {} /\ srvOk) => ~NoteVisible

\* P3 화면이 바뀐 지 400ms 안의 탭(연타의 남은 탭)은 바뀐 화면의 버튼을 누르지 않는다.
NoPassThrough == ~passThrough
=============================================================================
