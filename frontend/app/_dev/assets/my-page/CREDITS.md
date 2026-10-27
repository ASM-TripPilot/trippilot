# 이미지 출처 (app/_dev/assets/my-page)

**개발 프리뷰 전용 의도다.** `app/_dev/preview.tsx` 의 l03 마이페이지 empty(`my-page-empty`) 픽스처가
"지난 여행" 썸네일 카드 사진 칸을 채우는 데만 쓴다 — 실앱은 사진 원본이 기기 로컬에만 있어(INV-U5-03)
회색 자리만 그린다(TRIP-776, 부모 G7).

**그 의도는 빌드가 막는다(TRIP-1347).** `_dev/preview` 는 expo-router 라우트이고 expo-router 는
`_` 접두 경로를 라우트에서 제외하지 않지만, `metro.config.js` 가 `NODE_ENV=production` 에서
`app/_dev` 를 blockList 로 제외한다. 그래서 운영 번들에는 이 화면도, `require` 된 세 파일도 실리지
않고 개발 번들에만 들어간다(`assets/itinerary/CREDITS.md` 와 같은 사정, `pnpm bundle:report` 가
CI 에서 0건 단언 — TRIP-1612).

| 파일 | 출처 | 라이선스 |
|---|---|---|
| `past-jeju.jpg` | Figma 와이어프레임 파일 `1MTF3dtptIrbg8gld5IdO2` · l03 empty 제주 여행 썸네일 노드 `1603:2469` | **확인되지 않음** |
| `past-gangneung.jpg` | 같은 파일 · 강릉 여행 썸네일 노드 `1603:2476` | **확인되지 않음** |
| `past-busan.jpg` | 같은 파일 · 부산 여행 썸네일 노드 `1603:2483` | **확인되지 않음** |

## 알아야 할 것

- 세 장 모두 **디자이너가 Figma 목업에 넣은 사진**을 내려받은 것이다(2026-09-25, TRIP-776).
  원저작자와 이용 조건을 확인하지 못했다.
- 그래서 **프로덕션 화면에서는 import 하지 않는다.**
- **라이선스는 여전히 미확인이다**: 운영 번들에는 안 실리지만 리포 에셋이라, 라이선스가 분명한
  사진으로 갈아치우거나 `_dev` 제외가 풀리는 일이 없는지 계속 확인해야 한다.
- 원본은 1280px 였다. 표시 크기가 64×64 라 긴 변 480px 로 줄여 넣었다.
