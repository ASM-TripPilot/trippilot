---
paths:
  - "src/features/open-assistant/**"
---
# `src/features/open-assistant/` — ✦ AI 도우미 진입(U8, TRIP-1321)

도우미 시트로 가는 목적지(`assistantHref`)와 ✦·말풍선 글리프. **✦ FAB 는 TRIP-1553 에서 삭제됐다** — 홈은 헤더 벨 왼쪽 ✦ 아이콘(벨이 행 오른쪽 끝, TRIP-1553 후속)(`home-dashboard-assistant`, page 몫 — `pages/home/ui/HomeScreen.tsx` 의 `GreetingHeader`), 여행 중 허브는 하단 바 챗봇 칸(`ChatBubbleGlyph`, TRIP-1522)이 1차 진입이고 숙소 검색·일정 상세는 진입이 없다. **라우팅·도우미 서버를 모른다** — 목적지는 page 가 `assistantHref`로 만든다(페이지마다 expo-router 사용 방식·테스트 목이 달라서). 도우미 훅·계약은 `pages/assistant/assistant-sheet` 소유(features→pages import 금지).

| 파일 | 역할 |
|---|---|
| `src/features/open-assistant/ui/AssistantGlyphs.tsx` | `SparkleGlyph`(✦)·`ChatBubbleGlyph`(TRIP-1522 신규 — 말풍선+가운데 점 셋, 허브 하단 바 챗봇 칸). 말풍선은 `shared/ui/glyphs`·`ItineraryGlyphs`·`TripGlyphs` 에 없었고 Figma 킷 §6 에도 아직 미등록이다. 챗봇 칸이 ✦ 와 시각적으로 구분되도록 따로 만들었다(v1 은 같은 ✦ 라 AI 도우미 ✦ 와 혼동) |
