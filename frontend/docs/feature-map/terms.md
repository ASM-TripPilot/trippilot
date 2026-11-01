---
id: terms
band: c
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/terms/[termsType].tsx
---

# 약관 열람

약관 열람은 서버가 준 약관 전문을 읽기 전용으로 보여 주는 화면이다. 헤더 제목은 문서 이름(서비스 이용약관·개인정보 처리방침·위치정보 이용약관), 본문은 서버 마크다운을 기호 없이 제목·목록·표 카드로 풀어 그린다. 설정의 "앱 정보", 온보딩 약관 동의(c06)의 "보기", 재동의 화면의 "보기" 세 곳에서 열리고, 뒤로가기는 연 자리로 돌아간다. 조회 실패는 오류 문구와 [다시 시도]로 보인다.

## Sub-features

- `terms-loading` 조회 중: 가운데 로딩 표시.
- `terms-ready` 본문: 제목·조항 제목·문단·목록·표(행마다 "머리: 값" 카드)·구분선.
- `terms-error` 실패(네트워크·없는 약관 404): "약관을 불러오지 못했어요. 다시 시도해 주세요." + [다시 시도] → 같은 조회를 다시 보낸다.
- `terms-title` 알려진 3종은 문서 이름, 그 밖의 타입은 서버 코드가 그대로 제목이 된다.
- `terms-back` 뒤로 → 연 화면(설정·온보딩·재동의)으로 복귀.

## How to get to it (user POV)

- 설정 → 앱 정보 그룹 testID `settings-nav-terms-TERMS_OF_SERVICE`("서비스 이용약관")·`settings-nav-terms-PRIVACY_POLICY`("개인정보 처리방침")·`settings-nav-terms-LOCATION_TERMS`("위치정보 이용약관").
- 온보딩 약관 동의 화면 각 행의 "보기" — testID `onboarding-terms-view-<termsType>`(신규 가입 흐름에서만).
- 재동의 화면 각 행의 "보기" — testID `reconsent-view-<termsType>`(재동의가 필요한 계정에서만).
- 딥링크 `trippilot:///terms/TERMS_OF_SERVICE` 등 `terms/<termsType>`.

## Driving it with agent-device

Preconditions:

- 설정 경로는 로그인된 계정. 온보딩·재동의 경로는 각각 신규 가입·재동의 대상 계정이 필요하다 — 시뮬에서 재로그인이 막히면 그 두 경로는 미확인으로 남긴다.
- 약관 조회는 무인증 공개 API다 — 서버(`dev-api`)에 약관이 시드돼 있어야 본문이 뜬다.

- **설정에서 열기.** 설정 맨 아래쪽 "앱 정보" → testID: `settings-nav-terms-PRIVACY_POLICY`. 헤더 "개인정보 처리방침", testID: `terms-viewer-back`, 잠시 뒤 testID: `terms-viewer-body` 에 본문.
- **3종 대조.** 같은 방식으로 `settings-nav-terms-TERMS_OF_SERVICE` → 헤더 "서비스 이용약관", `settings-nav-terms-LOCATION_TERMS` → 헤더 "위치정보 이용약관". 본문이 문서마다 다른지(섞이지 않는지) 본다.
- **마크다운 풀림.** 본문에 `#`·`**`·`|`·`---` 기호가 글자로 남지 않고, 표는 "머리: 값" 줄로 보인다.
- **뒤로.** testID: `terms-viewer-back` → 연 화면(설정)으로 돌아온다.
- **온보딩에서 열기.** (신규 가입 흐름) 약관 동의 화면 testID: `onboarding-terms-view-PRIVACY_POLICY`(접근성 라벨 "<라벨> 보기") → 같은 열람 화면, 뒤로 → 약관 동의 화면 체크 상태 유지.
- **재동의에서 열기.** (재동의 대상 계정) testID: `reconsent-view-<termsType>` → 같은 열람 화면, 뒤로 → 재동의 화면.
- **실패.** 네트워크를 끊거나 없는 타입 딥링크(`trippilot:///terms/NOPE`)로 열면 testID: `terms-viewer-error` "약관을 불러오지 못했어요. 다시 시도해 주세요."와 testID: `terms-viewer-retry`("다시 시도"). 없는 타입이면 헤더 제목이 `NOPE` 그대로다.

## Gotchas

- 이 라우트는 어느 `Stack.Protected` 가드에도 없다 — 미인증 딥링크로도 열리고 약관 API도 공개라 본문까지 보인다(의도된 설계).
- 설정 행 라벨과 열람 화면 제목은 같은 문구지만 **다른 파일에 따로** 적혀 있다 — 온보딩 체크박스 라벨("개인정보 수집·이용" 등)은 또 다르다. 이름 불일치는 지난 QA(Q-005) 지적 사항이다.
- 화면에 Figma 프레임이 없다 — 생김새 대조 기준이 없다(frontmatter `band: c`는 진입 흐름 기준).
- 한글 줄바꿈은 `lineBreakStrategyIOS="hangul-word"`로 어절 단위다 — 어절 중간 줄바꿈이 보이면 결함이다. [실화면 전용]
- 약관 본문 내용(Apple 로그인 누락·위탁 표 등)의 옳고 그름은 서버 문서·법무 사안이다(지난 QA N-087·N-100·N-101) — 이 지도의 통과 조건이 아니다.
- 딥링크로 연 화면은 스택에 쌓인다(trippilot-sim-qa §2) — 뒤로로 하나씩 닫는다. 앱이 떠 있을 때 `com.trippilot.travel://terms/LOCATION_TERMS` 로 열면 뒤로가 열기 직전 화면(설정)으로 돌아왔다(2026-10-31 실측).
- [실화면] 2026-10-31 오류 얼굴의 문구·`다시 시도`는 트리에 보이지만 `terms-viewer-error`·`terms-viewer-retry` testID는 잡히지 않는다(버튼은 라벨 `다시 시도`) — `role=button label="다시 시도"` 로 누른다. `NOPE` 은 재시도해도 같은 오류(정상).
- [실화면] 2026-10-31 도달 불가 — `terms-loading`(조회가 빨라 못 잡음), 온보딩·재동의 경로(신규·재동의 계정 없음). 개인정보 처리방침 본문 286줄을 훑어 `#`·`**`·`|`·`---` 기호가 남지 않았고 표는 "수집 시점: …" 줄로 풀렸다.
- [실화면] 2026-11-02 실패 주입 — 없음 — `/terms/*` 지연을 걸어도 본문이 바로 떴다(다른 경로·캐시 추정, 확인 필요).
