---- MODULE MCTapGuard ----
EXTENDS TapGuard

(***************************************************************************)
(* ===================== CODE MIRROR — 경로별 배선(읽어서 대조) ============= *)
(* 필드 뜻:                                                                 *)
(*  guard          onPress 를 guardPress(...) 로 감쌌다                      *)
(*  lock           핸들러가 잠금 ref 를 누를 때 세우고 실패에서만 푼다         *)
(*  pendingDisabled 요청 중 버튼이 disabled                                   *)
(*  request        누름이 요청을 보낸다(FALSE = 곧바로 이동)                   *)
(*  latestOnly     호출별 콜백이 TanStack mutate 두 번째 인자(마지막 호출만)   *)
(*  openOnOk       성공 콜백이 openPressGuardWindow() 를 부른다               *)
(*  leaveOnOk      성공 콜백이 표면을 치운다(closeSheet·onExit·replace)        *)
(*  flipOnHookOk   훅 수준 onSuccess(캐시 쓰기)가 표면을 바꾼다                *)
(*  conflict       서버가 성공 뒤 같은 요청을 409 로 거절한다(A3)              *)
(*  noteOnNext     실패 안내가 바뀐 표면에서도 보인다(같은 페이지 안에서 CTA 만 바뀜) *)
(***************************************************************************)
MCFlags == [
  \* pages/home/ui/HomePage.tsx pushDestination = guardPress(target => router.push(...))
  \* (TripCardContainer onPress · MyPage onPress* · ExploreLanding onSeeAll 등 이동 전용 guardPress 와 같은 모양)
  nav |-> [guard |-> TRUE, lock |-> FALSE, pendingDisabled |-> FALSE, request |-> FALSE,
           latestOnly |-> FALSE, openOnOk |-> FALSE, leaveOnOk |-> FALSE,
           flipOnHookOk |-> FALSE, conflict |-> FALSE, noteOnNext |-> FALSE],
  \* pages/trip/trip-new-step2/ui/TripNewStep2Page.tsx onAssign={guardPress(handleAssign)}
  \*   assignLockRef: 누를 때 true · onError 에서만 false · onSuccess: openPressGuardWindow(); closeSheet()
  assign |-> [guard |-> TRUE, lock |-> TRUE, pendingDisabled |-> FALSE, request |-> TRUE,
              latestOnly |-> TRUE, openOnOk |-> TRUE, leaveOnOk |-> TRUE,
              flipOnHookOk |-> FALSE, conflict |-> TRUE, noteOnNext |-> FALSE],
  \* pages/trip/trip-new-step1/ui/TripNewStep1Page.tsx LeaveDialogContainer onDelete={guardPress(remove)}
  \*   lockedRef: 누를 때 true · 실패(404 아님)에서만 false · done(): openPressGuardWindow(); onExit()
  \*   deleteTripsTripId(...).then — 평범한 promise(호출마다 콜백) · 404 = done(conflict 아님)
  delete |-> [guard |-> TRUE, lock |-> TRUE, pendingDisabled |-> FALSE, request |-> TRUE,
              latestOnly |-> FALSE, openOnOk |-> TRUE, leaveOnOk |-> TRUE,
              flipOnHookOk |-> FALSE, conflict |-> FALSE, noteOnNext |-> FALSE],
  \* pages/itinerary/itinerary-plan/ui/ItineraryPlanPage.tsx onPress: guardPress(handleConfirm)
  \*   잠금 ref 없음 · disabled: isConfirmLocked(PARTIAL) || confirm.isPending(TRIP-1688 FV-TAP-01 수정) ·
  \*   confirm.mutate(..., {onSuccess: openPressGuardWindow+토스트, onError: setConfirmError}) ·
  \*   훅 useConfirmItinerary onSuccess = setQueryData(CONFIRMED) → CTA 가 [일정 수정]으로
  \*   (누른 뒤 isPending 이 렌더되기 전 틈은 guardPress 창 안이라 모델처럼 곧바로 비활성으로 본다)
  confirm |-> [guard |-> TRUE, lock |-> FALSE, pendingDisabled |-> TRUE, request |-> TRUE,
               latestOnly |-> TRUE, openOnOk |-> TRUE, leaveOnOk |-> FALSE,
               flipOnHookOk |-> TRUE, conflict |-> TRUE, noteOnNext |-> TRUE],
  \* pages/onboarding/onboarding-location/ui/LocationPage.tsx default 얼굴 onProceed={handleAllow}
  \*   가드 없음 · allowLockRef: 누를 때 true, 풀지 않는다(TRIP-1688 FV-TAP-02 수정) — 거부·오류면 denied 프레임으로
  \*   바뀌어 이 버튼이 사라진다(모델의 "실패에서 풂"은 사라진 버튼의 재시도를 허용하는 쪽이라 더 느슨하다) ·
  \*   requestForegroundPermissionsAsync().then(granted → openPressGuardWindow(); goToPush())
  \*   이미 허용된 기기 = OS 창 없이 곧장 granted(A3: 다시 물어도 granted)
  allow |-> [guard |-> FALSE, lock |-> TRUE, pendingDisabled |-> FALSE, request |-> TRUE,
             latestOnly |-> FALSE, openOnOk |-> TRUE, leaveOnOk |-> TRUE,
             flipOnHookOk |-> FALSE, conflict |-> FALSE, noteOnNext |-> FALSE]
]
(* ========================== CODE MIRROR 끝 ============================= *)
====
