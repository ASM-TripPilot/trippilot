---
paths:
  - "src/widgets/**"
---
# `src/widgets/` — FSD widgets 층 (TRIP-804 규칙 신설)

여러 화면이 쓰는 **화면 조각**(지도+시트 셸 같은 조립 단위)을 두는 층. **빈 층 — 첫 입주 티켓 대기(TRIP-805).** 디렉토리 자체를 만들지 않았다(D2 — git이 빈 디렉토리를 추적하지 않으므로 첫 입주 티켓이 만든다). 그래서 아래 파일 표가 없다.

## import 방향
- widgets → features · entities · shared 만 참조한다.
- pages · app · app-shell 은 참조하지 못한다(하위 층은 상위 층을 모른다).
- `eslint.config.js`의 층 zone이 강제하고, `src/__tests__/importBoundaryLayers.test.ts`가 widgets→pages 차단을 실측한다.

## 세그먼트
- `ui` / `model` / `lib` / `config` 넷만(옛 칸 `screens·containers·hooks·store` 부활 금지). `api` 세그먼트는 두지 않는다 — 서버 통신은 `shared/api` 단일 계층.
