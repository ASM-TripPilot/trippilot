// 홈 4상태 고정 목업(TRIP-170 · Q2 결정: Figma 표시값 그대로 상수화). 서버 API가 없어(브리프
// §6-1) 홈은 이 상수들로만 구동되는 프레젠테이션 화면이다 — 런타임 목(msw 등) 사용 금지.

import type {
  HomeNextPlan,
  HomePopularPlace,
  HomeRecordCard,
  HomeResume,
  HomeScreenProps,
  HomeTasteBlock,
  HomeTripHero,
} from './homeTypes';

const DEFAULT_TRIP: HomeTripHero = {
  overlay: { dday: 'D-12', nights: '2박 3일', title: '부산 여행' },
  meta: '6.10~6.12 · 숙소 1곳 · 3명',
  // Figma progressFill 98px / heroBody 트랙 폭 326px ≈ 0.3 (02a §4-C)
  progressRatio: 98 / 326,
};

const DEFAULT_NEXT_PLAN: HomeNextPlan = {
  dateLabel: '6.11 (수)',
  summary: '09:00 · 감천문화마을 · 도보 850m',
  prepLabel: '여행 준비',
  prepPercent: '60%',
  prepRatio: 0.6,
};

const DEFAULT_RESUME: HomeResume = {
  title: '짜던 일정 이어서 편집',
  meta: '부산 여행 · 2일차 · 3분 전',
};

const DEFAULT_TASTE: HomeTasteBlock = {
  chips: ['바다', '미식', '느긋'],
  featured: {
    name: '해동용궁사',
    description: '탁 트인 바다 위 사찰',
    badge: '내 취향과 잘 맞아요',
  },
};

const POPULAR_PLACES: readonly HomePopularPlace[] = [
  { name: '감천문화마을', stat: '1.2k 저장', hot: false },
  { name: '광안리 해변', stat: null, hot: true },
  { name: '전포 카페거리', stat: '980 저장', hot: false },
];

const RECORD_CARD: HomeRecordCard = {
  author: '여행자민',
  // 아바타 원 안 글자는 author 전체 이름의 첫 글자가 아니라 Figma가 별도로 보여주는 값이다
  // (authorRow: 아바타 "민" + "여행자민" — 게이트①-2 후속, 03 §8-4).
  authorInitial: '민',
  authorTaste: '바다·미식 느긋',
  title: '부산 2박 3일 미식 코스',
  chips: ['부산', '2박 3일', '친구'],
  meta: '방문 8곳 · 동선 12km',
  likes: '24',
  comments: '8',
};

/** AC-1 · 여행 있음(진행 중) — 크롬+hero+부가 카드 3종+섹션 전부. */
export const HOME_DEFAULT_PROPS: HomeScreenProps = {
  trip: DEFAULT_TRIP,
  nextPlan: DEFAULT_NEXT_PLAN,
  resume: DEFAULT_RESUME,
  taste: DEFAULT_TASTE,
  sections: { kind: 'ready', popular: POPULAR_PLACES, record: RECORD_CARD },
};

/** AC-2 · 첫 사용자 — trip null, 부가 카드 전부 null. 섹션은 §0 확정대로 실데이터 유지. */
export const HOME_NO_TRIP_PROPS: HomeScreenProps = {
  trip: null,
  nextPlan: null,
  resume: null,
  taste: null,
  sections: { kind: 'ready', popular: POPULAR_PLACES, record: RECORD_CARD },
};

/** AC-3 · 취향 부족 — 섹션은 유도 카드/빈 문구로 채워진다(침묵 실패 아님). */
export const HOME_EMPTY_PROPS: HomeScreenProps = {
  trip: DEFAULT_TRIP,
  nextPlan: null,
  resume: null,
  taste: null,
  sections: { kind: 'empty' },
};

/** AC-4 · 로딩 — 섹션은 스켈레톤, 가용 카드(hero·새 여행 만들기)는 정상 표시. */
export const HOME_LOADING_PROPS: HomeScreenProps = {
  trip: DEFAULT_TRIP,
  nextPlan: null,
  resume: null,
  taste: null,
  sections: { kind: 'loading' },
};
