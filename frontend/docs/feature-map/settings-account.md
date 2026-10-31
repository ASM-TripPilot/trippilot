---
id: settings-account
band: l
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/settings/index.tsx
---

# 로그아웃 · 계정 삭제

설정의 계정 그룹 `로그아웃`과 위험 영역 `계정 삭제`. 로그아웃은 확인 다이얼로그 1단을 거쳐 토큰·푸시 등록을 지우고 로그인 화면으로 보낸다. 계정 삭제는 2단 다이얼로그(삭제 범위 고지 → 최종 확인)를 거쳐 삭제 요청을 보내고, 이후 30일 유예 동안 같은 자리에 "계정 삭제가 예정되어 있어요" 배너와 [삭제 철회]가 보인다. **둘 다 QA에서 확정 버튼을 누르지 않는다** — 다이얼로그를 열고 취소로 닫는 데까지만 증명한다.

## Sub-features

- `logout-dialog` `로그아웃` 행 → 확인 다이얼로그 "로그아웃할까요?" [취소]/[로그아웃].
- `logout-cancel` [취소] → 다이얼로그만 닫힌다(아무 요청 없음).
- `logout-confirm` [로그아웃] → 푸시 토큰 해제 → 로그아웃 → 로그인 화면으로 replace. **비가역 — QA 실행 금지.**
- `delete-step1` `계정 삭제` 행 → "계정을 삭제할까요?" + 함께 삭제되는 항목 8개 목록 + [취소]/[계속].
- `delete-step2` [계속] → "정말 삭제할까요?" + 30일 유예 안내 + [취소]/[계정 삭제].
- `delete-cancel` 어느 단계에서든 [취소] → 다이얼로그가 닫히고 요청 없음.
- `delete-confirm` [계정 삭제] → 삭제 요청, 성공 시 행 자리가 유예 배너로 바뀐다. **QA 실행 금지.**
- `delete-request-error` 삭제 요청 실패 → 행 아래 "삭제 요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요."
- `deletion-pending` 유예 중 계정은 진입부터 배너 "계정 삭제가 예정되어 있어요"(요청 직후 세션엔 "삭제 예정일 YYYY-MM-DD"도).
- `deletion-cancel` [삭제 철회] → 성공 시 `계정 삭제` 행으로 복귀, 실패 시 안내 문구.

## How to get to it (user POV)

- 설정 화면(`settings.md`)의 계정 그룹 `로그아웃` 행, 위험 영역 `계정 삭제` 행.
- 딥링크 `trippilot:///settings` 후 같은 행.

## Driving it with agent-device

Preconditions:

- 로그인된 계정, 설정 화면이 열려 있다.
- 유예 배너(`deletion-pending`)는 **이미 삭제 요청된(DELETION_PENDING) 계정**이 있어야 볼 수 있다 — QA가 일부러 만들지 않는다. 그런 계정이 없으면 이 항목은 미확인으로 남긴다.
- 로그아웃 후 재로그인은 시뮬에서 불가능하다고 본다(trippilot-sim-qa §5) — 확정 버튼을 누르지 않는다.

- **로그아웃 다이얼로그 열기.** testID: `settings-row-logout`("로그아웃")를 누른다 → testID: `logout-confirm` 다이얼로그에 "로그아웃할까요?", 버튼 testID: `logout-cancel`("취소")·`logout-confirm-button`("로그아웃").
- **로그아웃 취소.** testID: `logout-cancel` → 다이얼로그가 사라지고 설정 목록이 그대로. testID: `logout-confirm-button` 은 **누르지 않는다**.
- **삭제 1단.** 위험 영역의 testID: `settings-delete-account`("계정 삭제")를 누른다 → "계정을 삭제할까요?", "아래 항목이 계정과 함께 모두 삭제돼요.", 목록 "등록한 숙소"·"여행 기록과 일정"·"방문 기록과 사진 메타데이터"·"작성한 메모"·"여행 회고"·"여행 요약"·"취향 스타일 분석"·"받은 알림함" 8줄, 버튼 testID: `settings-delete-cancel`("취소")·`settings-delete-confirm`("계속").
- **삭제 1단 취소.** testID: `settings-delete-cancel` → 다이얼로그가 닫히고 `settings-delete-account` 행이 그대로.
- **삭제 2단.** 다시 열고 testID: `settings-delete-confirm`("계속") → "정말 삭제할까요?"와 "확인하면 계정과 위의 모든 데이터가 삭제 절차에 들어가고, 30일 뒤 완전히 삭제돼요. 그 전에는 설정에서 삭제를 취소할 수 있어요.", 버튼 testID: `settings-delete-cancel`("취소")·`settings-delete-confirm-final`("계정 삭제").
- **삭제 2단 취소.** testID: `settings-delete-cancel` → 닫힘. testID: `settings-delete-confirm-final` 은 **누르지 않는다**. 닫은 뒤 행이 여전히 "계정 삭제"이고 testID: `settings-deletion-pending` 이 없는지 본다(요청이 안 나갔다는 화면 증거).
- **유예 배너(해당 계정만).** testID: `settings-deletion-pending` 에 "계정 삭제가 예정되어 있어요"와 testID: `settings-deletion-cancel`("삭제 철회"). 철회는 계정 상태를 되돌리는 쓰기라 사용자 확인 없이 누르지 않는다. 눌렀다면 성공 시 `settings-delete-account` 행 복귀, 실패 시 testID: `settings-deletion-cancel-error`.
- **증거.** 두 다이얼로그의 각 단계 스크린샷과, 취소 뒤 설정 목록 스크린샷.

## Gotchas

- 다이얼로그는 RN Modal이 아니라 조건부 렌더 오버레이(`shared/ui/ConfirmDialog`)다 — 딤이 화면 전체를 덮는지·가운데 정렬·뒤 목록 터치 차단은 실화면으로만 확인된다. [실화면 전용]
- 계정 삭제 다이얼로그 자체(카드)에는 testID가 없다 — 열림 판정은 버튼 testID나 제목 문구로 한다. 로그아웃 다이얼로그는 루트에 `logout-confirm` testID가 있어 버튼 `logout-confirm-button` 과 이름이 비슷하다 — 섞어 누르지 않는다.
- 두 단계의 [취소] 버튼 testID가 같다(`settings-delete-cancel`) — 어느 단계인지는 제목 문구로 구분한다.
- 로그아웃 확정은 게이트가 LOGIN을 열 때까지 기다렸다가 캐시를 비우고 `/login` 으로 replace한다 — 실행하면 뒤로가기로 설정에 못 돌아온다. 세션 만료 UX도 같은 경로(traps-onboarding-auth)다.
- 삭제 요청 성공 시 이 기기의 푸시 토큰을 해제하고, 철회 성공 시 조용히 재등록한다 — 화면에 보이지 않는 부수효과다.
- "삭제 예정일"은 삭제 요청 응답에서만 오므로, 유예 중 계정으로 새로 들어오면 날짜 줄 없이 배너만 보인다(정상).
- [삭제 철회] 실패 안내는 원인과 상관없이 "철회할 유예가 없어요. 이미 처리되었거나 만료된 상태예요." 한 문구다 — 네트워크 오류에서도 이 문구가 나온다(결함 후보, 보고에 기록).
- 삭제 범위 목록과 실제 데이터(담은 장소·도우미 대화 등)가 다를 수 있다는 지적이 지난 QA(20261021 N-086)에 있다 — 법무 판단 사안이라 QA 판정 대상이 아니다.
- [실화면] 2026-10-31 두 다이얼로그의 버튼은 접근성 트리에 testID 대신 라벨 `취소`·`로그아웃`·`계속`·`계정 삭제`로 잡힌다 — `role=button label="취소"` 로 누른다. 로그아웃 다이얼로그 루트 `logout-confirm` testID는 보인다. 위험 영역 행은 `role=cell label="계정 삭제"`.
- [실화면] 2026-10-31 도달 불가 — `logout-confirm`·`delete-confirm`(실행 금지), `delete-request-error`(확정을 안 누르므로), `deletion-pending`·`deletion-cancel`(DELETION_PENDING 계정 없음).
