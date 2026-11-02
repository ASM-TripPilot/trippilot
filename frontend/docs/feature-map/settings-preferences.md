---
id: settings-preferences
band: l
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/settings/preferences.tsx
  - app/settings/personalization.tsx
---

# 여행 취향 · 개인화

두 하위 화면. **여행 취향**은 온보딩에서 고른 취향 6축(여행 스타일·선호 활동·이동 방식·음식 취향·동행 유형·일정 밀도)을 칩으로 한 화면에서 다시 고르고 [저장]하면 설정으로 돌아가 토스트를 띄운다. **개인화**는 "지난 기록으로 추천 맞춤" 동의 토글 하나와, 서버가 말한 사유(동의 없음·기록 부족·반영 중)에 따른 안내 문구 또는 "지금 반영 중인 기록" 목록을 보인다. 개인화 토글은 법적 동의 기록을 남기는 쓰기라 QA에서 함부로 누르지 않는다.

## Sub-features

- `pref-load` 취향 화면은 서버 취향을 받으면 6축 칩을 현재 선택 상태로 그린다. 받기 전엔 헤더만 있고 본문이 비어 있다.
- `pref-toggle-multi` 다중 축(스타일·활동·이동·음식·동행) 칩은 각각 켜고 끈다. 전부 끄면 "미설정"으로 돌아간다.
- `pref-toggle-single` 일정 밀도는 하나만 고른다(`느긋하게`·`균형 있게`·`알차게`), 같은 칩을 다시 누르면 해제.
- `pref-pet` 동행 줄 끝 "반려동물" 칩은 별도 플래그다.
- `pref-save` [저장] 성공 → 설정으로 돌아가고 토스트 "취향을 저장했어요", 설정 취향 행 `N/6 설정됨`이 갱신된다.
- `pref-save-error` 저장 실패 → 상단 "저장하지 못했어요. 잠시 후 다시 시도해 주세요." 화면에 그대로 남는다.
- `pref-discard` 저장 없이 뒤로 → 변경이 버려진다(확인 없음).
- `pers-consent-missing` 미동의: 토글 꺼짐, 부제 "개인화 추천 사용 안 함", 안내 "동의하면 지난 기록을 반영해요".
- `pers-not-enough` 동의했지만 기록 부족: 토글 켜짐, 부제 "개인화 추천 사용 중", 안내 "기록이 더 쌓이면 반영돼요".
- `pers-applied` 반영 중: 토글 켜짐, 안내 문구 없음, "지금 반영 중인 기록" 목록(서버 항목·목적).
- `pers-toggle` 토글 → 동의/철회 요청 후 다시 조회해 화면이 바뀐다(확인 다이얼로그 없음).

## How to get to it (user POV)

- 설정 → testID `settings-nav-preferences`("여행 취향") → 취향 화면.
- 설정 → testID `settings-nav-personalization`("개인화") → 개인화 화면.
- 딥링크 `trippilot:///settings/preferences`, `trippilot:///settings/personalization`.
- 다른 화면에서 이 두 화면으로 오는 버튼은 없다(설정만).

## Driving it with agent-device

Preconditions:

- 로그인된 계정. 취향 저장은 **서버 취향을 바꾸므로** 시작 전 설정 행 `N/6`과 각 축 선택을 적어 두고 끝에 되돌린다.
- 개인화의 세 얼굴은 계정 상태로 갈린다: 미동의 계정 / 동의했지만 누적 방문 10곳 미만 계정 / 동의 + 정식 분석 계정. 한 계정으로 셋을 다 볼 수 없다.
- 개인화 토글은 동의·철회 기록(법적 로그)을 남긴다 — **켜진 토글을 누르는 것은 동의 철회 확정이다. QA 실행 금지.** 꺼진 토글을 켜는 것도 사용자에게 먼저 알린다.

- **취향 진입.** 설정 → testID: `settings-nav-preferences`. testID: `settings-pref-root`, 헤더 "여행 취향", 안내 testID: `settings-pref-priority-note` "직접 설정한 취향이 분석 결과보다 우선 적용돼요", 축 제목 "여행 스타일"·"선호 활동"·"이동 방식"·"음식 취향"·"동행 유형"·"일정 밀도·이동 선호".
- **칩 고르기.** 칩 testID는 `settings-pref-<축>-<값>` 이다 — 예: testID: `settings-pref-style-미식`, `settings-pref-activity-야경`, `settings-pref-transport-도보`, `settings-pref-food-한식`, `settings-pref-companion-친구`, `settings-pref-pace-느긋하게`, 반려동물은 testID: `settings-pref-pet`. 누를 때마다 선택 표시가 토글된다. 같은 이름 `자연`·`쇼핑`은 스타일(`settings-pref-style-자연`)과 활동(`settings-pref-activity-자연`)에 각각 있다.
- **저장.** testID: `settings-pref-save`("저장") → 설정으로 돌아오고 토스트 testID: `settings-pref-saved` "취향을 저장했어요". 설정 testID: `settings-nav-preferences` 의 `N/6 설정됨`이 바뀐 축 수와 맞는지 읽고, 다시 들어가 선택이 유지되는지 본다. 끝나면 원래대로 되돌려 저장한다.
- **저장 실패.** (서버가 400 등을 줄 때) testID: `settings-pref-error` "저장하지 못했어요. 잠시 후 다시 시도해 주세요."가 화면 상단에 뜨고 화면을 떠나지 않는다. 의도적으로 만들 수단은 없다 — 관찰되면 기록.
- **버리기.** 칩을 바꾸고 testID: `settings-pref-back`(접근성 라벨 "뒤로") → 설정으로 돌아온다. 다시 들어가면 원래 선택이다.
- **개인화 진입.** 설정 → testID: `settings-nav-personalization`. testID: `settings-personalization-root`, 헤더 "개인화", 토글 카드 "지난 기록으로 추천 맞춤"과 토글 testID: `settings-personalization-toggle`.
- **개인화 얼굴 판정(누르지 않고 읽기만).** 토글 꺼짐 + "개인화 추천 사용 안 함" + "동의하면 지난 기록을 반영해요" = 미동의. 토글 켜짐 + "개인화 추천 사용 중" + "기록이 더 쌓이면 반영돼요" = 기록 부족. 토글 켜짐 + 안내 없음 + "지금 반영 중인 기록" 제목과 testID: `settings-personalization-item` 1개 이상 = 반영 중. 설정 개인화 행의 `사용 중`(동의 시)과 대조한다.
- **개인화 토글(사용자 승인 시에만).** 꺼진 토글을 켜면 잠시 뒤 다시 조회해 켜짐 얼굴로 바뀐다. 켜진 토글은 누르지 않는다(철회 확정).
- **뒤로.** testID: `settings-personalization-back` → 설정.

## Gotchas

- 취향 칩 testID는 `settings-pref-${axis.seg}-${value}` 꼴이고 값이 한국어다. 일정 밀도 표시 라벨은 `균형 있게`(띄어쓰기)지만 testID는 서버 값 그대로 `settings-pref-pace-균형있게`다.
- 취향 조회가 늦거나 실패하면 헤더만 있고 본문·[저장]이 아예 없다 — 로딩·오류 표면도 재시도도 없다(결함 후보). 빈 화면을 "칩 없음"으로 판정하지 말고 조회 상태를 의심한다.
- [저장]은 변경 전에도 활성이고 저장 중 잠금이 없다 — 연타 시 PUT이 두 번 나갈 수 있는지는 실화면 전용으로 본다. [실화면 전용]
- 저장 diff 기준선은 화면에 들어온 순간의 서버 값이다 — 안 만진 축은 요청에 안 실린다. 다른 기기에서 같은 계정 취향을 바꾸는 시험은 이 계약을 흔든다.
- 저장 없이 뒤로 가면 경고 없이 버려진다 — 지난 QA(20261021 N-098) 지적이 남은 현 상태다.
- 개인화는 조회 전·실패면 "미동의"(토글 꺼짐·"동의하면…")로 보인다 — 이미 동의한 계정에서 이 얼굴이 잠깐 보이는 것은 로딩일 수 있다. 이 상태에서 토글을 누르면 **동의 요청이 나간다**(결함 후보 — 조회 상태를 안 본다).
- 개인화 토글은 실패해도 화면에 아무 안내가 없고(조용한 실패), 누르는 동안 잠금이 없어 연타하면 동의/철회 요청이 두 번 나갈 수 있다(결함 후보). 그래서 QA에서 누르지 않는다.
- 개인화에는 위치 동의(l06)와 달리 철회 확인 다이얼로그가 **없다** — 켜진 토글 한 번이 곧 철회다.
- 개인화 화면에 Figma 프레임이 없다(l06 준용 발명값) — 생김새는 대조 기준이 없다.
- [실화면] 2026-10-31 개인화 "조회 전 미동의 얼굴"(위 결함 후보)은 판정 불가 — 검증 계정이 **실제로 미동의**라 로딩 얼굴과 진짜 얼굴이 같다. 콜드 딥링크로 열어 스플래시 직후 첫 관찰부터 토글이 꺼짐·`enabled`·"동의하면 지난 기록을 반영해요"였다(누르지 않음). 동의 계정에서 다시 볼 것. 증거 `settings-preferences/07-pers-cold-deeplink.png`.
- [실화면] 2026-10-31 도달 불가 — `pref-pet`(되돌릴 범위를 줄이려 안 누름), `pref-save-error`(만들 수단 없음), `pers-not-enough`·`pers-applied`(미동의 계정), `pers-toggle`(실행 금지).
- [실화면] 2026-10-31 [결함 의심 FM-L6-01] 콜드 딥링크로 이 화면을 바로 열면(`simctl terminate` → `simctl openurl com.trippilot.travel://…`) 헤더 뒤로가 무반응이고 엣지 스와이프도 안 먹어 화면에 갇힌다 — 개발 콘솔에 `The action 'GO_BACK' was not handled by any navigator`. 뒤로가 `router.back()` 뿐이라 쌓인 화면이 없으면 갈 곳이 없다. 실측: `settings`·`settings/personalization`·`settings/notifications`·`notifications`. 앱이 떠 있을 때(웜) 딥링크는 정상. 증거 `settings/07-cold-deeplink-back.png`, `settings-preferences/08-pers-cold-back.png`.
