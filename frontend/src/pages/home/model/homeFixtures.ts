// 홈 기본값(TRIP-316 · 라이브 Figma 2091:1357 표시값 그대로 상수화). 서버 API가 없어(repo-trap)
// 홈은 이 상수로 구동되는 프레젠테이션 화면이다 — 런타임 목(msw 등) 금지.
// 로딩·계획 중·여행 중·여행 후 얼굴은 프리뷰·테스트 전용이라 `__fixtures__/homePhaseFixtures.ts` 로 옮겼다(TRIP-1616 —
// 운영 번들은 `__fixtures__` 를 Metro blockList 로 막으므로 이 파일에 되돌리면 운영 export 가 깨진다).

import { Image } from 'react-native';

import { PLACEHOLDER_PHOTOS } from '@/shared/ui/placeholders';

import type {
  HomeCollectionCard,
  HomeMagazineHero,
  HomeScreenProps,
  HomeSections,
  HomeSpotCard,
} from './homeTypes';

// 로컬 생성 그라디언트 에셋(부산 톤 플레이스홀더)을 문자열 URI 로 푼다(h11 선례). RN 에선
// `require('...jpg')`가 번들 에셋 참조(숫자)라 `<Image source={{ uri }} />` 자리에 넣으려면
// `resolveAssetSource(...).uri` 로 풀어야 한다. jest·웹에선 `.uri`가 undefined → `?? null`로
// 계약(`imageUrl: string | null`)에 맞춘다(테스트는 사진 없는 카드, 실기에서만 썸네일).
// 출처·라이선스: src/shared/ui/placeholders/home/CREDITS.md.
const toUri = (source: number): string | null =>
  Image.resolveAssetSource?.(source)?.uri ?? null;

const COLLECTION_IMAGES = [
  PLACEHOLDER_PHOTOS.collectionGamcheon,
  PLACEHOLDER_PHOTOS.collectionHaeundae,
  PLACEHOLDER_PHOTOS.collectionYonggungsa,
].map(toUri);

const SPOT_IMAGES = [
  PLACEHOLDER_PHOTOS.spotJeonpo,
  PLACEHOLDER_PHOTOS.spotJagalchi,
  PLACEHOLDER_PHOTOS.spotSup,
  PLACEHOLDER_PHOTOS.spotHwangnyeong,
].map(toUri);

// 히어로 도시 카드 3장(TRIP-1432) — 서비스 지역 서울·부산·제주. 누르면 그 도시로 거른 탐색 탭이 열린다
// (regionCode = 탐색 탭 URL region). 배경은 번들 hero/ 그림(6:7 세로, 히어로 칸용 — 여행 카드의 covers/ 아님).
// 문구는 Figma 에 3도시 카드가 없어 정했다(브리프 Q3) — 섹션 제목·스팟 태그와 같은 텍스트가 되지 않게.
const CITY_HEROES: readonly HomeMagazineHero[] = [
  {
    eyebrow: '오늘의 여행 영감',
    title: '서울 · 남산과 한옥',
    subtitle: '기와지붕 너머로 남산 타워가 보이는 도시',
    chips: ['도심', '감성'],
    regionCode: '11',
    coverSource: require('../../../../assets/region-covers/hero/11.webp'),
  },
  {
    eyebrow: '오늘의 여행 영감',
    title: '부산 · 광안리의 밤',
    subtitle: '다리 위로 번지는 불빛, 상상만으로 설레는 야경',
    chips: ['바다', '야경'],
    regionCode: '26',
    coverSource: require('../../../../assets/region-covers/hero/26.webp'),
  },
  {
    eyebrow: '오늘의 여행 영감',
    title: '제주 · 오름과 돌담',
    subtitle: '검은 돌담 너머로 오름이 이어지는 섬',
    chips: ['섬', '자연'],
    regionCode: '50',
    coverSource: require('../../../../assets/region-covers/hero/50.webp'),
  },
];

const COLLECTIONS: readonly HomeCollectionCard[] = [
  {
    title: '감천문화마을',
    region: '부산 사하구',
    badge: '당일치기',
    imageUrl: COLLECTION_IMAGES[0],
  },
  {
    title: '해운대 해변',
    region: '부산 해운대구',
    badge: '1박 2일',
    imageUrl: COLLECTION_IMAGES[1],
  },
  {
    title: '해동용궁사',
    region: '부산 기장군',
    badge: '반나절',
    imageUrl: COLLECTION_IMAGES[2],
  },
];

const SPOTS: readonly HomeSpotCard[] = [
  { title: '전포 카페거리', tag: '#감성카페', imageUrl: SPOT_IMAGES[0] },
  { title: '자갈치 시장', tag: '#로컬푸드', imageUrl: SPOT_IMAGES[1] },
  { title: '광안리 SUP', tag: '#액티비티', imageUrl: SPOT_IMAGES[2] },
  { title: '황령산 전망대', tag: '#야경명소', imageUrl: SPOT_IMAGES[3] },
];

const READY_SECTIONS: HomeSections = {
  kind: 'ready',
  collections: COLLECTIONS,
  spots: SPOTS,
};

/** AC-1 · 정상(ready) — 인사·검색·영감 hero·섹션 2종·온램프 전부. */
export const HOME_DEFAULT_PROPS: HomeScreenProps = {
  hero: CITY_HEROES,
  sections: READY_SECTIONS,
};
