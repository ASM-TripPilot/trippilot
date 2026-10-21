---
paths:
  - "src/features/open-assistant/**"
---
# `src/features/open-assistant/` — ✦ AI 도우미 진입(U8, TRIP-1321)

진입 화면(홈·숙소 검색·일정 상세 등)이 쓰는 ✦ FAB 와 스택 배치 계산. 여행 중 허브는 TRIP-1522 부터 ✦ FAB 를 안 쓰고 하단 바 챗봇 칸(`ChatBubbleGlyph`)으로 들어간다. **라우팅·도우미 서버를 모른다** — FAB 은 `onPress`만 올리고 목적지는 page 가 `assistantHref`로 만든다(페이지마다 expo-router 사용 방식·테스트 목이 달라서). 도우미 훅·계약은 `pages/assistant/assistant-sheet` 소유(features→pages import 금지).

| 파일 | 역할 |
|---|---|
| `src/features/open-assistant/model/fabStack.ts` | ✦ 바닥·토스트 바닥 순수 계산(PBT-U8-F1) — 탭 2단 스택 = ✦ 220 · 토스트 288. 실제 겹침은 jest 사각(6-b) |
| `src/features/open-assistant/ui/AssistantFab.tsx` | 56 원형 ✦ — `bottom` 이 있으면 절대 배치, 없으면 흐름 배치(허브 앵커 열). `toastBottom` 을 주면 붙어 있는 동안 `useRaisedToastBottom`으로 토스트를 올린다 — 마운트 기준이라 탭 화면(항상 마운트)이 있으면 다른 탭에서도 올라간 채다 |
| `src/features/open-assistant/ui/AssistantGlyphs.tsx` | `SparkleGlyph`(✦)·`ChatBubbleGlyph`(TRIP-1522 신규 — 말풍선+가운데 점 셋, 허브 하단 바 챗봇 칸). 말풍선은 `shared/ui/glyphs`·`ItineraryGlyphs`·`TripGlyphs` 에 없었고 Figma 킷 §6 에도 아직 미등록이다. 챗봇 칸이 ✦ 와 시각적으로 구분되도록 따로 만들었다(v1 은 같은 ✦ 라 AI 도우미 ✦ 와 혼동) |
