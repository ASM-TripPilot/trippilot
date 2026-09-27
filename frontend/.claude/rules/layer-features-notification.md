---
paths:
  - "src/features/notification/**"
---
# `src/features/notification/` — l02 알림 설정 + l01 알림함 표면

**경계**: 이 폴더는 다른 `features/*`를 import할 수 없다 — eslint 층 zone(전 feature 강제)과 `notificationStructure.test.ts`(`features/notification/**` 재귀 소스 스캔)가 이중으로 막는다. 새 파일은 자동으로 스캔 대상이 된다.

| 파일 | 역할 |
|---|---|
| `model/channelAvailability.ts` | `resolvePushColumn(permission, toggles) → {available, cellsOn}` 순수 함수 — OS 권한 × 사용자 설정 → UI 가용성. **PBT-U6-F2(CI 차단 게이트)** 대상. ⚠️ `cellsOn`은 프로덕션 소비자 0 — 화면은 `checked`를 `ToggleRow`에서 자체 파생하므로 "PBT green = 화면도 옳다"로 읽지 말 것 |
| `model/channelAvailability.test.ts` | PBT-U6-F2 전용(node 버킷). `permissionArb`는 선언만 되고 미사용 |
| `model/useToggles.ts` | `useToggles() → {items, isLoading, isError, toggle}`. GET 쿼리키에 그 kind×채널만 낙관 반영 → PATCH 바디는 **바뀐 필드 하나만**(다른 키를 실으면 openapi `null`/생략=변경없음 계약상 다른 쪽을 덮는다) → 성공 시 GET 무효화, 실패 시 그 칸만 복원 + `{kind:'failed'}`(INV-4). 실패 경로는 무효화하지 않는다(재요청이 롤백을 덮음) |
| `model/useToggles.integration.test.tsx` | msw 통합 버킷. hitCount needle은 `GET ` 메서드 접두까지 포함해야 한다(복사 원본 대비 누락 시 어떤 구현으로도 통과 불가) |
| `ui/NotificationSettingsScreen.tsx` | 순수 프레젠테이션, 화면이 표시 6종(`VISIBLE_ROWS`)을 자체 소유 — COMMUNITY·SYSTEM을 섞어 넘겨도 렌더되지 않는다(`notificationKindGuard.test.tsx`가 잠금) |
| `ui/ToggleRow.tsx` | 라벨 + 푸시·인앱 스위치(`shared/ui/Toggle`). 푸시 `checked = pushColumnAvailable && value.pushEnabled`가 **DENIED에서 "켜졌다는 거짓말"을 막는 유일한 실렌더 방어선**이다 — `checked={value.pushEnabled}`로 바꿔도 PBT·구조가드는 green이고 `NotificationSettingsScreen.test.tsx`만 문다. 인앱은 항상 조작 가능(BR-U6-16). 구분선은 `h-px bg-hairline` 막대(`showDivider`) — `repo-traps.md` 「테두리」 |
| `ui/PermissionBanner.tsx` | denied 대시 배너("기기 설정에서 알림 권한을 허용하세요" + [설정 이동] pill, `Linking.openSettings()`) |
| `ui/NotificationGlyphs.tsx` | `NotifBackChevronGlyph`·`NotifInfoGlyph`·`NotifWarningGlyph` — features 간 import 금지라 feature-로컬로 그림 |
| `model/notificationKind.ts` | `notificationKind(kind) → {icon, label}` — 서버 kind 8종 → 아이콘 5종·한글 라벨(`Record` 완전성을 tsc가 강제) |
| `model/notificationAction.ts` | `notificationAction(actionType, actionPayload) → route \| null`. `TRIP_ITINERARY`·`TRIP_SUMMARY`·`PLANB_REPLAN`(triggerId 없으면 null)·`REFLECTION_DAILY`(dayDate 없으면 null) → 라우트, `STAY_DETAIL`·미지·null → `null`. 필드는 내부 `segment()` 한 곳에서 `encodeURIComponent`로 읽는다 — `actionType`이 `actionPayload`의 형제라 TS가 유니온을 좁혀 주지 않으므로 방어는 테스트(예제+PBT)뿐. 화면은 결과를 재판정하지 않는다 |
| `model/groupByDay.ts` | `groupByDay(items, now) → {today, earlier}` — 로컬 같은 날이면 오늘. 입력 순서 보존, 유실·중복 0(예제 테스트, PBT 아님) |
| `model/useNotificationInbox.ts` | `useGetMeNotifications`를 감싼 조회 훅(`{items, isLoading, isError}`). ⚠️ 소비처 `NotificationInboxPage`가 `isError`를 안 읽어 조회 실패가 "알림 없음"으로 접힌다. `markAllRead`는 `postMeNotificationsReadAll()` 1회 → `await invalidateQueries` → boolean — 이 `await`를 지키는 테스트는 없다(지우면 재조회 전 버튼이 풀려 깜빡임) |
| `ui/NotificationInboxScreen.tsx` | 순수 프레젠테이션 — 주입 `sections`·`isEmpty`·`onNavigate`만 받고 재판정하지 않는다. 미읽음 dot은 조건부 `View` — SVG `fill` 토글 금지(개념 [[글리프 fill 색 사각]]). "모두 읽음"은 `hasUnread`일 때만, 실패 안내는 `markAllError && hasUnread`일 때만. empty는 로컬 마크업(`StateNotice` 크기와 다름) |
| `ui/NotificationRow.tsx` | 행 1건 — PLAN_B만 인라인 액션(`notification-inbox-action`) press, REFLECTION은 행 전체 press |
| `ui/NotificationInboxGlyphs.tsx` | `NotificationKindIcon`(5 kind 디스패처)·`NotifBellGlyph`(empty). `strokeWidth` 실효 굵기는 `strokeWidth × size ÷ 24` — size만 키우면 선이 굵어진다 |

## 관련

- 페이지 배선: `frontend/.claude/rules/layer-pages.md`(`settings-notifications`·`notification-inbox` 행).
- OS 권한 조회·토큰 등록: `frontend/.claude/rules/layer-shared.md`(`src/shared/push/` 행).
- 개념: [[순수 함수 + PBT (fast-check)]] · [[낙관적 갱신과 롤백 (optimistic update)]] · [[disabled prop과 accessibilityState]] · [[사영 (projection) — 같은 데이터 다른 접기]] · [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]].
