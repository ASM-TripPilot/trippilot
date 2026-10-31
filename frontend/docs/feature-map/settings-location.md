---
id: settings-location
band: l
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/settings/location.tsx
---

# 위치정보 동의

위치정보 동의(l06)는 "위치정보 수집" 동의 토글 하나와 그 용도("이렇게 사용해요" 3행), 꺼도 계속 도는 기능("동의를 꺼도 계속 동작해요") 안내를 보인다. 동의를 끄려면 무엇이 멈추고 무엇이 계속되는지 적힌 확인 다이얼로그를 한 번 거쳐야 한다. 기기 위치 권한이 거부돼 있으면 토글이 잠기고 "기기 설정에서 위치 권한을 허용하세요" 배너가 뜬다. 자동 기록 기능 플래그가 켜진 빌드에서는 "자동 기록" 상태 행과 4번째 용도가 더 붙는다. **동의 상태 변경은 법적 append-only 로그에 남는다 — QA는 철회 다이얼로그를 열고 취소하는 데까지만 한다.**

## Sub-features

- `loc-loading` 동의 상태 조회 중: 토글 대신 "동의 상태를 불러오는 중이에요".
- `loc-error` 조회 실패: "동의 상태를 불러오지 못했어요" + [다시 시도].
- `loc-on` 동의함: 토글 켜짐, 부제 "동의함 · 정확한 위치 사용".
- `loc-off` 동의 안 함: 토글 꺼짐, 부제 "동의 안 함 · 위치 미사용".
- `loc-denied` 기기 권한 거부(서버 미러 거부 + 기기도 미허용): 점선 배너 + [설정 이동], 토글 잠김, 부제 "OS 권한 거부로 사용 불가", 용도 카드 글자가 흐린 톤.
- `loc-revoke-dialog` 켜진 토글을 누르면 확인 다이얼로그 "위치정보 동의를 철회할까요?"(멈추는 것 / 계속 동작하는 것) [취소]/[동의 철회].
- `loc-revoke-cancel` [취소] → 다이얼로그만 닫힌다(요청 없음).
- `loc-revoke-confirm` [동의 철회] → 철회 저장 + 자동 기록 정지·경로 삭제. **QA 실행 금지.**
- `loc-grant` 꺼진 토글을 누르면 다이얼로그 없이 바로 동의 저장. **법적 로그 — 사용자 승인 시에만.**
- `loc-save-error` 저장 실패: 토글 아래 "저장하지 못했어요. 잠시 후 다시 시도해 주세요."
- `loc-automation` (플래그 ON 빌드) "자동 기록" 행: 상태 `켜짐`/`꺼짐` + 사유 문구 + 필요 시 [켜기] 또는 [설정 열기].
- `loc-automation-explainer` [켜기] → "앱을 닫아도 방문을\n자동으로 기록할까요?" 설명 화면 → [자동 기록 켜기]는 OS '항상 허용' 요청, [나중에]는 닫기.

## How to get to it (user POV)

- 설정 → 위치정보 그룹 testID `settings-nav-location-consent`("GPS 이동경로 기록").
- 딥링크 `trippilot:///settings/location`.
- 자동 기록 설명 화면 문구가 "설정 › 위치정보 동의에서 언제든 끌 수 있어요."라고 이 화면을 가리킨다(이동 버튼은 없다).

## Driving it with agent-device

Preconditions:

- 로그인된 계정. 위치 동의가 **켜진** 계정이면 철회 다이얼로그를, 꺼진 계정이면 꺼짐 얼굴만 본다(켜기는 사용자 승인 필요).
- 거부 얼굴은 시뮬 위치 권한 거부 상태가 필요하다 — `xcrun simctl privacy booted revoke location com.trippilot.travel` 류는 앱을 죽일 수 있다(trippilot-sim-qa §2 `reset` 함정). 바꿨으면 dev-client로 다시 띄운다.
- 자동 기록 행은 `TRIPPILOT_LOCATION_AUTOMATION=1` 로 만든 빌드에서만 보인다. 2026-10-31 검증 시뮬의 dev build 에는 **있었다** — 보일지는 그 빌드·Metro 의 env 에 달렸다.
- **위치 동의 토글 반복 금지**(trippilot-sim-qa §5) — 켜고 끄는 한 번 한 번이 법적 로그 행이다.

- **진입.** 설정 → testID: `settings-nav-location-consent`. 헤더 "위치정보 동의", testID: `settings-location-back`. 조회 중이면 testID: `settings-location-consent-loading`, 실패면 testID: `settings-location-consent-error` 와 testID: `settings-location-consent-retry`("다시 시도").
- **정상 얼굴.** 토글 카드 "위치정보 수집"과 testID: `settings-location-toggle`(접근성 라벨 "위치정보 수집"), 부제가 동의 상태와 맞는지 본다. 설정 행 칩(`settings-chip-location-consent` 의 `동의`/`미동의`)과 대조한다.
- **용도·계속 동작.** testID: `settings-location-usage-section` 에 "이렇게 사용해요", testID: `settings-location-usage-row` 3개("이동 지연 감지"·"실시간 일정 재계획"·"주변 숙소·일정 추천"). testID: `settings-location-continue-banner` 에 "동의를 꺼도 계속 동작해요"와 "예정 일정 알림"·"날씨·휴무 트리거".
- **철회 다이얼로그 열기.** (동의 켜진 계정) testID: `settings-location-toggle` 을 누른다 → testID: `settings-location-revoke-confirm` 다이얼로그에 "위치정보 동의를 철회할까요?", "이런 기능이 멈춰요"(이동 지연 알림·실시간 Plan-B 재계획·현 위치 기반 추천, 플래그 ON이면 "자동 방문 기록·이동 경로 (저장된 경로 삭제)" 추가)와 "이런 기능은 계속 동작해요"(예정 일정 알림·날씨·휴무 트리거). 토글은 **아직 켜진 채**다.
- **철회 취소.** testID: `settings-location-revoke-cancel`("취소") → 다이얼로그가 닫히고 토글·부제 그대로. testID: `settings-location-revoke-confirm-button`("동의 철회")은 **누르지 않는다**.
- **거부 얼굴.** (기기 권한 거부) testID: `settings-location-denied-banner` "기기 설정에서 위치 권한을 허용하세요"와 testID: `settings-location-open-settings`("설정 이동"), 토글 비활성, 부제 "OS 권한 거부로 사용 불가". [설정 이동] → iOS 설정 앱.
- **자동 기록 행(플래그 ON 빌드).** testID: `settings-location-automation-row` 에 "자동 기록", testID: `settings-location-automation-status` 가 `켜짐`/`꺼짐`, 사유는 "여행 날짜 동안 기록 중이에요" / "위치정보 동의가 꺼져 있어요" / "위치 권한이 꺼져 있어요" / "위치 권한이 '사용하는 동안'이에요" / "정확한 위치가 꺼져 있어요" / "여행 날짜에만 켜져요" 중 하나. testID: `settings-location-usage-row-automation`("자동 방문 기록 · 이동 경로")이 용도 카드에 붙는다.
- **자동 기록 [켜기].** 사유가 "'사용하는 동안'"이고 다시 물을 수 있을 때 testID: `settings-location-automation-enable`("켜기") → testID: `location-explainer-root`(제목 testID: `location-explainer-title`). testID: `location-explainer-later`("나중에")로 닫는다. testID: `location-explainer-enable`("자동 기록 켜기")은 OS '항상 허용' 창을 띄운다 — 권한을 바꾸므로 사용자 승인 시에만. [설정 열기](testID: `settings-location-automation-open-settings`) → iOS 설정 앱.
- **뒤로.** testID: `settings-location-back` → 설정.

## Gotchas

- 이 화면에 **들어올 때마다** 기기 위치 권한을 읽어 서버에 미러 보고(PATCH)를 한 번 보낸다 — 진입 자체가 쓰기다(확인 필요: 이 미러 보고가 위치 법정 로그에 행을 남기는지는 서버 계약).
- 철회 다이얼로그는 조건부 렌더 오버레이다 — 딤 전면 덮임·가운데 정렬·뒤 토글 터치 차단은 실화면으로만 확인된다(repo-traps 오버레이 절). [실화면 전용]
- 동의 켜기(꺼진 토글 누름)는 다이얼로그 없이 즉시 저장된다 — "한 번 눌러 보기"가 곧 법적 동의 기록이다.
- 토글 잠금(`disabled`)은 서버 미러가 거부 **이고** 기기 권한도 미허용일 때만이다 — 서버 미러가 낡은 거부여도 기기가 허용이면 같은 진입에서 풀린다(정상).
- 설정 행 이름("GPS 이동경로 기록")·화면 제목("위치정보 동의")·토글 이름("위치정보 수집")이 서로 다르다 — 셋은 같은 화면이다(지난 QA 20261021 N-088).
- 설정 행 칩은 `gpsRecordingOptIn`, 이 화면 토글은 `legalConsent` 를 본다 — 두 값이 다르면 칩과 토글이 갈려 보인다(확인 필요: 서버가 둘을 항상 같이 바꾸는지).
- 자동 기록 행·용도 4번째 행·철회 다이얼로그의 4번째 멈춤 항목은 플래그 OFF 빌드에서 **없는 것이 정상**이다.
- 자동 기록 상태는 포그라운드 복귀마다 OS 권한을 다시 읽는다 — 설정 앱 왕복 뒤 행이 바뀌는지는 실화면 전용. [실화면 전용]
- 저장 중 같은 PUT 연타는 ref 잠금이 막는다(법정 로그 중복 방지) — 연타 결과는 실화면 전용으로 본다. [실화면 전용]
- [실화면] 2026-10-31 이 시뮬 빌드는 플래그 ON 이었다 — 자동 기록 행 `켜짐`·"여행 날짜 동안 기록 중이에요", 용도 4번째 행, 철회 다이얼로그 4번째 멈춤 항목 "자동 방문 기록·이동 경로 (저장된 경로 삭제)"가 모두 보였다.
- [실화면] 2026-10-31 도달 불가 — `loc-loading`(진입 즉시 정상 얼굴), `loc-error`·`loc-save-error`(실패 유도 수단 없음), `loc-off`·`loc-grant`·`loc-revoke-confirm`(동의 켜진 계정·토글 실행 금지), `loc-denied`(권한 회수는 앱을 죽이고 부작용), `loc-automation-explainer`(상태가 `켜짐`이라 [켜기]가 없다).
