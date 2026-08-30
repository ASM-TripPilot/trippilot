---
paths:
  - "src/features/notification/**"
---
# `src/features/notification/` — l02 알림 설정 표면 (TRIP-607 신설)

**이 파일은 TRIP-607([기록])에서 신설됐다** — `features/notification`은 이번 사이클 이전엔 존재하지 않았다(0번 칸에서 orval 생성 API 태그만 만들었고 feature 코드는 없었음).

**경계**: 이 폴더는 **다른 `features/*`를 import할 수 없다** — `eslint.config.js`의 `FEATURES` 배열에 `notification`이 없어 기계 강제가 아니다. 게다가 `settings`(TRIP-605)와 달리 **소스 재귀 스캔 가드도 아직 없다** — `settingsBoundary.test.ts` 같은 그물이 이 폴더엔 없어 features 경계 위반이 지금은 완전 무심판이다(repo-traps 참고, 후속 티켓 후보).

| 파일 | 역할 |
|---|---|
| `model/channelAvailability.ts` | **신규.** `resolvePushColumn(permission: PushPermission, toggles) → {available, cellsOn}` 순수 함수 — "OS 권한 × 사용자 설정 → UI 가용성" 판정. `available = permission==='GRANTED'`, `cellsOn[i] = available && toggles[i].pushEnabled`(inAppEnabled은 판정에 안 읽힘). **PBT-U6-F2(CI 차단 게이트)** 대상 — `channelAvailability.test.ts`가 fast-check로 OS권한×토글 조합을 훑는다. ⚠️ **`cellsOn`은 현재 프로덕션 소비자 0**이다(화면이 `checked`를 `pushColumnAvailable && value.pushEnabled`로 자체 파생) — PBT가 무는 값과 실제 렌더 checked가 분리돼 있다는 뜻이라, 이 함수를 다시 만질 때 "PBT green = 화면도 옳다"로 오인하지 말 것(5-b 경고-1 실측, 아래 `ui/ToggleRow.tsx` 행 참고). |
| `model/channelAvailability.test.ts` | PBT-U6-F2 전용(node 버킷). `permissionArb`가 선언됐으나 **미사용**(lint warning, 04 QA 관찰-2 — 실제 프로퍼티는 리터럴/인라인 `fc.constantFrom`을 직접 씀, 커버리지엔 무영향이나 정리 대상). |
| `model/useToggles.ts` | **신규.** `useToggles() → {items, isLoading, isError, toggle}`. `toggle(kind, channel, next)`가 GET 정본 쿼리키(`getGetMeNotificationSettingsQueryKey()`)에 그 kind×채널만 낙관 반영 → PATCH 바디는 **바뀐 필드 하나만**(`{pushEnabled}` 또는 `{inAppEnabled}`, 다른 키는 아예 안 실음 — openapi `null`/생략=변경없음 계약, 동봉하면 다른 쪽을 덮는다) → 성공 시 GET 무효화(재조회), 실패 시 그 kind×채널만 이전 값 복원 + `{kind:'failed'}` 반환(INV-4, 삼키지 않음) — **실패 경로는 무효화 안 함**(재요청이 롤백을 덮어 관측 불가, `useVisitCheck` 규율 계승). |
| `model/useToggles.integration.test.tsx` | msw 통합 버킷(U1~U3). ⚠️ **needle 결함 실사(수정 완료)** — `useVisitCheck.integration.test.tsx`를 복사-각색하며 hitCount needle 2곳(line 196·249)에서 `GET ` 메서드 접두가 누락돼 어떤 구현으로도 통과 불가했다(02b가 수정, 하네스 규칙 후보 — 개발로그 참고). |
| `ui/NotificationSettingsScreen.tsx` | **신규.** 순수 프레젠테이션, 화면이 6종(`VISIBLE_ROWS`, STAY·TRIP_PRE·TRIP_DAY·SLOT_PRE·PLAN_B·REFLECTION) 목록을 자체 소유 — 컨테이너가 COMMUNITY·SYSTEM을 섞어 넘겨도 이 목록만 순회해 렌더 트리에 안 나온다(`notificationKindGuard.test.tsx`가 잠금). |
| `ui/ToggleRow.tsx` | **신규.** 라벨 + 푸시·인앱 스위치 2개(Pressable + `accessibilityRole="switch"` + real `disabled`, `LocationConsentScreen` 패턴 인라인 복제 — features 간 import 금지라 직접 재사용 불가, 소비자 1이라 shared 승격 안 함). 푸시 `checked = pushColumnAvailable && value.pushEnabled`(:83) — **이 줄이 DENIED에서 "켜졌다는 거짓말"을 막는 유일한 실렌더 방어선**이다(5-b 경고-1 뮤테이션 실측: `checked={value.pushEnabled}`로 바꿔도 PBT-U6-F2·구조가드 전부 green 유지, `NotificationSettingsScreen.test.tsx`의 5-c 추가 케이스만 문다 — 개념 [[disabled prop과 accessibilityState]] TRIP-607 절 참고). 인앱은 `disabled={false}` 항상(DENIED에서도 조작 가능, BR-U6-16). |
| `ui/PermissionBanner.tsx` | **신규.** denied 대시 배너("기기 설정에서 알림 권한을 허용하세요" + [설정 이동] pill, `Linking.openSettings()`). |
| `ui/NotificationGlyphs.tsx` | **신규.** `NotifBackChevronGlyph`·`NotifInfoGlyph`·`NotifWarningGlyph` — features 간 import 금지라 `shared/location/LocationGlyphs`의 동형 벡터를 재사용 못 하고 feature-로컬로 새로 그림(리포 관례, `StayGlyphs.tsx` 등과 동형). |

## 관련

- 페이지 배선: `frontend/.claude/rules/layer-pages.md`(`settings-notifications` 행).
- OS 권한 조회: `frontend/.claude/rules/layer-shared.md`(`src/shared/push/` 행).
- 개념: [[순수 함수 + PBT (fast-check)]] · [[낙관적 갱신과 롤백 (optimistic update)]] · [[disabled prop과 accessibilityState]].
- 개발로그: [[2026-08-30 20260830-trip607-notif-settings]].
