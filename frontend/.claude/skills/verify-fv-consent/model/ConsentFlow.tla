---------------------------- MODULE ConsentFlow ----------------------------
(***************************************************************************)
(* 설정의 동의 토글 두 개(위치 l06 · 개인화 l05)와 위치 권한 미러 보고를,     *)
(* 같은 계정의 두 기기(앱 · 웹)가 동시에 쓰는 흐름.                          *)
(*                                                                         *)
(* 무엇을 모델링하나: 화면이 보여 주는 토글 값(react-query 캐시 → 훅 도출),  *)
(* 누름이 보내는 값, 연타 잠금, 성공 뒤 재조회, 실패·응답 유실·재조회 실패,  *)
(* 화면 이탈·재진입, 진입마다 보내는 OS 권한 미러 보고. 서버는 "응답"으로만 *)
(* 등장하고 그 규칙은 ASSUMPTION 주석으로 적는다.                           *)
(*                                                                         *)
(* 코드 대응: 각 정의 옆 주석의 파일·식(경로는 frontend/ 기준).            *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Devs,     \* 같은 계정의 기기들 — {"app", "web"}
  Kinds,    \* 동의 종류 — "loc"(위치 L2·L3 한 토글) · "pers"(개인화)
  MaxReq,   \* 모델 전체에서 보낼 수 있는 동의 변경 요청 수 상한(모델 크기 제한)
  Perm      \* 기기별 OS 위치 권한(expo-location 이 돌려주는 값을 서버 enum 으로 옮긴 것)

None == "-"
Reqs == 1..MaxReq
Ph == {"unused", "send", "refetch", "done"}

VARIABLES
  srv,      \* 서버 현재 동의: kind -> BOOLEAN (위치 = legalConsent, 개인화 = 최신 증적이 GRANT 인가)
  last,     \* 서버 증적(append-only)의 마지막 행: kind -> "none"|"grant"|"revoke"
  dup,      \* 유령: 같은 동작이 연달아 두 번 증적에 쌓인 적이 있나 (kind -> BOOLEAN)
  writer,   \* 유령: 서버가 마지막으로 반영한 동의 변경 요청을 보낸 기기 (kind -> Devs ∪ {None})
  data,     \* 기기별 react-query 캐시: dev -> kind -> "none"(미수신)|"on"|"off"
  err,      \* 기기별 조회 오류 표시(isError — 재조회 실패 뒤 데이터는 남고 오류가 선다)
  req,      \* 동의 변경 요청: id -> [d, k, v(보낸 값), ph]
  busy,     \* 위치 화면 잠금(inFlightRef/isPending): dev -> 잠금을 쥔 요청 id 또는 0
  mounted,  \* 위치 화면이 떠 있나: dev -> BOOLEAN
  mir,      \* 서버 L1 OS 권한 미러
  mp,       \* 진입 미러 보고(PATCH os-permission) 요청 중인가: dev -> BOOLEAN
  appMir,   \* 유령: 앱이 미러를 한 번이라도 보고했나
  lf        \* 위치 화면 마운트 조회 중인가(재진입 시 react-query 가 낡은 캐시를 다시 받는 중): dev -> BOOLEAN

vars == <<srv, last, dup, writer, data, err, req, busy, mounted, mir, mp, appMir, lf>>

(***************************************************************************)
(* ===================== CODE MIRROR (적합성 테스트가 대조) ================ *)
(* 이 구역의 식은 실제 코드의 판정을 그대로 옮긴 것이다.                    *)
(* checks/conformance.check.tsx 의 model* 함수와 같은 식이어야 한다 —       *)
(* 코드를 바꾸면 둘을 함께 고친다.                                          *)
(***************************************************************************)

\* shared/location/useLocationConsent.ts — status: isError → 'error', data 없음 → 'loading', 아니면 'ready'.
\* LocationConsentScreen: ready 일 때만 토글을 그린다(로딩·오류는 다른 얼굴). consentOn = data.legalConsent.
ShownLoc(d) ==
  IF err[d]["loc"] \/ data[d]["loc"] = "none" THEN "hidden" ELSE data[d]["loc"]

\* pages/settings/settings-personalization/model/usePersonalization.ts —
\*   reason = data?.reason ?? CONSENT_MISSING; consentOn = reason ≠ CONSENT_MISSING. isError 는 보지 않는다.
ShownPers(d) ==
  IF data[d]["pers"] = "none" THEN "off" ELSE data[d]["pers"]

\* pages/settings/settings/model/settingsSections.ts consentChip(locationConsent.data?.gpsRecordingOptIn) —
\*   l05 목록의 위치 칩은 isError 를 보지 않는다(데이터가 있으면 칩). 개인화 `사용 중` 은 ShownPers 와 같은 캐시·같은 식.
ChipLoc(d) == IF data[d]["loc"] = "none" THEN "hidden" ELSE data[d]["loc"]

Shown(d, k) == IF k = "loc" THEN ShownLoc(d) ELSE ShownPers(d)

\* 누름이 보내는 값 — 위치: off 면 grant()=consentPutBody(true), on 이면 다이얼로그 뒤 revoke()=consentPutBody(false).
\*                    개인화: consentOn ? 'REVOKE' : 'GRANT'.  둘 다 "보이는 값의 반대".
Intent(d, k) == Shown(d, k) # "on"

\* useLocationConsent.save: inFlightRef.current || put.isPending 이면 무시. 개인화 onToggle 엔 잠금이 없다.
CanTap(d, k) ==
  IF k = "loc" THEN mounted[d] /\ ShownLoc(d) # "hidden" /\ busy[d] = 0
  ELSE TRUE

\* useLocationConsent toOsPermission — 진입 미러 보고 값. 기기 권한을 그대로 옮긴다.
Reported(d) == Perm[d]

(* ========================== CODE MIRROR 끝 ============================= *)

(***************************************************************************)
(* ASSUMPTION(서버) — backend/modules/auth                                  *)
(*  S1 위치 PUT(LocationConsentService.update): 값이 실제로 바뀔 때만        *)
(*     consent_record·location_legal_log 를 쌓는다. 같은 값 PUT 은 무기록.  *)
(*  S2 개인화 PATCH(ConsentService.changeConsent): 현재 상태와 무관하게      *)
(*     매번 consent_record 를 한 행 쌓는다(append-only, 중복 거름 없음).     *)
(*  S3 미러 PATCH(mirrorOsPermission): L1 만 덮어쓴다. 증적·법정 로그 없음.  *)
(*  S4 서버는 요청 하나를 한 덩어리로 처리한다 — 위치 update 는 find 에 잠금이 *)
(*     없어 같은 계정 PUT 두 개가 동시에 들어오면 둘 다 기록할 수 있으나 이  *)
(*     경합은 모델 밖(백엔드 몫)이다.                                       *)
(*  네트워크: 요청이 서버에 닿기 전 실패 · 서버 반영 뒤 응답 유실 · 재조회 실패. *)
(***************************************************************************)

(***************************************************************************)
(* ASSUMPTION(클라이언트)                                                  *)
(*  C1 l05 설정 목록이 스택 아래에 떠 있다 — 두 동의 쿼리는 늘 활성이라      *)
(*     invalidateQueries 가 곧바로 다시 받는다. l05 칩은 늘 보인다.          *)
(*  C2 개인화 화면(l05 개인화)은 늘 떠 있다고 본다(마운트·이탈 미모델 —     *)
(*     onToggle 의 async 는 이탈과 무관하게 끝까지 돈다).                   *)
(*  C3 위치 토글 disabled(미러 DENIED ∧ 단말 미허용)는 모델 밖 — 앱 GRANTED,*)
(*     웹 NOT_DETERMINED 라 disabled 가 서지 않는다.                       *)
(*  W1 웹의 expo-location 은 NOT_DETERMINED 를 돌려준다(2026-10-31 웹 QA 관측). *)
(*  조회(Load)는 그 기기·그 종류 요청이 없을 때만 일어난다.                  *)
(***************************************************************************)

Init ==
  /\ srv = [k \in Kinds |-> FALSE]
  /\ last = [k \in Kinds |-> "none"]
  /\ dup = [k \in Kinds |-> FALSE]
  /\ writer = [k \in Kinds |-> None]
  /\ data = [d \in Devs |-> [k \in Kinds |-> "none"]]
  /\ err = [d \in Devs |-> [k \in Kinds |-> FALSE]]
  /\ req = [i \in Reqs |-> [d |-> None, k |-> None, v |-> FALSE, ph |-> "unused"]]
  /\ busy = [d \in Devs |-> 0]
  /\ mounted = [d \in Devs |-> FALSE]
  /\ mir = "NOT_DETERMINED"
  /\ mp = [d \in Devs |-> FALSE]
  /\ appMir = FALSE
  /\ lf = [d \in Devs |-> FALSE]

InFlight(i) == req[i].ph \in {"send", "refetch"}
AllIdle == (\A i \in Reqs : ~InFlight(i)) /\ (\A d \in Devs : ~mp[d] /\ ~lf[d])
Busy(d, k) == \E i \in Reqs : InFlight(i) /\ req[i].d = d /\ req[i].k = k
Free == {i \in Reqs : req[i].ph = "unused"}
VB(b) == IF b THEN "on" ELSE "off"

\* 요청이 끝나면 위치 잠금을 푼다 — 같은 마운트의 잠금일 때만(재진입하면 새 ref·새 observer).
\* useMutation onSettled 는 onSuccess(invalidateQueries 재조회)를 await 한 뒤에 돈다(query-core mutation.js).
Release(i) == busy' = [busy EXCEPT ![req[i].d] = IF @ = i THEN 0 ELSE @]

(* ---------------- 화면 진입·이탈 (위치 l06) ------------------------------ *)
\* 진입 = 새 마운트: 잠금은 새 ref(false), 진입 미러 보고 1회(mirroredRef), 조회는 아래 Load 로.
Enter(d) ==
  /\ ~mounted[d]
  /\ mounted' = [mounted EXCEPT ![d] = TRUE]
  /\ busy' = [busy EXCEPT ![d] = 0]
  /\ mp' = [mp EXCEPT ![d] = TRUE]
  /\ lf' = [lf EXCEPT ![d] = TRUE]
  /\ UNCHANGED <<srv, last, dup, writer, data, err, req, mir, appMir>>

\* 이탈 — 보낸 요청은 계속 간다(useMutation 훅 옵션 콜백은 언마운트 뒤에도 돈다).
Leave(d) ==
  /\ mounted[d]
  /\ mounted' = [mounted EXCEPT ![d] = FALSE]
  /\ UNCHANGED <<srv, last, dup, writer, data, err, req, busy, mir, mp, appMir, lf>>

\* 조회(마운트·재진입 시 react-query 조회). ASSUMPTION: 그 기기·그 종류 요청이 없을 때만.
Load(d, k) ==
  /\ ~Busy(d, k)
  /\ k = "loc" => (mounted[d] \/ lf[d])   \* 떠나도 시작한 마운트 조회는 끝나 캐시를 채운다
  /\ data' = [data EXCEPT ![d][k] = VB(srv[k])]
  /\ err' = [err EXCEPT ![d][k] = FALSE]
  /\ lf' = IF k = "loc" THEN [lf EXCEPT ![d] = FALSE] ELSE lf
  /\ UNCHANGED <<srv, last, dup, writer, req, busy, mounted, mir, mp, appMir>>

(* ---------------- 토글 누름 ---------------------------------------------- *)
Tap(d, k) ==
  /\ CanTap(d, k)
  /\ Free # {}
  /\ LET i == CHOOSE j \in Free : \A j2 \in Free : j <= j2 IN
       /\ req' = [req EXCEPT ![i] = [d |-> d, k |-> k, v |-> Intent(d, k), ph |-> "send"]]
       /\ busy' = IF k = "loc" THEN [busy EXCEPT ![d] = i] ELSE busy
  /\ UNCHANGED <<srv, last, dup, writer, data, err, mounted, mir, mp, appMir, lf>>

\* 서버가 요청을 반영한다(S1·S2). ok = 응답이 온다 → 재조회 단계, ok = FALSE = 응답 유실(클라 실패로 끝).
ServerApply(i, ok) ==
  /\ req[i].ph = "send"
  /\ LET k == req[i].k
         v == req[i].v
         act == IF v THEN "grant" ELSE "revoke"
         logs == (k = "pers") \/ (v # srv[k])
     IN
       /\ srv' = [srv EXCEPT ![k] = v]
       /\ last' = IF logs THEN [last EXCEPT ![k] = act] ELSE last
       /\ dup' = IF logs /\ last[k] = act THEN [dup EXCEPT ![k] = TRUE] ELSE dup
       /\ writer' = [writer EXCEPT ![k] = req[i].d]
  /\ IF ok
     THEN /\ req' = [req EXCEPT ![i].ph = "refetch"]
          /\ UNCHANGED busy
     ELSE /\ req' = [req EXCEPT ![i].ph = "done"]
          /\ Release(i)
  /\ UNCHANGED <<data, err, mounted, mir, mp, appMir, lf>>

\* 서버에 닿기 전 실패(네트워크·약관 조회 실패) — 서버 무변화. 위치는 saveFailed, 개인화는 아무 표시 없음.
SendFail(i) ==
  /\ req[i].ph = "send"
  /\ req' = [req EXCEPT ![i].ph = "done"]
  /\ Release(i)
  /\ UNCHANGED <<srv, last, dup, writer, data, err, mounted, mir, mp, appMir, lf>>

\* 성공 뒤 invalidateQueries 재조회. 활성 쿼리만 다시 받는데, l06 을 떠나도 스택 아래 l05(SettingsPage)가
\* 같은 쿼리(useGetMeLocationConsent·useGetMePersonalization)를 구독하고 있어 늘 활성이다(ASSUMPTION C1).
\* (첫 모델은 "l06 을 떠나면 재조회 없음"으로 적어 거짓 반례를 냈다 — 모델 오류였다.)
RefetchOk(i) ==
  /\ req[i].ph = "refetch"
  /\ data' = [data EXCEPT ![req[i].d][req[i].k] = VB(srv[req[i].k])]
  /\ err' = [err EXCEPT ![req[i].d][req[i].k] = FALSE]
  /\ req' = [req EXCEPT ![i].ph = "done"]
  /\ Release(i)
  /\ UNCHANGED <<srv, last, dup, writer, mounted, mir, mp, appMir, lf>>

\* 재조회 실패 — 데이터는 남고 isError 가 선다.
RefetchFail(i) ==
  /\ req[i].ph = "refetch"
  /\ err' = [err EXCEPT ![req[i].d][req[i].k] = TRUE]
  /\ req' = [req EXCEPT ![i].ph = "done"]
  /\ Release(i)
  /\ UNCHANGED <<srv, last, dup, writer, data, mounted, mir, mp, appMir, lf>>

(* ---------------- 진입 미러 보고 (S3) ----------------------------------- *)
MirrorOk(d) ==
  /\ mp[d]
  /\ mir' = Reported(d)
  /\ mp' = [mp EXCEPT ![d] = FALSE]
  /\ appMir' = (appMir \/ d = "app")
  /\ UNCHANGED <<srv, last, dup, writer, data, err, req, busy, mounted, lf>>

MirrorFail(d) ==
  /\ mp[d]
  /\ mp' = [mp EXCEPT ![d] = FALSE]
  /\ UNCHANGED <<srv, last, dup, writer, data, err, req, busy, mounted, mir, appMir, lf>>

YouTap == \E d \in Devs, k \in Kinds : Tap(d, k)
YouEnter == \E d \in Devs : Enter(d)
YouLeave == \E d \in Devs : Leave(d)
FetchConsent == \E d \in Devs, k \in Kinds : Load(d, k)
ServerSaves == \E i \in Reqs : ServerApply(i, TRUE)
ServerSavesReplyLost == \E i \in Reqs : ServerApply(i, FALSE)
SaveFails == \E i \in Reqs : SendFail(i)
RefetchArrives == \E i \in Reqs : RefetchOk(i)
RefetchFails == \E i \in Reqs : RefetchFail(i)
MirrorReported == \E d \in Devs : MirrorOk(d)
MirrorReportFails == \E d \in Devs : MirrorFail(d)

Next ==
  \/ YouTap \/ YouEnter \/ YouLeave \/ FetchConsent
  \/ ServerSaves \/ ServerSavesReplyLost \/ SaveFails
  \/ RefetchArrives \/ RefetchFails
  \/ MirrorReported \/ MirrorReportFails

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* 속성                                                                    *)
(***************************************************************************)
TypeOK ==
  /\ srv \in [Kinds -> BOOLEAN]
  /\ last \in [Kinds -> {"none", "grant", "revoke"}]
  /\ data \in [Devs -> [Kinds -> {"none", "on", "off"}]]
  /\ \A i \in Reqs : req[i].ph \in Ph
  /\ busy \in [Devs -> 0..MaxReq]
  /\ mir \in {"GRANTED", "DENIED", "NOT_DETERMINED"}

\* P1 요청이 다 끝난 뒤, 마지막으로 동의를 바꾼 기기의 화면은 서버 동의 상태와 같은 값을 보인다
\*    (토글 대신 로딩·오류 얼굴이면 값을 주장하지 않으므로 묻지 않는다).
\*    위치는 두 표면 — 떠 있는 l06 토글, 그리고 스택 아래 l05 목록 칩(늘 있다고 본다).
Agrees(d, k, shown) == (writer[k] = d /\ shown # "hidden") => shown = VB(srv[k])
ShownMatchesServer(k) ==
  AllIdle => \A d \in Devs : Agrees(d, k, Shown(d, k))
ShownMatchesServerLoc ==
  AllIdle => \A d \in Devs : (mounted[d] => Agrees(d, "loc", ShownLoc(d))) /\ Agrees(d, "loc", ChipLoc(d))
ShownMatchesServerPers == ShownMatchesServer("pers")

\* P2 같은 동의 동작(승낙·철회)을 법적 증적에 연달아 두 번 쌓지 않는다.
NoDuplicateRecordLoc == ~dup["loc"]
NoDuplicateRecordPers == ~dup["pers"]

\* P3 요청이 다 끝난 뒤, 서버의 OS 위치 권한 미러는 위치를 실제로 쓰는 앱 기기의 권한과 같다
\*    (앱이 한 번이라도 보고한 뒤).
MirrorFollowsApp == (AllIdle /\ appMir) => mir = Perm["app"]
=============================================================================
