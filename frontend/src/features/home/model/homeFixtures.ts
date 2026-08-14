// 홈 4상태 고정 목업(TRIP-316 · 라이브 Figma 2091:1357 표시값 그대로 상수화). 서버 API가
// 없어(repo-trap) 홈은 이 상수들로만 구동되는 프레젠테이션 화면이다 — 런타임 목(msw 등) 금지.

import type {
  HomeCollectionCard,
  HomeItineraryCard,
  HomeMagazineHero,
  HomePhase,
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

// ── TRIP-317 여행 단계 얼굴 4종(collecting·planning·upcoming·postTrip) ──────────
// 프리뷰(_dev/preview.tsx)에서 실기로 각 얼굴을 보기 위한 상수. (tabs) 실착지는 서버가
// 단계를 줄 계약이 없어 discovery 유지(가정 E) — 이 상수들은 프리뷰 전용 진입점이다.
// discovery 기저(hero·sections) 위에 phase만 주입한다(화면은 phase.kind로만 얼굴을 가른다).

const COLLECTING_PHASE: HomePhase = {
  kind: 'collecting',
  greetTitle: '담아둔 곳이 3곳 모였어요',
  greetSubtitle: '마음에 든 곳들을 모아두고 있어요',
  sectionTitle: '내가 담은 곳',
  savedChipLabel: '담은 곳 3',
  collections: [
    {
      title: '감천문화마을',
      region: '부산 사하구',
      badge: '부산',
      savedAtLabel: '7월 30일 담음',
    },
    {
      title: '해운대 해변',
      region: '부산 해운대구',
      badge: '부산',
      savedAtLabel: '7월 28일 담음',
    },
  ],
};

const PLANNING_PHASE: HomePhase = {
  kind: 'planning',
  greetTitle: '부산 여행 D-21',
  trip: {
    badge: '계획 중',
    dday: 'D-21',
    ctaLabel: '일정 이어서 짜기',
    title: '부산 여행',
    meta: '6월 10일 – 6월 13일 · 3박 4일 · 2명',
  },
  bridge: {
    title: '담은 곳 3곳이 아직 일정에 없어요',
    subtitle: '남은 자리에 넣어볼까요',
    ctaLabel: '일정에 추가',
  },
};

const UPCOMING_PHASE: HomePhase = {
  kind: 'upcoming',
  greetName: '태현님',
  greetTitle: '부산 여행이 곧 시작돼요',
  trip: {
    badge: '출발 전',
    dday: 'D-3',
    ctaLabel: '오늘 일정 보기',
    title: '부산 여행',
    meta: '6월 10일 – 6월 13일 · 3박 4일 · 2명',
  },
  stats: [
    { label: '일정', value: '9곳 완성' },
    { label: '숙소', value: '3/3', caption: '3박 등록' },
  ],
  nextStop: {
    order: '1',
    time: '09:30 · 활동',
    title: '광안리 해변',
    placeMeta: '24시간 개방 · 숙소서 950m',
  },
  nearby: {
    title: '지금 내 주변 살펴보기',
    subtitle: '부산 해운대구 · 걸어서 갈 만한 곳',
  },
  pastTrips: [
    { title: '경주 여행 2026.04 · 2박' },
    { title: '강릉 여행 2026.02 · 1박' },
  ],
};

const POST_TRIP_PHASE: HomePhase = {
  kind: 'postTrip',
  greetTitle: '부산 여행 잘 다녀오셨어요?',
  recap: {
    title: '부산 여행 회고 보기',
    meta: '4곳 방문 · 12km · 사진 6장 · 6.10–6.13',
  },
  share: {
    title: '공유 카드로 남기기',
    subtitle: '사진·동선을 카드 한 장으로',
    ctaLabel: '공유 카드 만들기',
  },
  recommendationTitle: '다음엔 여기 어때요',
  recommendations: [
    { title: '통영 동피랑', region: '경남 통영', badge: '당일치기' },
  ],
  pastTrips: [{ title: '경주 여행 2026.04 · 2박' }],
};

/** collecting 얼굴 — 담은 곳만 있고 여행 없음(US-SHELL-05 착지면). */
export const HOME_COLLECTING_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HERO,
  sections: READY_SECTIONS,
  phase: COLLECTING_PHASE,
};

/** planning 얼굴 — 일정 미완성 여행(계획 중 배지·일정 이어서 짜기·브릿지행). */
export const HOME_PLANNING_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HERO,
  sections: READY_SECTIONS,
  phase: PLANNING_PHASE,
};

/** upcoming 얼굴 — 확정된 예정 여행(출발 전·스탯타일·가장 먼저 갈 곳). */
export const HOME_UPCOMING_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HERO,
  sections: READY_SECTIONS,
  phase: UPCOMING_PHASE,
};

/** postTrip 얼굴 — 종료된 여행(회고 보기·공유·다음 추천). */
export const HOME_POST_TRIP_PROPS: HomeScreenProps = {
  hero: MAGAZINE_HERO,
  sections: READY_SECTIONS,
  phase: POST_TRIP_PHASE,
};
