---
paths:
  - "src/features/notification/**"
---
# `src/features/notification/` — l02 알림 설정 + l01 알림함 표면

두 화면 뷰와 전용 부품(`ToggleRow`·`PermissionBanner`·`NotificationRow`·`NotificationInboxGlyphs`)은 **TRIP-1154로 `pages/settings/settings-notifications`·`pages/settings/notification-inbox` 이사** — 행은 `layer-pages.md`. 여기엔 page가 쓰는 model과 두 page가 함께 쓰는 `NotificationGlyphs`만 남았다. TRIP-1155로 그 model 6개도 `pages/settings/notification-inbox`·`pages/settings/settings-notifications`로 이사해 `NotificationGlyphs`만 남았다.

**경계**: 이 폴더는 다른 `features/*`를 import할 수 없다 — eslint 층 zone(전 feature 강제)이 막는다. `require()` 문자열은 zone 밖이다.

| 파일 | 역할 |
|---|---|
| `ui/NotificationGlyphs.tsx` | `NotifBackChevronGlyph`·`NotifInfoGlyph`·`NotifWarningGlyph` — features 간 import 금지라 feature-로컬로 그림 |

## 관련

- 페이지 배선: `frontend/.claude/rules/layer-pages.md`(`settings-notifications`·`notification-inbox` 행).
- OS 권한 조회·토큰 등록: `frontend/.claude/rules/layer-shared.md`(`src/shared/push/` 행).
- 개념: [[순수 함수 + PBT (fast-check)]] · [[낙관적 갱신과 롤백 (optimistic update)]] · [[disabled prop과 accessibilityState]] · [[사영 (projection) — 같은 데이터 다른 접기]] · [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]].
