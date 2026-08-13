// 홈 4상태 고정 목업(TRIP-316 · 라이브 Figma 2091:1357 표시값 그대로 상수화). 서버 API가
// 없어(repo-trap) 홈은 이 상수들로만 구동되는 프레젠테이션 화면이다 — 런타임 목(msw 등) 금지.

import type {
  HomeCollectionCard,
  HomeItineraryCard,
  HomeMagazineHero,
  HomeScreenProps,
  HomeSections,
  HomeSpotCard,
} from './homeTypes';

const MAGAZINE_HERO: HomeMagazineHero = {
  eyebrow: '오늘의 여행 영감',
  title: '부산 · 광안리의 밤',
  subtitle: '다리 위로 번지는 불빛, 상상만으로 설레는 야경',
  chips: ['당일치기로 충분', '야경 명소'],
};

const COLLECTIONS: readonly HomeCollectionCard[] = [
  { title: '감천문화마을', region: '부산 사하구', badge: '당일치기' },
  { title: '해운대 해변', region: '부산 해운대구', badge: '1박 2일' },
  { title: '해동용궁사', region: '부산 기장군', badge: '반나절' },
];

const SPOTS: readonly HomeSpotCard[] = [
  { title: '전포 카페거리', tag: '#감성카페' },
  { title: '자갈치 시장', tag: '#로컬푸드' },
  { title: '광안리 SUP', tag: '#액티비티' },
  { title: '황령산 전망대', tag: '#야경명소' },
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
  hero: MAGAZINE_HERO,
  sections: READY_SECTIONS,
};

/**
 * AC-3 · 첫 사용자 — 신 피드는 여행 유무와 무관하므로(가정 B) default와 동일 섹션을 그린다.
 * 핵심은 온램프(softNote/FAB)가 그대로 노출된다는 것(장소 먼저 담기 유도, US-SHELL-05).
 */
export const HOME_NO_TRIP_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HERO,
  sections: READY_SECTIONS,
};

/** AC-4 · 부분 실패(empty) — 빈 섹션은 가시 플레이스홀더로 드러난다(침묵 은닉 금지, INV-4). */
export const HOME_EMPTY_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HERO,
  sections: { kind: 'empty' },
};

/** AC-5 · 로딩(loading) — 섹션 자리에 스켈레톤, 고정 블록(인사·검색·hero·온램프)은 정상. */
export const HOME_LOADING_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HERO,
  sections: { kind: 'loading' },
};
