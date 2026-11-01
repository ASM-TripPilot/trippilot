---------------------------- MODULE VisitFlow ----------------------------
(***************************************************************************)
(* 여행 중 하루(오늘) 방문 체크 + Plan-B 재계획 흐름.                        *)
(*                                                                         *)
(* 무엇을 모델링하나: 클라이언트가 방문 기록 캐시를 어떻게 카드 상태·버튼으로 *)
(* 바꾸는지(허브 i01·기록 j01), 낙관 갱신·롤백·연타 잠금, 재계획 요청에      *)
(* 싣는 제외 목록, 초안 적용 뒤 남은 방문. 서버는 "응답"으로만 등장하고      *)
(* 그 규칙은 아래 ASSUMPTION 주석으로 적는다.                              *)
(*                                                                         *)
(* 코드 대응: 각 정의 옆 주석의 파일·함수(경로는 frontend/ 기준).          *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
  Pois,      \* 그날 다룰 장소들(slotKey = 오늘#poiId 라 장소 = 슬롯 키)
  InitPlan,  \* 오늘 일차의 원 일정 순서
  MaxNew,    \* 재계획이 새로 놓는 장소 수 상한(모델 크기 제한)
  Armed      \* 자동 기록 무장(ARMED) 여부 — 수동 허브는 FALSE

None == "-"

VARIABLES
  srv,      \* 서버 방문 기록: poi -> "none"|"open"(도착·미완료)|"done"|"skipped"
  cache,    \* 클라이언트 react-query 캐시의 서버발 레코드(같은 값 영역)
  opt,      \* 캐시에 붙은 낙관 도착 레코드(id "optimistic:<poi>")의 poi 집합
  plan,     \* 오늘 일정(슬롯 순서)
  hub,      \* 허브 [도착] 계열 요청: [k |-> "none"|"arrive"|"chainC"|"chainA", from, to]
  cmp,      \* 허브 단독 [방문 완료] 요청 중인 poi (completeBusy) 또는 None
  skp,      \* j01 건너뛰기 요청 중인 poi 또는 None
  rp,       \* 재계획 화면: "none"(허브)|"solving"|"draft"|"applied"(허브 + 반영 시트)
  sent,     \* 마지막 재계획 요청에 실은 excludedPoiIds
  draft,    \* 서버 초안 일정
  skippedBack \* 유령 변수: 적용한 초안이 이미 건너뛴 장소를 다시 넣었나

vars == <<srv, cache, opt, plan, hub, cmp, skp, rp, sent, draft, skippedBack>>

Range(s) == {s[i] : i \in DOMAIN s}
Idx == 1..Len(plan)
NoHub == [k |-> "none", from |-> None, to |-> None]

(***************************************************************************)
(* ===================== CODE MIRROR (적합성 테스트가 대조) ================ *)
(* 이 구역의 식은 실제 코드의 판정을 글자 그대로 옮긴 것이다.               *)
(* checks/conformance.check.tsx 의 modelArriveTargets / modelShowComplete /         *)
(* modelExcludedSent 와 같은 식이어야 한다 — 코드를 바꾸면 셋을 함께 고친다. *)
(***************************************************************************)

\* entities/itinerary-slot/lib/visitProgress.ts isCompleted: completedAt≠null ∧ skippedAt=null
Completed(p) == cache[p] = "done"

\* visitProgress.ts isArrivedActive + "완료 목록에 없는 후보" — 낙관 레코드도 도착·미완료·미건너뜀이다
Candidate(p) == (cache[p] = "open" \/ p \in opt) /\ ~Completed(p)

\* deriveVisitProgress.activePoiId = planOrder.find(후보) (계획 순서에서 가장 앞)
ActiveIdx ==
  IF \E i \in Idx : Candidate(plan[i])
  THEN CHOOSE i \in Idx : Candidate(plan[i]) /\ \A j \in 1..(i-1) : ~Candidate(plan[j])
  ELSE 0

\* entities/itinerary-slot/lib/slotProgress.ts projectSlotProgress
SlotState(i) ==
  IF Completed(plan[i]) THEN "done"
  ELSE IF i = ActiveIdx THEN "active" ELSE "upcoming"

\* visitProgress.ts deriveSkippedPoiIds (그날 계획 레코드 중 skippedAt≠null)
SkippedC == {p \in Pois : cache[p] = "skipped"}

\* pages/live/live-itinerary/ui/LiveHubView.tsx canArriveAt
\*   onPressArrive !== undefined (오늘 ∧ 방문 기록 수신 — 가정으로 늘 참)
\*   ∧ state === 'upcoming'
\*   ∧ !skippedPoiIds.has(poi)
\*   ∧ (activeIndex < 0 ∨ index > activeIndex)
CanArriveAt(i) ==
  /\ SlotState(i) = "upcoming"
  /\ plan[i] \notin SkippedC
  /\ \/ ActiveIdx = 0
     \/ i > ActiveIdx

\* LiveHubView.tsx arriveAfterActive / showComplete
ArriveAfterActive == ActiveIdx > 0 /\ \E i \in Idx : CanArriveAt(i)
ShowComplete == Armed \/ ~ArriveAfterActive

\* pages/live/planb-request/ui/PlanbRequestPage.tsx → features/request-replan/model/replanRequest.ts
\*   excludedPoiIds: entrySeed?.excludedPoiIds → form.excludedPoiIds ?? []
\*   수동 진입(i10)엔 시드가 없어 늘 빈 목록. 건너뛴 장소를 싣지 않는다.
ExcludedSent == {}

(* ========================== CODE MIRROR 끝 ============================= *)

OnHub == rp \in {"none", "applied"}
\* 사용자가 허브를 보고 누를 수 있다 — 재계획 화면도, j01 건너뛰기 다이얼로그 대기도 아닐 때.
HubVisible == OnHub /\ skp = None
HubIdle == hub.k = "none"
AllIdle == HubIdle /\ cmp = None /\ skp = None

(***************************************************************************)
(* ASSUMPTION(서버) — backend/modules/archive VisitCheckService·VisitCheck   *)
(*  S1 도착: 그 슬롯에 기록이 이미 있으면 409(BR-U5-02), 없으면 "open".     *)
(*  S2 완료: "open" 만 완료된다(requireOpen, BR-U5-05/06), 아니면 409.     *)
(*  S3 건너뛰기: "open" 만 건너뛴다(j01 은 IN_PROGRESS 카드에만 버튼).     *)
(*  S4 재계획(ReplanSolver·ArchiveFacade.getCompletedSlots): 완료 슬롯은    *)
(*     잠그고(BR-U4-18) 진행 중 방문은 남긴다(BR-U4 2026-10-14 주). 건너뛴  *)
(*     곳은 "안 갔으니 바꿔도 된다" — 잠금도 제외도 아니다. 그 밖 장소는   *)
(*     excludedPoiIds 를 뺀 아무 장소나 새로 놓을 수 있다(AI 선택 = 비결정). *)
(*  네트워크 실패는 어느 요청에든 올 수 있다(서버 무변화).                  *)
(***************************************************************************)

Init ==
  /\ srv = [p \in Pois |-> "none"]
  /\ cache = [p \in Pois |-> "none"]
  /\ opt = {}
  /\ plan = InitPlan
  /\ hub = NoHub
  /\ cmp = None
  /\ skp = None
  /\ rp = "none"
  /\ sent = {}
  /\ draft = <<>>
  /\ skippedBack = FALSE

ReplanUnchanged == UNCHANGED <<plan, rp, sent, draft, skippedBack>>

(* ---------------- 허브 [도착] (LiveItineraryPage.tsx pressArrive) -------- *)
\* arriveBusy 또는 completeBusy 가 서 있으면 무시. 진행 중이 있으면 completeThenArrive, 없으면 arrive.
\* 진행 중 레코드가 낙관 id 면 completeThenArrive 는 요청 0(ignored) — 허브가 한가할 땐
\* 낙관 레코드가 없으므로(opt = {}) 그 갈래는 나타나지 않는다.
PressArrive(i) ==
  /\ HubVisible /\ HubIdle /\ cmp = None /\ CanArriveAt(i)
  /\ LET p == plan[i] IN
       IF ActiveIdx > 0
       THEN LET a == plan[ActiveIdx] IN
            \* useVisitCheck.complete: 낙관 완료(그 레코드만 completedAt)
            /\ cache' = [cache EXCEPT ![a] = "done"]
            /\ hub' = [k |-> "chainC", from |-> a, to |-> p]
            /\ UNCHANGED opt
       ELSE \* useVisitCheck.arrive: 낙관 레코드 append
            /\ opt' = opt \cup {p}
            /\ hub' = [k |-> "arrive", from |-> None, to |-> p]
            /\ UNCHANGED cache
  /\ UNCHANGED <<srv, cmp, skp>> /\ ReplanUnchanged

\* 사슬 1단 완료 성공 → 응답 레코드로 교체 → 곧바로 arrive(낙관 append). JS 상 한 틱 안.
ChainCompleteOk ==
  /\ hub.k = "chainC" /\ srv[hub.from] = "open"
  /\ srv' = [srv EXCEPT ![hub.from] = "done"]
  /\ cache' = [cache EXCEPT ![hub.from] = "done"]
  /\ opt' = opt \cup {hub.to}
  /\ hub' = [hub EXCEPT !.k = "chainA"]
  /\ UNCHANGED <<cmp, skp>> /\ ReplanUnchanged

\* 사슬 1단 완료가 네트워크로 실패 → 그 레코드만 completedAt=null, 도착은 안 보낸다.
ChainCompleteNetFail ==
  /\ hub.k = "chainC"
  /\ cache' = [cache EXCEPT ![hub.from] = IF @ = "done" THEN "open" ELSE @]
  /\ hub' = NoHub
  /\ UNCHANGED <<srv, opt, cmp, skp>> /\ ReplanUnchanged

\* 사슬 1단 완료를 서버가 409 로 거절(이미 건너뜀 등) → 롤백 + 그날 기록 재조회.
ChainCompleteRejected ==
  /\ hub.k = "chainC" /\ srv[hub.from] # "open"
  /\ cache' = srv
  /\ hub' = NoHub
  /\ UNCHANGED <<srv, opt, cmp, skp>> /\ ReplanUnchanged

\* 도착 성공 → 낙관 레코드를 서버 레코드로 교체(재조회 없음).
ArriveOk ==
  /\ hub.k \in {"arrive", "chainA"} /\ srv[hub.to] = "none"
  /\ srv' = [srv EXCEPT ![hub.to] = "open"]
  /\ cache' = [cache EXCEPT ![hub.to] = "open"]
  /\ opt' = opt \ {hub.to}
  /\ hub' = NoHub
  /\ UNCHANGED <<cmp, skp>> /\ ReplanUnchanged

\* 도착 실패(네트워크) → 낙관 레코드만 제거, 「도착을 기록하지 못했어요」.
ArriveNetFail ==
  /\ hub.k \in {"arrive", "chainA"}
  /\ opt' = opt \ {hub.to}
  /\ hub' = NoHub
  /\ UNCHANGED <<srv, cache, cmp, skp>> /\ ReplanUnchanged

\* 도착을 서버가 409 로 거절(그 슬롯에 기록이 이미 있음) → 같은 롤백·같은 안내.
ArriveRejected ==
  /\ hub.k \in {"arrive", "chainA"} /\ srv[hub.to] # "none"
  /\ opt' = opt \ {hub.to}
  /\ hub' = NoHub
  /\ UNCHANGED <<srv, cache, cmp, skp>> /\ ReplanUnchanged

(* ------------- 허브 단독 [방문 완료] (pressComplete, completeBusy) -------- *)
\* completeBusy — [방문 완료]는 이것만 본다(arriveBusy 와 다른 잠금). [도착]은 이 잠금도 본다(PressArrive 의 cmp = None).
\* 낙관 도착 레코드에 누르는 경로(서버 404 → 무변화)는 뺀다.
PressComplete ==
  /\ HubVisible /\ cmp = None /\ ActiveIdx > 0 /\ ShowComplete
  /\ LET a == plan[ActiveIdx] IN
       /\ cache[a] = "open"
       /\ cache' = [cache EXCEPT ![a] = "done"]
       /\ cmp' = a
  /\ UNCHANGED <<srv, opt, hub, skp>> /\ ReplanUnchanged

CompleteOk ==
  /\ cmp # None /\ srv[cmp] = "open"
  /\ srv' = [srv EXCEPT ![cmp] = "done"]
  /\ cache' = [cache EXCEPT ![cmp] = "done"]
  /\ cmp' = None
  /\ UNCHANGED <<opt, hub, skp>> /\ ReplanUnchanged

\* 실패(네트워크·409) → 그 레코드만 completedAt=null. 단독 완료는 재조회하지 않는다.
CompleteFail ==
  /\ cmp # None
  /\ cache' = [cache EXCEPT ![cmp] = IF @ = "done" THEN "open" ELSE @]
  /\ cmp' = None
  /\ UNCHANGED <<srv, opt, hub, skp>> /\ ReplanUnchanged

(* ------------- j01 건너뛰기 (TripRecordsPage handleConfirmSkip) ---------- *)
\* VisitRecordCard canSkip: IN_PROGRESS(서버발 레코드) — 낙관 id 엔 버튼 없음.
\* ASSUMPTION: 허브 요청이 다 끝난 뒤 기록 화면으로 간다(동시 진행 경합은 모델 밖).
J01Skip(p) ==
  /\ AllIdle /\ OnHub
  /\ cache[p] = "open" /\ p \notin opt
  /\ cache' = [cache EXCEPT ![p] = "skipped"]
  /\ skp' = p
  /\ UNCHANGED <<srv, opt, hub, cmp>> /\ ReplanUnchanged

SkipOk ==
  /\ skp # None /\ srv[skp] = "open"
  /\ srv' = [srv EXCEPT ![skp] = "skipped"]
  /\ cache' = [cache EXCEPT ![skp] = "skipped"]
  /\ skp' = None
  /\ UNCHANGED <<opt, hub, cmp>> /\ ReplanUnchanged

SkipFail ==
  /\ skp # None
  /\ cache' = [cache EXCEPT ![skp] = IF @ = "skipped" THEN "open" ELSE @]
  /\ skp' = None
  /\ UNCHANGED <<srv, opt, hub, cmp>> /\ ReplanUnchanged

\* react-query 재조회(화면 진입·포커스). ASSUMPTION: 요청이 다 끝났을 때만.
Refetch ==
  /\ AllIdle /\ cache # srv
  /\ cache' = srv
  /\ UNCHANGED <<srv, opt, hub, cmp, skp>> /\ ReplanUnchanged

(* ---------------- Plan-B (planb-request → solving → draft → apply) -------- *)
RequestReplan ==
  /\ OnHub /\ AllIdle
  /\ rp' = "solving"
  /\ sent' = ExcludedSent
  /\ UNCHANGED <<srv, cache, opt, plan, hub, cmp, skp, draft, skippedBack>>

Kept == SelectSeq(plan, LAMBDA p : srv[p] \in {"done", "open"})
NewSeqs(S) ==
  {f \in UNION {[1..n -> S] : n \in 0..MaxNew} :
     \A i, j \in DOMAIN f : i # j => f[i] # f[j]}

ServerDraft ==
  /\ rp = "solving"
  /\ \E s \in NewSeqs(Pois \ (Range(Kept) \cup sent)) :
       draft' = Kept \o s
  /\ rp' = "draft"
  /\ UNCHANGED <<srv, cache, opt, plan, hub, cmp, skp, sent, skippedBack>>

\* 대안 없음·실패 얼굴 → 원 일정 그대로 허브로.
ServerNoDraft ==
  /\ rp = "solving"
  /\ rp' = "none"
  /\ UNCHANGED <<srv, cache, opt, plan, hub, cmp, skp, sent, draft, skippedBack>>

\* 「나가기」 — 서버에 아무것도 보내지 않는다(BR-U4-28).
Leave ==
  /\ rp \in {"solving", "draft"}
  /\ rp' = "none"
  /\ UNCHANGED <<srv, cache, opt, plan, hub, cmp, skp, sent, draft, skippedBack>>

\* 「적용하기」 성공 — 일정이 초안으로 바뀐다(useApplyReplan: itinerary 무효화). 방문 기록 캐시는 그대로.
Apply ==
  /\ rp = "draft"
  /\ plan' = draft
  /\ rp' = "applied"
  /\ skippedBack' = (skippedBack \/ \E p \in Range(draft) : srv[p] = "skipped")
  /\ UNCHANGED <<srv, cache, opt, hub, cmp, skp, sent, draft>>

YouPressArrive == \E i \in Idx : PressArrive(i)
YouSkipInJ01 == \E p \in Pois : J01Skip(p)

Next ==
  \/ YouPressArrive
  \/ ChainCompleteOk \/ ChainCompleteNetFail \/ ChainCompleteRejected
  \/ ArriveOk \/ ArriveNetFail \/ ArriveRejected
  \/ PressComplete \/ CompleteOk \/ CompleteFail
  \/ YouSkipInJ01
  \/ SkipOk \/ SkipFail
  \/ Refetch
  \/ RequestReplan \/ ServerDraft \/ ServerNoDraft \/ Leave \/ Apply

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* 속성                                                                    *)
(***************************************************************************)
Status == {"none", "open", "done", "skipped"}
TypeOK ==
  /\ srv \in [Pois -> Status] /\ cache \in [Pois -> Status]
  /\ opt \subseteq Pois
  /\ rp \in {"none", "solving", "draft", "applied"}

\* P1 (FM-L4-01) 건너뛴 장소 카드에는 [도착]이 서지 않는다.
NoArriveOnSkipped ==
  HubVisible => \A i \in Idx : CanArriveAt(i) => plan[i] \notin SkippedC

\* P2 (FM-L4-05) 재계획을 적용한 새 일정에 이미 건너뛴 장소가 다시 들어오지 않는다.
ReplanKeepsSkippedOut == ~skippedBack

\* P3 요청이 다 끝난 뒤, 서버에 "도착했지만 안 끝난" 방문은 하루에 많아야 하나다.
\*    (요청이 오가는 사이 잠깐 둘이 되는 순간은 묻지 않는다.)
OneOpenVisit == AllIdle => Cardinality({p \in Pois : srv[p] = "open"}) <= 1

\* P4 (BR-U10-56 갇힘 방지) 진행 중 카드가 있으면 그 방문을 끝낼 버튼
\*    ([방문 완료] 또는 그 뒤 카드의 [도착])이 적어도 하나 선다.
ActiveCanFinish ==
  (OnHub /\ ActiveIdx > 0) => (ShowComplete \/ \E i \in Idx : CanArriveAt(i))
=============================================================================
