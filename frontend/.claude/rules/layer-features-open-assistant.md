---
paths:
  - "src/features/open-assistant/**"
---
# `src/features/open-assistant/` — ✦ AI 도우미 진입(U8, TRIP-1321)

진입 화면 4곳(홈·숙소 검색·일정 상세·여행 중 허브)이 쓰는 ✦ FAB 와 스택 배치 계산. **라우팅·도우미 서버를 모른다** — FAB 은 `onPress`만 올리고 목적지는 page 가 `assistantHref`로 만든다(페이지마다 expo-router 사용 방식·테스트 목이 달라서). 도우미 훅·계약은 `pages/assistant/assistant-sheet` 소유(features→pages import 금지).

| 파일 | 역할 |
|---|---|
| `src/features/open-assistant/model/fabStack.ts` | ✦ 바닥·토스트 바닥 순수 계산(PBT-U8-F1) — 탭 2단 스택 = ✦ 220 · 토스트 288. 실제 겹침은 jest 사각(6-b) |
| `src/features/open-assistant/ui/AssistantFab.tsx` | 56 원형 ✦ — `bottom` 이 있으면 절대 배치, 없으면 흐름 배치(허브 앵커 열). `toastBottom` 을 주면 붙어 있는 동안 `useRaisedToastBottom`으로 토스트를 올린다 — 마운트 기준이라 탭 화면(항상 마운트)이 있으면 다른 탭에서도 올라간 채다. **키보드 will/did show 가 오면 스스로 `null` 을 그리고 토스트 올림도 푼다**(TRIP-1514, 훅은 모두 `return null` 앞에서 호출) — 시트 열림 숨김은 여전히 호출 화면 몫이고 화면마다 방식이 다르다(홈 = `assistantFab` prop, 숙소 검색·일정 상세 = 시트 열림이면 undefined, 허브 = `fabHidden` 이 앵커째 가림) |
