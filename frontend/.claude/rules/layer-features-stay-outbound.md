---
paths:
  - "src/features/stay-outbound/**"
---
# `src/features/stay-outbound/` — 제휴 고지 시트 → 서버 아웃바운드 (TRIP-1579)

숙소 상세(e03)·인기 숙소 카드·Trip.com 전체 보기가 **같은 제휴 흐름**을 쓰도록 `pages/stay/stay-detail`에서 뽑아낸 슬라이스다. 시트는 완전 제어(useState 0), 흐름 상태는 훅이 쥔다. 다른 feature 글리프는 못 물어 시트 글리프를 로컬로 옮겨 그렸다.

| 파일 | 역할 |
|---|---|
| `src/features/stay-outbound/index.ts` | 공개 API — `index.view` + `useStayOutboundFlow`·`OutboundTarget`·`OutboundQuery` |
| `src/features/stay-outbound/index.view.ts` | 네트워크 없는 진입점 — `OtaChoiceSheet` 만 |
| `src/features/stay-outbound/model/stayOutbound.ts` | (TRIP-1579로 `pages/stay/stay-detail/model`에서 이사) URL 조립 순수 함수 `stayOutboundUrl(stayId, query?)`·`browseOutboundUrl({region?, regionCode?}, query?)` + 여는 함수 `openStayOutbound`·`openBrowseOutbound`(`Linking.openURL` 단일 사다리, 실패면 fallback + `'failed'`). 날짜는 둘 다 `YYYY-MM-DD`이고 checkout > checkin 일 때만, adults 는 양의 정수만 붙인다. `stayOutboundMode()`는 늘 `'affiliate'`(TRIP-1167) — `StayDetailPage` 통합 테스트가 이 이름을 목으로 문다(이름 바꾸면 그 심판이 red) |
| `src/features/stay-outbound/model/useStayOutboundFlow.ts` | 제휴 흐름 훅 — `request(target, query?)`(target `'stay'` = 호텔 상세 아웃바운드, `'browse'` = 지역 목록) + `sheetProps`(열렸을 때만, `<OtaChoiceSheet {...sheetProps} />`). `/me/settings.affiliateNoticeDismissed` 가 true 면 시트 없이 이동, 실패면 error 얼굴. 게스트는 설정을 조회도 캐시 판독도 안 한다(TRIP-778 D9). 가격 칸은 target `showPrice` 로만 켠다(상세만 true) — 전체 보기는 표시명 `TRIPCOM` 고정 |
| `src/features/stay-outbound/ui/OtaChoiceSheet.tsx` | (TRIP-1579로 `pages/stay/stay-detail/ui`에서 이사) 제휴 고지 시트 l07 — `variant: 'default'\|'error'`. 입력은 `item: { externalSource, price? }`(Pick)·`showPrice?`(기본 true — 값이 없으면 '가격 미확인', LOCALDATA 상세 무회귀). `BODY`/`NOTICE` 문자열은 통합 테스트가 리터럴로 완전일치 잠금 |
| `src/features/stay-outbound/ui/OutboundGlyphs.tsx` | 시트 글리프 로컬 복제(`ChevronRight`·`Info`·`Check` — StayGlyphs 와 같은 벡터, `WarningTriangle` 은 shared 재수출) |
