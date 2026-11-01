# 이미지 출처 (src/shared/ui/placeholders/home)

**개발/프리뷰 전용 생성 플레이스홀더다.** a01(홈) default 얼굴의 컬렉션 카드·스팟 그리드가
사진 자리를 채우는 데 쓴다(홈 히어로는 TRIP-1432 부터 번들 도시 그림 `assets/region-covers/hero/`) — Figma `2091:1357`과 육안 대조할 때 사진 칸이
회색 토큰 View로만 비어 있으면 "피그마 실행 중" 대조가 불가능해서 들인 값이다(TRIP-694).

**실사진이 아니다.** 9장 전부 Pillow(PIL)로 그린 **대각선 2색 그라디언트**다 — 부산 테마
톤(야경·해안·석양)만 흉내 낸 장식물이라 원저작물이 없고 **라이선스 이슈가 없다**. 서버가 준
실 `imageUrl`이 오기 전까지의 자리채움이며, INV-1(폐집합 후보)과 무관하다(웹 POI가 아니라
로컬 생성 장식물).

| 파일 | 용도 | 출처 |
|---|---|---|
| `hero-night.jpg`·`hero-view.jpg` | 프리뷰(`app/_dev/preview.tsx`)·`MapView.recordMarkers.test` 직접 require (a02 매거진 카드는 2026-11-01 삭제) | PIL 생성 그라디언트 |
| `collection-gamcheon.jpg`·`collection-haeundae.jpg`·`collection-yonggungsa.jpg` | 컬렉션 카드 3장 | PIL 생성 그라디언트 |
| `spot-jeonpo.jpg`·`spot-jagalchi.jpg`·`spot-sup.jpg`·`spot-hwangnyeong.jpg` | 스팟 그리드 4장 | PIL 생성 그라디언트 |

## 알아야 할 것

- 라이선스 이슈는 없지만 **생성 그라디언트라 실사진 충실도는 없다.** "피그마 실행 중 착각"
  완료조건의 사진 부분은 실사진으로 갈아끼우는 **후속 티켓**에서 완성된다(TRIP-694는 Image
  배선 + 자리채움까지).
- 이 9장은 `_dev/preview`가 `require`하는데, 운영 번들(`NODE_ENV=production`)에서는 `metro.config.js`
  blockList 가 `app/_dev` 를 제외해 번들에 실리지 않는다(TRIP-1347, `pnpm bundle:report` 가 CI 에서 0건 단언).
  개발 번들에만 들어간다. 어차피 라이선스 무관이라 릴리스 차단 사유는 아니다 — 실사진으로 바꿀 때 이 파일도 갱신할 것.
- 재생성: 이 폴더(옛 `src/assets/home`, TRIP-1161 이동) 생성 스크립트는 TRIP-694 사이클 원장(`_workspace/20260917-trip694-home-default`)에 기록.
