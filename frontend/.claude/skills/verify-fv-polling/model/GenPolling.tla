---------------------------- MODULE GenPolling ----------------------------
(***************************************************************************)
(* AI 일정 생성(POST)과 그 결과를 묻는 폴링(GET)의 순서 — 여행 하나.         *)
(*                                                                         *)
(* 무엇을 모델링하나: 생성 시작 누름 → 생성 화면(h09)이 POST 를 쏜다 →      *)
(* 서버가 1일차(PARTIAL)를 돌려준다 → 초안 화면(h11)이 COMPLETE 까지 폴링한다. *)
(* 그 사이에 늦은 GET 응답·네트워크 실패·재시도·화면 이탈/복귀·웹 새로고침·  *)
(* 화면이 다시 그려지기 전 두 번째 탭이 아무 순서로나 끼어든다.             *)
(* 일정 GET 은 쿼리 키 하나를 모든 화면이 함께 쓴다(react-query — 한 번에    *)
(* 요청 하나, 응답은 캐시 한 칸에 들어간다). 서버 규칙은 ASSUMPTION 주석.    *)
(*                                                                         *)
(* 코드 대응: 각 정의 옆 주석의 파일·함수(경로는 frontend/ 기준).          *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  InitRows,     \* 시작할 때 서버 일정: "None"(첫 생성) / "Old"(이미 만든 COMPLETE — 재생성)
  MaxIntent,    \* 사용자가 생성을 누르는 횟수 상한(모델 크기 제한)
  MaxPost,      \* 나가는 POST 수 상한(모델 크기 제한 — 누름보다 하나 많게 둔다)
  MaxPoll,      \* 초안 화면 폴링 상한(코드 DRAFT_POLL_MAX_COUNT = 30 의 축소)
  Web,          \* 웹(브라우저 새로고침이 있다)
  EntryGuarded, \* 생성 진입 버튼(꼭 갈 곳 「다음」·거점 「다시 만들기」)에 연타 잠금이 있나 — 코드: FALSE
  RetryGuarded  \* 생성 화면 [다시 시도]에 연타 잠금이 있나 — 코드: FALSE

VARIABLES
  row,     \* 서버 일정 행: [st |-> "None"|"Old"|"Partial"|"Complete"|"Failed", g |-> 몇 번째 생성의 것인가]
  run,     \* 서버에서 돌고 있는 생성 세션(몇 번째 생성), 없으면 0 — GET 의 generationSessionId
  gen,     \* 서버가 받아 시작한 생성 수(= AI 를 돌린 수 = 하루 한도에서 빠진 수)
  post,    \* POST 마다: [srv |-> 서버 처리 단계, cli |-> 클라이언트가 받은 결과, g |-> 생성 번호, ctx |-> 보낸 JS 실행]
  sent,    \* 클라이언트가 보낸 POST 수
  intents, \* 사용자가 생성을 누른 수(같은 버튼을 다시 그려지기 전에 또 친 것은 세지 않는다)
  ctx,     \* JS 실행 번호 — 웹 새로고침마다 하나씩(메모리·캐시가 사라진다)
  scr,     \* 지금 보는 화면: "Entry"(진입) "Gen"(생성 중 h09, POST 모드) "Obs"(h09 관찰 모드) "Draft"(초안 h11) "Away"(홈)
  live,    \* 아직 트리에 붙어 있어 성공하면 초안으로 보낼 생성 화면들의 POST 번호
  top,     \* 맨 위 생성 화면이 보고 있는 POST 번호(그 화면의 현재 mutation), 없으면 0
  echo,    \* 방금 누른 버튼이 다시 그려지기 전이다: "no" | "entry" | "retry"
  cache,   \* 일정 쿼리 캐시 칸: [st, g, run(세션 id 있음)] — st = "NoData" 면 비었다
  err,     \* 그 칸이 오류 상태인가(마지막 조회 실패 — data 는 남는다)
  polls,   \* 초안 화면이 열린 뒤 받은 응답 수(dataUpdateCount − 기준선), MaxPoll 에서 멈춘다
  get      \* 나가 있는 일정 GET: [ph |-> "none"|"sent"|"served", snap |-> 서버가 읽은 값, ctx]

vars == <<row, run, gen, post, sent, intents, ctx, scr, live, top, echo, cache, err, polls, get>>

Ids == 1..MaxPost
NoData == [st |-> "NoData", g |-> 0, run |-> FALSE]
NoGet == [ph |-> "none", snap |-> NoData, ctx |-> 0]
Idle == [srv |-> "none", cli |-> "idle", g |-> 0, ctx |-> 0]
Bump(n) == IF n < MaxPoll THEN n + 1 ELSE MaxPoll

(***************************************************************************)
(* ===================== CODE MIRROR (적합성 검사가 대조) ================== *)
(* checks/conformance.check.tsx 의 model* 함수와 같은 식이어야 한다.       *)
(***************************************************************************)

\* pages/itinerary/itinerary-draft/ui/DraftPage.tsx refetchInterval
\*   shouldKeepPollingDraft(generationState === 'PARTIAL' && 받은 수 < DRAFT_POLL_MAX_COUNT)
\*   — 조회 오류(status === 'error')는 보지 않는다.
DraftPollDue == cache.st = "Partial" /\ polls < MaxPoll

\* DraftPage.tsx 얼굴 — resolveDraftView + `view.kind === 'listed' && isPartial` 갈래.
\*   PARTIAL 이면 staleFailed(조회 오류·폴링 상한)와 상관없이 진행 카드(generation-progress-card)를 그린다.
\*   (1일차에 장소가 있다고 둔다 — 0곳 PARTIAL 은 범위 밖)
DraftFace ==
  CASE cache.st = "NoData" -> IF err THEN "failed" ELSE "loading"
    [] cache.st = "Partial" -> "progress"
    [] cache.st = "Failed"  -> "resultFailed"   \* listed + staleFailed(h08 셸)
    [] OTHER                -> IF err THEN "resultFailed" ELSE "result"

\* app/model/useGenerationWatch.ts — isInFlight(PARTIAL 이거나 세션 있음) ∧ 조회 오류 아님,
\*   그리고 그 여행의 생성 화면(generating·draft — isGenerationScreenOf)을 보고 있으면 양보한다.
ShellPollDue ==
  /\ scr \notin {"Gen", "Obs", "Draft"}
  /\ cache.st = "Partial" \/ cache.run
  /\ ~err

\* pages/itinerary/itinerary-generating/ui/GeneratingPage.tsx — 화면이 트리에 있으면 mutate 의
\*   호출별 onSuccess 가 router.replace(초안)를 부른다. 훅 옵션 onSuccess(setQueryData)는 화면이
\*   떠나도 같은 JS 실행이면 불린다. 둘 다 진행 중 GET 을 취소하지 않는다(cancelQueries 없음).
PostWritesCache(i) == post[i].ctx = ctx

(* ========================== CODE MIRROR 끝 ============================= *)

GenFace == IF post[top].cli = "err" THEN "failed" ELSE "progress"
ObsFace == IF err THEN "failed" ELSE "progress"
\* 화면이 처음 열리며 묻는 조회(캐시가 비었을 때) — react-query 가 마운트 때 반드시 보낸다.
MountFetchDue == scr \in {"Draft", "Obs"} /\ cache.st = "NoData" /\ ~err

(***************************************************************************)
(* ASSUMPTION(서버) — backend/modules/itinerary-generation                 *)
(*  A1 POST 를 받으면 세션을 연다: 같은 여행의 이전 세션은 닫고 새로 연다    *)
(*     (GenerationSessionService.start — 재생성도 하루 한도에서 센다).      *)
(*  A2 1차(AI 1일차)를 도는 동안 일정 행은 그대로다 — GET 은 옛 행 + 새     *)
(*     세션 id 를 준다(runningIdOf). 1차가 끝나면 행을 PARTIAL 로 갈아끼우고  *)
(*     201 PARTIAL 을 돌려준다(GenerateItineraryService.generate).          *)
(*  A3 1차가 실패하면 세션을 실패로 닫고 오류를 준다.                      *)
(*  A4 2차(백그라운드)는 자기 세션이 아직 돌 때만 COMPLETE·FAILED 로 닫는다. *)
(*     세션이 닫힌 PARTIAL 은 스위퍼가 FAILED 로 내린다(StalePartialSweeper). *)
(*  A5 행이 없으면 GET 은 404.                                            *)
(*  네트워크 실패는 어느 요청에나 올 수 있다(서버는 이미 받았을 수도 있다). *)
(***************************************************************************)

Init ==
  /\ row \in {[st |-> s, g |-> 0] : s \in InitRows}
  /\ run = 0
  /\ gen = 0
  /\ post = [i \in Ids |-> Idle]
  /\ sent = 0
  /\ intents = 0
  /\ ctx = 0
  /\ scr = "Entry"
  /\ live = {}
  /\ top = 0
  /\ echo = "no"
  /\ cache = IF row.st = "Old" THEN [st |-> "Old", g |-> 0, run |-> FALSE] ELSE NoData
  /\ err = FALSE
  /\ polls = 0
  /\ get = NoGet

\* 새 POST 한 건을 JS 실행 c 에서 보낸다(번호 = sent + 1).
Fire(n, c) ==
  /\ sent' = n
  /\ post' = [post EXCEPT ![n] = [srv |-> "none", cli |-> "waiting", g |-> 0, ctx |-> c]]
NewId == sent + 1
CanFire == sent < MaxPost

ServerUnchanged == UNCHANGED <<row, run, gen>>

(* ---------------- 사용자 ---------------- *)

\* 진입 화면에서 생성을 누른다 → 생성 화면이 열리며 마운트 때 POST 1회(firedRef).
\* MustVisitListPage.goToGenerating / TripBasesPage.regenerate — 연타 잠금 없음(EntryGuarded).
PressStart ==
  /\ scr = "Entry" /\ intents < MaxIntent /\ CanFire
  /\ intents' = intents + 1
  /\ Fire(NewId, ctx)
  /\ scr' = "Gen" /\ live' = live \cup {NewId} /\ top' = NewId
  /\ echo' = IF EntryGuarded THEN "no" ELSE "entry"
  /\ UNCHANGED <<ctx, cache, err, polls, get>> /\ ServerUnchanged

\* 초안에서 [다시 짜기] → 생성 화면(replace). DraftPage.handleRetry 는 leavingRef 로 잠근다.
PressRegenerate ==
  /\ scr = "Draft" /\ cache.st # "NoData" /\ intents < MaxIntent /\ CanFire
  /\ intents' = intents + 1
  /\ Fire(NewId, ctx)
  /\ scr' = "Gen" /\ live' = live \cup {NewId} /\ top' = NewId /\ echo' = "no"
  /\ UNCHANGED <<ctx, cache, err, polls, get>> /\ ServerUnchanged

\* 생성 실패 얼굴의 [다시 시도] = fire() — 같은 화면의 mutation 을 새 호출로 바꾼다.
PressRetry ==
  /\ scr = "Gen" /\ post[top].cli = "err" /\ intents < MaxIntent /\ CanFire
  /\ intents' = intents + 1
  /\ Fire(NewId, ctx)
  /\ live' = (live \ {top}) \cup {NewId} /\ top' = NewId
  /\ echo' = IF RetryGuarded THEN "no" ELSE "retry"
  /\ UNCHANGED <<ctx, scr, cache, err, polls, get>> /\ ServerUnchanged

\* 같은 버튼을 화면이 다시 그려지기 전에 한 번 더 친다(누름 의도는 그대로 하나).
\*   entry: 생성 화면이 하나 더 쌓이고 그 화면도 마운트 때 POST.  retry: fire() 가 한 번 더.
EchoTap ==
  /\ echo # "no" /\ scr = "Gen" /\ CanFire
  /\ Fire(NewId, ctx)
  /\ live' = IF echo = "entry" THEN live \cup {NewId} ELSE (live \ {top}) \cup {NewId}
  /\ top' = NewId /\ echo' = "no"
  /\ UNCHANGED <<intents, ctx, scr, cache, err, polls, get>> /\ ServerUnchanged

\* ‹ (생성 화면은 dismissTo 홈 — POST 는 계속 간다) / 초안 뒤로.
Leave ==
  /\ scr \in {"Gen", "Obs", "Draft"}
  /\ scr' = "Away" /\ live' = {} /\ top' = 0 /\ echo' = "no"
  /\ UNCHANGED <<post, sent, intents, ctx, cache, err, polls, get>> /\ ServerUnchanged

\* 홈 카드로 다시 연다(planState 목적지). 캐시에 일정이 있으면 초안(관찰 모드는 곧장 초안으로 replace),
\* 비었으면 관찰 모드(GET 한 번) 또는 생성 방식 화면.
Return ==
  /\ scr = "Away"
  /\ IF cache.st = "NoData" THEN scr' \in {"Obs", "Entry"} ELSE scr' = "Draft"
  /\ polls' = 0 /\ echo' = "no"
  /\ UNCHANGED <<post, sent, intents, ctx, live, top, cache, err, get>> /\ ServerUnchanged

\* 웹 새로고침 — JS 실행이 새로 뜨고 캐시가 빈다. 주소에 mode= 가 남은 생성 화면이면 다시 마운트돼 POST.
Reload ==
  /\ Web /\ scr \in {"Gen", "Draft", "Obs"} /\ ctx < MaxPost
  /\ scr = "Gen" => CanFire   \* 모델 크기 제한: POST 상한에 닿았으면 생성 화면 새로고침은 뺀다
  /\ ctx' = ctx + 1
  /\ cache' = NoData /\ err' = FALSE /\ get' = NoGet /\ polls' = 0 /\ echo' = "no"
  /\ IF scr = "Gen"
       THEN /\ Fire(NewId, ctx + 1) /\ live' = {NewId} /\ top' = NewId
       ELSE /\ UNCHANGED <<post, sent>> /\ live' = {} /\ top' = 0
  /\ scr' = scr
  /\ UNCHANGED intents /\ ServerUnchanged

(* ---------------- POST ---------------- *)

ServePost(i) ==   \* A1·A2: 서버가 받아 세션을 연다(행은 그대로)
  /\ i <= sent /\ post[i].srv = "none"
  /\ gen' = gen + 1 /\ run' = gen + 1
  /\ post' = [post EXCEPT ![i].srv = "served", ![i].g = gen + 1]
  /\ UNCHANGED <<row, sent, intents, ctx, scr, live, top, cache, err, polls, get>> /\ echo' = "no"

CommitPost(i) ==  \* A2: 1일차 완성 — 행을 PARTIAL 로 갈아끼운다
  /\ post[i].srv = "served"
  /\ row' = [st |-> "Partial", g |-> post[i].g]
  /\ post' = [post EXCEPT ![i].srv = "committed"]
  /\ UNCHANGED <<run, gen, sent, intents, ctx, scr, live, top, cache, err, polls, get>> /\ echo' = "no"

FailPostServer(i) ==  \* A3
  /\ post[i].srv = "served"
  /\ run' = IF run = post[i].g THEN 0 ELSE run
  /\ post' = [post EXCEPT ![i].srv = "failed"]
  /\ UNCHANGED <<row, gen, sent, intents, ctx, scr, live, top, cache, err, polls, get>> /\ echo' = "no"

\* 201 이 클라이언트에 닿는다. 훅 옵션 onSuccess = setQueryData(응답) — 같은 JS 실행일 때만.
\* 그 POST 의 화면이 아직 트리에 있으면 호출별 onSuccess = router.replace(초안).
PostOk(i) ==
  /\ post[i].srv = "committed" /\ post[i].cli = "waiting"
  /\ post' = [post EXCEPT ![i].cli = "ok"]
  /\ IF PostWritesCache(i)
       THEN /\ cache' = [st |-> "Partial", g |-> post[i].g, run |-> run = post[i].g]
            /\ err' = FALSE
            /\ IF i \in live
                 THEN /\ scr' = "Draft" /\ live' = live \ {i} /\ top' = 0 /\ polls' = 0
               \* 관찰 모드는 data 가 어디서 오든(여기선 setQueryData) 생기는 순간 초안으로 replace 한다.
               ELSE IF scr = "Obs"
                 THEN /\ scr' = "Draft" /\ polls' = 0 /\ UNCHANGED <<live, top>>
                 ELSE /\ polls' = Bump(polls) /\ UNCHANGED <<scr, live, top>>
       ELSE UNCHANGED <<cache, err, scr, live, top, polls>>
  /\ UNCHANGED <<sent, intents, ctx, get>> /\ ServerUnchanged /\ echo' = "no"

\* 오류 응답(1차 실패) 또는 네트워크 실패 — 서버가 받았든 아니든. 실패 얼굴은 top 일 때만 보인다.
PostErr(i) ==
  /\ post[i].cli = "waiting"
  /\ post' = [post EXCEPT ![i].cli = "err"]
  /\ UNCHANGED <<sent, intents, ctx, scr, live, top, cache, err, polls, get>> /\ ServerUnchanged /\ echo' = "no"

(* ---------------- 일정 GET (쿼리 키 하나 — 한 번에 하나) ---------------- *)

\* 누가 묻든(초안 폴링·셸 감시·마운트·포커스 복귀·홈 카드) 이미 나가 있지 않으면 하나 나간다.
StartGet ==
  /\ get.ph = "none"
  /\ get' = [ph |-> "sent", snap |-> NoData, ctx |-> ctx]
  /\ UNCHANGED <<post, sent, intents, ctx, scr, live, top, cache, err, polls>> /\ ServerUnchanged /\ echo' = "no"

ServeGet ==   \* 서버가 읽는 순간의 행 + 세션 유무
  /\ get.ph = "sent"
  /\ get' = [get EXCEPT !.ph = "served", !.snap = [st |-> row.st, g |-> row.g, run |-> run # 0]]
  /\ UNCHANGED <<post, sent, intents, ctx, scr, live, top, cache, err, polls>> /\ ServerUnchanged /\ echo' = "no"

\* 응답이 닿는다 — 요청을 보낸 JS 실행이 살아 있을 때만 캐시에 들어간다.
GetOk ==
  /\ get.ph = "served" /\ get' = NoGet
  /\ IF get.ctx # ctx THEN UNCHANGED <<cache, err, scr, polls>>
     ELSE IF get.snap.st = "None"
       THEN /\ err' = TRUE /\ UNCHANGED <<cache, polls>>   \* 404 — data 는 남는다
            /\ scr' = IF scr = "Obs" THEN "Entry" ELSE scr  \* 관찰 모드 404 → 생성 방식
       ELSE /\ cache' = get.snap /\ err' = FALSE
            /\ IF scr = "Obs" THEN scr' = "Draft" /\ polls' = 0 ELSE scr' = scr /\ polls' = Bump(polls)
  /\ UNCHANGED <<post, sent, intents, ctx, live, top>> /\ ServerUnchanged /\ echo' = "no"

GetFail ==   \* 재시도까지 다 실패(서버는 읽었을 수도 있다) — data 는 남고 오류 상태가 된다
  /\ get.ph # "none" /\ get' = NoGet
  /\ err' = IF get.ctx = ctx THEN TRUE ELSE err
  /\ UNCHANGED <<post, sent, intents, ctx, scr, live, top, cache, polls>> /\ ServerUnchanged /\ echo' = "no"

(* ---------------- 서버 2차 ---------------- *)

SecondPhaseDone ==  \* A4
  /\ row.st = "Partial" /\ run = row.g /\ run # 0
  /\ \E s \in {"Complete", "Failed"} : row' = [row EXCEPT !.st = s]
  /\ run' = 0
  /\ UNCHANGED <<gen, post, sent, intents, ctx, scr, live, top, cache, err, polls, get>> /\ echo' = "no"

Sweep ==  \* A4 스위퍼
  /\ row.st = "Partial" /\ run # row.g
  /\ row' = [row EXCEPT !.st = "Failed"]
  /\ UNCHANGED <<run, gen, post, sent, intents, ctx, scr, live, top, cache, err, polls, get>> /\ echo' = "no"

Next ==
  \/ PressStart \/ PressRegenerate \/ PressRetry \/ EchoTap
  \/ Leave \/ Return \/ Reload
  \/ \E i \in Ids : ServePost(i) \/ CommitPost(i) \/ FailPostServer(i) \/ PostOk(i) \/ PostErr(i)
  \/ StartGet \/ ServeGet \/ GetOk \/ GetFail
  \/ SecondPhaseDone \/ Sweep

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* 속성                                                                    *)
(***************************************************************************)

\* 클라이언트 쪽 일이 다 끝났다 — 응답을 기다리는 요청도, 예약된 폴링도 없다.
\* (사용자가 앱을 껐다 켜거나 화면을 옮기지 않는 한 화면이 더는 안 바뀐다)
Quiet ==
  /\ get.ph = "none"
  /\ \A i \in Ids : post[i].ctx = ctx => post[i].cli # "waiting"
  /\ ~(scr = "Draft" /\ DraftPollDue)
  /\ ~ShellPollDue
  /\ ~MountFetchDue

\* P1 생성 결과는 서버가 완료를 알린 뒤에만 보인다.
\*   조용해진 초안 화면이 「완성된 일정」 얼굴이면, 그것은 마지막으로 시작한 생성의 COMPLETE 다.
ResultOnlyAfterComplete ==
  (Quiet /\ scr = "Draft" /\ DraftFace = "result" /\ gen > 0)
    => cache.st = "Complete" /\ cache.g = gen

\* P2 실패하면 생성 중 화면에 갇히지 않는다.
\*   조용해졌는데 화면이 아직 「만드는 중」(생성 화면 진행·관찰 진행·초안 진행 카드·초안 로딩)이 아니다.
NoStuckProgress ==
  Quiet =>
    ~ \/ scr = "Gen" /\ GenFace = "progress"
      \/ scr = "Obs" /\ ObsFace = "progress"
      \/ scr = "Draft" /\ DraftFace \in {"progress", "loading"}

\* P3 한 번 누른 생성은 한 번만 요청된다.
OnePostPerPress == sent <= intents

TypeOK ==
  /\ row.st \in {"None", "Old", "Partial", "Complete", "Failed"} /\ row.g \in 0..MaxPost
  /\ run \in 0..MaxPost /\ gen \in 0..MaxPost /\ sent \in 0..MaxPost /\ intents \in 0..MaxIntent
  /\ scr \in {"Entry", "Gen", "Obs", "Draft", "Away"}
  /\ live \subseteq Ids /\ top \in 0..MaxPost /\ echo \in {"no", "entry", "retry"}
  /\ cache.st \in {"NoData", "Old", "Partial", "Complete", "Failed", "None"}
  /\ err \in BOOLEAN /\ polls \in 0..MaxPoll /\ get.ph \in {"none", "sent", "served"}
  /\ scr = "Gen" => top \in live
=============================================================================
