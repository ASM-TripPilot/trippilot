// a02 "여행지 둘러보기" 매거진 목록 화면의 고정 목업(TRIP-700 · 라이브 Figma 2091:1940 표시값
// 그대로 상수화). 서버 매거진/에디토리얼 API 가 없어(01b Q4·홈 슬라이스 선례) 이 상수들로만
// 구동되는 프레젠테이션 화면이다 — 런타임 목(msw 등) 금지. 칩 라벨·에디토리얼 카피·6카드
// 상수를 여기(model)에 둔다(home 슬라이스는 config 세그먼트가 없다 — 01b 드리프트 확정).
//
// D-1 순수성(homeStructure): 네트워크·쿼리·라우팅 계층 심볼을 import 하지 않는다 — 라우팅은
// 라우트/페이지가 진다. `Image` 만 홈 픽스처(homeFixtures)와 같은 방식으로 쓴다(에셋 uri 변환).

import { Image } from 'react-native';

import type {
  MagazineCard,
  MagazineEditorial,
  MagazineScreenProps,
} from './magazineTypes';

// 번들 에셋(number 참조)을 `<Image source={{ uri }} />` 자리에 넣을 문자열 URI 로 푼다
// (homeFixtures.toUri 와 동형 — 슬라이스 내부 헬퍼라 재적음). jest·웹에선 `.uri` 가 undefined
// → `?? null` 로 계약(imageUrl: string | null)에 맞춘다(테스트는 사진 없는 카드, 실기만 썸네일).
// 실사진 미소싱이라 홈 부산 톤 플레이스홀더를 재사용한다 — 출처·라이선스: src/assets/home/CREDITS.md.
const toUri = (source: number): string | null =>
  Image.resolveAssetSource?.(source)?.uri ?? null;

// 필터 칩 5(정확히 5, Figma 좌→우). "전체" 기본 선택(bg-ink). 카드는 selected 와 무관하게 고정
// (시각 전용 필터, 01b Q4) — 서버 매거진 API 가 없어 실제로 거르지 않는다.
const MAGAZINE_CHIPS = [
  '전체',
  '당일치기',
  '1박 2일',
  '2박 3일',
  '한 달 살기',
] as const;

// 에디토리얼 카드(감천문화마을) — 좌상단 핑크 알약(eyebrow) + 대형 타이틀·서브 + 하단 반투명 칩 2.
const MAGAZINE_EDITORIAL: MagazineEditorial = {
  eyebrow: '이 주의 여행 이야기',
  title: '골목마다 색이 다른 마을',
  subtitle: '감천문화마을에서 반나절, 사진만 담아도 하루가 채워져요',
  chips: ['당일치기', '포토 명소'],
  imageUrl: toUri(require('@/assets/home/collection-gamcheon.jpg')),
};

// 매서너리 6카드 — 좌열(200/250/180) 3장 → 우열(260/190/220) 3장 순(card-i = cards[i] 인덱스).
// height 가 2열 불균등을 결정한다(라이브러리·측정 로직 없음). 사진은 홈 플레이스홀더 재사용.
const MAGAZINE_CARDS: readonly MagazineCard[] = [
  {
    title: '전포 카페 투어',
    tag: '#감성카페',
    height: 200,
    imageUrl: toUri(require('@/assets/home/spot-jeonpo.jpg')),
  },
  {
    title: '해운대 오션뷰',
    tag: '#바다멍',
    height: 250,
    imageUrl: toUri(require('@/assets/home/collection-haeundae.jpg')),
  },
  {
    title: '자갈치 먹방',
    tag: '#로컬푸드',
    height: 180,
    imageUrl: toUri(require('@/assets/home/spot-jagalchi.jpg')),
  },
  {
    title: '부산 야경 명소',
    tag: '#야경',
    height: 260,
    imageUrl: toUri(require('@/assets/home/hero-night.jpg')),
  },
  {
    title: '바다 위 사찰',
    tag: '#힐링',
    height: 190,
    imageUrl: toUri(require('@/assets/home/collection-yonggungsa.jpg')),
  },
  {
    title: '광안리 산책',
    tag: '#노을',
    height: 220,
    imageUrl: toUri(require('@/assets/home/hero-view.jpg')),
  },
];

/** a02 정상 얼굴 — 칩 5(전체 선택)·에디토리얼·매서너리 6장. 콜백은 컨테이너(MagazinePage)가 얹는다. */
export const MAGAZINE_DEFAULT_PROPS: MagazineScreenProps = {
  chips: MAGAZINE_CHIPS,
  selected: '전체',
  editorial: MAGAZINE_EDITORIAL,
  cards: MAGAZINE_CARDS,
};
