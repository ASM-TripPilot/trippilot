---
id: settings
band: l
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/settings/index.tsx
---

# 설정

설정(l05)은 그룹 카드 목록이다 — 계정(닉네임·데이터 내보내기·로그아웃), 여행 취향, 위치정보(GPS 이동경로 기록·개인화), 알림, 제휴 안내, 앱 정보(약관 3종), 위험 영역(계정 삭제). 이 파일은 설정 메인과 행 안에서 끝나는 기능(닉네임 인라인 편집·내보내기·제휴 안내 토글·버전·데이터 출처)과 하위 화면 진입을 다룬다. 로그아웃·계정 삭제는 `settings-account.md`, 하위 화면은 각자 파일이다.

## Sub-features

- `settings-groups` 그룹이 정본 순서로 그려진다: 계정 → (머리글 없는) 여행 취향 → 위치정보 → 알림 → 제휴 안내 → 앱 정보 → 위험 영역.
- `settings-summary` 행 요약값: 닉네임, 취향 `N/6 설정됨`, 위치 동의 칩(`동의`/`미동의`), 개인화 `사용 중`. 조회 전·실패면 값·칩을 그리지 않는다.
- `settings-nickname-open` 닉네임 행을 누르면 같은 행 안에 입력칸 + [저장]이 펼쳐진다(다시 누르면 접힘).
- `settings-nickname-save` 2~20자 새 닉네임 저장 → 행 값이 바뀌고 토스트 "닉네임을 바꿨어요".
- `settings-nickname-same` 지금과 같은 닉네임이면 요청 없이 행이 접힌다.
- `settings-nickname-length` 1자 이하 "닉네임은 2자 이상이어야 해요", 21자 이상 "닉네임은 20자 이하여야 해요"(앞뒤 공백은 걷고 잰다).
- `settings-nickname-server` 409 "이미 사용 중인 닉네임이에요", 503 "지금은 확인할 수 없어요. 잠시 후 다시 시도해 주세요", 그 밖 "변경에 실패했어요. 잠시 후 다시 시도해 주세요".
- `settings-export` 데이터 내보내기 → `.json` 파일을 OS 공유 시트로 넘긴다.
- `settings-export-truncated` 서버가 일부를 잘랐으면 "일부 항목이 잘렸어요: …".
- `settings-export-error` 조회 실패 / 공유 모듈 없는 빌드 / 파일 쓰기·공유 실패 각각의 안내 문구.
- `settings-affiliate` "외부 이동 시 제휴 안내 다시 보기" 토글(낙관 반영, 실패 시 되돌리고 안내). 값을 모르면 토글 비활성.
- `settings-nav` 하위 화면 진입: 여행 취향·GPS 이동경로 기록·개인화·알림 설정·약관 3종.
- `settings-footer` 하단 `TripPilot v<버전>`(버전을 알 때만)과 데이터 출처 블록, `© OpenStreetMap contributors` 링크는 외부 브라우저.
- `settings-web-no-push` 푸시가 없는 플랫폼(웹)에서는 "알림" 그룹이 통째로 빠진다.

## How to get to it (user POV)

- 마이 탭 헤더 톱니(`my-header-settings`) 또는 마이 메뉴 `설정` 행(`my-settings-row`) — `my-tab.md`.
- 딥링크 `trippilot:///settings`(시뮬에선 `com.trippilot.travel://settings`). 앱이 떠 있을 때만 뒤로가 동작한다 — 콜드 딥링크는 아래 FM-L6-01.
- 하위 화면(취향·위치·개인화·알림·약관)에서 뒤로 오면 이 화면으로 돌아온다.

## Driving it with agent-device

Preconditions:

- 로그인된 계정. 닉네임 저장 검증은 **데이터를 바꾸므로** 시작 전 원래 닉네임을 적어 두고 끝에 되돌린다.
- 409 검증에는 다른 계정이 이미 쓰는 닉네임 하나가 필요하다. 503은 서버 모더레이션 장애 상태라 의도적으로 만들 수 없다.
- 잘림 고지는 서버가 `truncatedSections`를 비우지 않은 계정에서만 보인다(데이터가 상한을 넘어야 함).
- 제휴 안내 토글은 되돌릴 수 있는 PATCH다 — 바꿨으면 원래 값으로 돌린다.

- **진입.** 마이 탭 → testID: `my-header-settings`. 헤더 "설정"과 testID: `settings-back` 가 보이고 testID: `settings-group` 이 여러 개. 그룹 라벨 "계정"·"위치정보"·"알림"·"제휴 안내"·"앱 정보"·"위험 영역"이 순서대로.
- **요약값.** testID: `settings-nav-preferences` 에 "여행 취향"과 `N/6 설정됨`, testID: `settings-nav-location-consent` 에 "GPS 이동경로 기록"과 칩 testID: `settings-chip-location-consent`(`동의`/`미동의`), testID: `settings-nav-personalization` 에 "개인화"(동의면 `사용 중`). 각 값은 해당 하위 화면 상태와 대조한다.
- **닉네임 펼치기.** testID: `settings-nickname-edit` 를 누른다 → testID: `settings-nickname-input`(지금 닉네임이 미리 채워져 있다 — placeholder "새 닉네임"은 비웠을 때만 보인다)와 testID: `settings-nickname-save`("저장")가 나타난다.
- **닉네임 길이 오류.** 입력칸에 한 글자를 `fill` 하고 저장 → testID: `settings-nickname-error` "닉네임은 2자 이상이어야 해요". 21자 → "닉네임은 20자 이하여야 해요". 입력을 바꾸면 오류가 사라진다.
- **닉네임 같은 값.** 지금 닉네임 그대로 저장 → 입력칸이 접히고 토스트가 안 뜬다(요청 없음).
- **닉네임 저장.** 새 2~20자 값으로 저장 → 키보드가 내려가고 토스트 testID: `settings-nickname-saved` "닉네임을 바꿨어요", 행 값이 새 닉네임. 마이 탭 프로필 카드에서 한 번 더 읽는다. 끝나면 원래 닉네임으로 되돌린다.
- **닉네임 중복.** 다른 계정의 닉네임으로 저장 → testID: `settings-nickname-error` "이미 사용 중인 닉네임이에요", 행 값은 그대로.
- **내보내기.** testID: `settings-export-row`("데이터 내보내기")를 누른다 → OS 공유 시트가 뜬다. 시트를 취소로 닫는다. 잘린 계정이면 testID: `settings-export-truncated` "일부 항목이 잘렸어요: …". 실패면 testID: `settings-export-error` 에 "내보내기 정보를 불러오지 못했어요. 다시 시도해 주세요." / "이 앱 버전에서는 파일로 내보낼 수 없어요. 앱을 업데이트해 주세요." / "내보내기 파일을 만들지 못했어요. 다시 시도해 주세요." 중 하나.
- **제휴 안내 토글.** testID: `settings-affiliate-toggle`(접근성 라벨 "외부 이동 시 제휴 안내 다시 보기")를 누른다 → 즉시 반대 상태. 숙소 상세의 외부 이동 고지 시트가 다시 뜨는지/안 뜨는지로 한 번 더 읽는다(숙소 레인). 실패면 토글이 되돌아가고 testID: `settings-affiliate-error` "설정을 바꾸지 못했어요. 다시 시도해 주세요.". 원래 값으로 되돌린다.
- **하위 화면 진입.** testID: `settings-nav-preferences` → `settings-preferences.md`, `settings-nav-location-consent` → `settings-location.md`, `settings-nav-personalization` → `settings-preferences.md`, `settings-nav-notifications`("알림 설정") → `settings-notifications.md`, `settings-nav-terms-TERMS_OF_SERVICE`·`settings-nav-terms-PRIVACY_POLICY`·`settings-nav-terms-LOCATION_TERMS` → `terms.md`. 각각 진입 후 그 화면의 뒤로 버튼으로 돌아온다.
- **하단.** 맨 아래로 스크롤 → `TripPilot v<버전>`, testID: `settings-data-attribution`("데이터 출처"·"한국관광공사 TourAPI · Overture Maps Foundation"), testID: `settings-osm-copyright` 를 누르면 사파리로 `https://www.openstreetmap.org/copyright`. 앱으로 돌아와 설정이 그대로인지 본다.
- **뒤로.** testID: `settings-back` → 마이 탭.

## Gotchas

- 행 testID는 `settings-nav-${rowKey}` 꼴이다(예 `settings-nav-preferences`). 칩도 `settings-chip-${rowKey}`.
- `settings-row` testID는 닉네임·내보내기·계정 삭제 행과 "준비 중" 행이 **공유**한다 — 이것으로 특정 행을 고르지 않는다. 지금은 모든 행이 `ready:true`라 "준비 중" 행은 안 보인다.
- 키보드가 떠 있으면 첫 탭이 키보드만 닫을 수 있다 — 이 화면은 `keyboardShouldPersistTaps="handled"`라 [저장] 첫 탭이 먹어야 정상이다. 안 먹으면 결함 후보. [실화면 전용]
- 저장 중 [저장]은 비활성·입력 잠금이고 같은 렌더 안 연타는 ref로 막는다 — 연타 결과(요청 1회)는 실화면 전용으로 본다. [실화면 전용]
- 금칙어 닉네임이 저장되는 것은 서버 판정 문제로 지난 QA(20261021 N-084)에 남아 있다 — 욕설로 시험했다면 반드시 원복한다.
- 공유 시트·사파리 이동은 앱 밖 표면이다 — 열렸는지·돌아왔을 때 상태는 실화면 전용. [실화면 전용]
- 내보내기 파일에 무엇이 담기는지(담은 장소·회고 누락 여부)는 서버 계약이다 — 지난 QA(N-085)는 시뮬 캐시에서 파일을 직접 열어 확인했다.
- 취향 `N/6`, 위치 칩, 개인화 `사용 중`은 조회 실패 시 **그냥 비어** 보인다(오류 표면 없음) — 비었다고 "미설정"으로 판정하지 않는다.
- 설정 행 위치 칩은 서버 `gpsRecordingOptIn` 을, 위치정보 동의 화면 토글은 `legalConsent` 를 읽는다 — 두 값이 갈리는 계정이면 칩과 토글이 다르게 보일 수 있다(확인 필요: 두 필드가 항상 함께 바뀌는지는 서버 계약).
- `/settings` 는 `SplashGate`의 어떤 `Stack.Protected` 가드에도 없다 — 미인증 딥링크로도 화면 틀은 열린다(데이터는 401).
- [실화면] 2026-10-31 **데이터 내보내기 공유 시트를 바깥(위쪽) 탭으로 닫지 마라** — 시트 위쪽 빈 곳(201,300)을 한 번 눌렀더니 시트가 닫히면서 그 아래 `로그아웃` 행까지 눌려 로그아웃 확인 다이얼로그가 열렸다(취소로 닫음). 공유 시트는 시트 안 닫기·아래로 끌기로 닫는다. 증거 `settings-account/01-logout-dialog.png`.
- [실화면] 2026-10-31 행은 접근성 트리에 testID가 아니라 라벨(`닉네임, 큐에이여행자`·`여행 취향, 6/6 설정됨`·`GPS 이동경로 기록, 동의`·`데이터 내보내기`·`계정 삭제`)로 잡힌다 — `role=cell label="…"` 로 누른다. 칩·하위 testID(`settings-chip-location-consent`·`settings-nav-*-chevron`)는 보인다. 이 계정의 개인화 행에는 `사용 중`이 없다(미동의 계정 — `settings-preferences.md`).
- [실화면] 2026-10-31 도달 불가 — `settings-nickname-save`(규칙상 닉네임을 바꾸지 않음), `settings-nickname-server`(다른 계정 닉네임·모더레이션 장애 없음), `settings-export-truncated`·`settings-export-error`(정상 86KB 파일만 나옴), `settings-affiliate`(값 확인만 — 켜짐 `1`, 바꾸지 않음), `settings-web-no-push`(iOS).
- [실화면] 2026-10-31 [결함 의심 FM-L6-01] 콜드 딥링크로 이 화면을 바로 열면(`simctl terminate` → `simctl openurl com.trippilot.travel://…`) 헤더 뒤로가 무반응이고 엣지 스와이프도 안 먹어 화면에 갇힌다 — 개발 콘솔에 `The action 'GO_BACK' was not handled by any navigator`. 뒤로가 `router.back()` 뿐이라 쌓인 화면이 없으면 갈 곳이 없다. 실측: `settings`·`settings/personalization`·`settings/notifications`·`notifications`. 앱이 떠 있을 때(웜) 딥링크는 정상. 증거 `settings/07-cold-deeplink-back.png`, `settings-preferences/08-pers-cold-back.png`.
