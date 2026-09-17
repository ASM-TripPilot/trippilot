// 홈 4상태 고정 목업(TRIP-316 · 라이브 Figma 2091:1357 표시값 그대로 상수화). 서버 API가
// 없어(repo-trap) 홈은 이 상수들로만 구동되는 프레젠테이션 화면이다 — 런타임 목(msw 등) 금지.

import { Image } from 'react-native';

import type {
  HomeCollectionCard,
  HomeItineraryCard,
  HomeMagazineHero,
  HomePhase,
  HomeScreenProps,
  HomeSections,
  HomeSpotCard,
} from './homeTypes';

// 로컬 생성 그라디언트 에셋(부산 톤 플레이스홀더)을 문자열 URI 로 푼다(h11 선례). RN 에선
// `require('...jpg')`가 번들 에셋 참조(숫자)라 `<Image source={{ uri }} />` 자리에 넣으려면
// `resolveAssetSource(...).uri` 로 풀어야 한다. jest·웹에선 `.uri`가 undefined → `?? null`로
// 계약(`imageUrl: string | null`)에 맞춘다(테스트는 사진 없는 카드, 실기에서만 썸네일).
// 출처·라이선스: src/assets/home/CREDITS.md.
const toUri = (source: number): string | null =>
  Image.resolveAssetSource?.(source)?.uri ?? null;

// 히어로 캐러셀 5페이지 사진(부산 야경·해안·카페·시장·전망 순). page0 은 신·구 공통 픽셀 정본.
const HERO_IMAGES = [
  require('@/assets/home/hero-night.jpg'),
  require('@/assets/home/hero-coast.jpg'),
  require('@/assets/home/hero-cafe.jpg'),
  require('@/assets/home/hero-market.jpg'),
  require('@/assets/home/hero-view.jpg'),
].map(toUri);

const COLLECTION_IMAGES = [
  require('@/assets/home/collection-gamcheon.jpg'),
  require('@/assets/home/collection-haeundae.jpg'),
  require('@/assets/home/collection-yonggungsa.jpg'),
].map(toUri);

const SPOT_IMAGES = [
  require('@/assets/home/spot-jeonpo.jpg'),
  require('@/assets/home/spot-jagalchi.jpg'),
  require('@/assets/home/spot-sup.jpg'),
  require('@/assets/home/spot-hwangnyeong.jpg'),
].map(toUri);

// 히어로 5장 페이징 캐러셀(TRIP-694). page0 은 TRIP-316 정본 그대로, page1~4 는 부산 테마
// 영감 카드(문구가 인사·섹션 헤더·소요시간과 겹치지 않게 발명 — within 단일매치·INV-3 안전).
const MAGAZINE_HEROES: readonly HomeMagazineHero[] = [
  {
    eyebrow: '오늘의 여행 영감',
    title: '부산 · 광안리의 밤',
    subtitle: '다리 위로 번지는 불빛, 상상만으로 설레는 야경',
    chips: ['당일치기로 충분', '야경 명소'],
    imageUrl: HERO_IMAGES[0],
  },
  {
    eyebrow: '이번 주 뜨는 코스',
    title: '해운대 · 바다 곁 산책',
    subtitle: '파도 소리와 함께 걷는 해변 산책로',
    chips: ['드라이브 코스', '바다 전망'],
    imageUrl: HERO_IMAGES[1],
  },
  {
    eyebrow: '로컬 감성 한 스푼',
    title: '전포 · 골목 카페 순례',
    subtitle: '오래된 골목에 스며든 커피 향',
    chips: ['카페 투어', '골목 산책'],
    imageUrl: HERO_IMAGES[2],
  },
  {
    eyebrow: '맛으로 떠나는 여행',
    title: '자갈치 · 시장의 아침',
    subtitle: '갓 잡은 해산물과 활기찬 좌판',
    chips: ['먹거리 천국', '로컬 시장'],
    imageUrl: HERO_IMAGES[3],
  },
  {
    eyebrow: '노을이 머무는 곳',
    title: '황령산 · 도시의 파노라마',
    subtitle: '발아래 펼쳐지는 부산의 불빛',
    chips: ['전망 명소', '노을 스팟'],
    imageUrl: HERO_IMAGES[4],
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

const ITINERARIES: readonly HomeItineraryCard[] = [
  { title: '부산 미식 3일 코스', nights: '2박 3일' },
  { title: '해운대 오션뷰 힐링', nights: '2박 3일' },
  { title: '로컬 시장 & 카페', nights: '1박 2일' },
];

const READY_SECTIONS: HomeSections = {
  kind: 'ready',
  collections: COLLECTIONS,
  spots: SPOTS,
  itineraries: ITINERARIES,
};

/** AC-1 · 정상(ready) — 인사·검색·영감 hero·섹션 3종·온램프 전부. */
export const HOME_DEFAULT_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HEROES,
  sections: READY_SECTIONS,
};

/** AC-5 · 로딩(loading) — 섹션 자리에 스켈레톤, 고정 블록(인사·검색·hero·온램프)은 정상. */
export const HOME_LOADING_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HEROES,
  sections: { kind: 'loading' },
};

// ── TRIP-317 여행 단계 얼굴 2종(planning·postTrip; collecting·upcoming은 TRIP-701 제거) ──
// 프리뷰(_dev/preview.tsx)에서 실기로 각 얼굴을 보기 위한 상수. (tabs) 실착지는 서버가
// 단계를 줄 계약이 없어 discovery 유지(가정 E) — 이 상수들은 프리뷰 전용 진입점이다.
// discovery 기저(hero·sections) 위에 phase만 주입한다(화면은 phase.kind로만 얼굴을 가른다).

const PLANNING_PHASE: HomePhase = {
  kind: 'planning',
  greetTitle: '부산 여행 D-21',
  // TRIP-696 인사 2줄 서브카피 + 지역 컬렉션 헤더(기본 "요즘 사람들이 담는 곳" 대체).
  greetSubtitle: '일정을 이어서 짜볼까요',
  collectionsTitle: '부산에서 담을 만한 곳',
  trip: {
    badge: '계획 중',
    badgeSub: '· D-21', // TRIP-696 두 톤 배지 보조(구 우상단 대형 dday 흡수)
    ctaLabel: '일정 이어서 짜기 ›', // 꺾쇠(›) 포함 — Figma 3460:1848(프리뷰 6-b 정합)
    title: '부산 여행',
    meta: '6월 10일 – 6월 13일 · 3박 4일 · 2명',
  },
  bridge: {
    title: '담은 곳 3곳이 아직 일정에 없어요',
    subtitle: '남은 자리에 넣어볼까요',
    ctaLabel: '일정에 추가',
  },
};

// TRIP-697 여행 중 얼굴 — 통합 히어로(696)의 planning 변형. 계획 중과 kind 는 같은 'planning'
// 이고 데이터만 다르다: 배지 "여행 중"+"· 1 일차"(N일차), 인사 이름줄 greetName + 타이틀
// (서브카피 없음), CTA "오늘 일정 보기 ›", showSpots=true(2섹션), collectionsTitle 미지정→기본.
// greetName·greetTitle 은 Figma 2091:1717 정본. 라이브 resolveHomePhase 는 이름 소스가 없어
// greetName 을 안 채우므로(맹점③) 이 이름줄은 픽스처(프리뷰) 전용이다.
const TRAVELING_PHASE: HomePhase = {
  kind: 'planning',
  greetName: '태현님,',
  greetTitle: '부산 여행 1일차예요',
  showSpots: true,
  trip: {
    badge: '여행 중',
    badgeSub: '· 1 일차', // N일차(공백 O) — 여행 첫날 = 1일차
    ctaLabel: '오늘 일정 보기 ›', // 꺾쇠(›) 포함 문자열
    title: '부산 여행',
    meta: '6월 10일 – 6월 13일 · 3박 4일 · 2명',
  },
  bridge: {
    title: '담은 곳 3곳이 아직 일정에 없어요',
    subtitle: '남은 자리에 넣어볼까요',
    ctaLabel: '일정에 추가',
  },
};

// TRIP-698 여행 완료 얼굴 — 696 통합 히어로 재사용(배지 "여행 완료"·success·단일)·인사 2줄·
// 섹션 순서 반전(지난 여행 가로 사진 카드 → 추천). 지난 여행 2장은 날짜 분리(title/dateLabel)+
// 사진 미소싱(imageUrl:null tint, 01b Q2). 추천은 default COLLECTIONS 3장. recap·share 제거.
const POST_TRIP_PHASE: HomePhase = {
  kind: 'postTrip',
  greetTitle: '부산 여행 잘 다녀오셨어요?',
  greetSubtitle: '기록을 정리하고 나눠볼까요',
  trip: {
    badge: '여행 완료',
    badgeTone: 'success', // 초록(01b 확정) — badgeSub 없음(단일 배지)
    ctaLabel: '회고 보기 ›', // 꺾쇠(›) 포함
    title: '부산 여행',
    meta: '4곳 방문 · 12km · 사진 6장 · 6.10–6.13', // 12km=거리(INV-3 OK)
  },
  recommendationTitle: '다음엔 여기 어때요',
  recommendations: COLLECTIONS,
  pastTrips: [
    { title: '경주 여행', dateLabel: '2026.04 · 2박', imageUrl: null },
    { title: '강릉 여행', dateLabel: '2026.02 · 1박', imageUrl: null },
  ],
};

/** planning 얼굴 — 일정 미완성 여행(계획 중 배지·일정 이어서 짜기·브릿지행). */
export const HOME_PLANNING_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HEROES,
  sections: READY_SECTIONS,
  phase: PLANNING_PHASE,
};

/** planning '여행 중' 얼굴(TRIP-697) — 여행 중 배지·N일차·이름줄 인사·2섹션(컬렉션+스팟). */
export const HOME_TRAVELING_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HEROES,
  sections: READY_SECTIONS,
  phase: TRAVELING_PHASE,
};

/** postTrip 얼굴 — 종료된 여행(통합 히어로 회고 보기·지난 여행·다음 추천). */
export const HOME_POST_TRIP_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HEROES,
  sections: READY_SECTIONS,
  phase: POST_TRIP_PHASE,
};
