// 홈 단계별 얼굴(로딩·계획 중·여행 중·여행 후) — 프리뷰(_dev/preview)·테스트 전용 상수(TRIP-1616 이 homeFixtures.ts 에서 옮김).
// 운영 번들은 `__fixtures__` 를 Metro blockList 로 막는다 — 운영 코드는 이 파일을 import 하지 않는다.
// hero·sections 는 운영 기본값(HOME_DEFAULT_PROPS)에서 파생해 따로 놀지 않게 한다.

import { HOME_DEFAULT_PROPS } from '../homeFixtures';
import type { HomePhase, HomeScreenProps } from '../homeTypes';

const { hero: HERO, sections: READY_SECTIONS } = HOME_DEFAULT_PROPS;
// 추천 카드(여행 후)가 기본 컬렉션 3장을 재사용하므로 ready 여야 한다 — 아니면 조용히 비우지 않고 여기서 실패한다.
if (READY_SECTIONS.kind !== 'ready') {
  throw new Error('HOME_DEFAULT_PROPS.sections 가 ready 가 아니다');
}
const COLLECTIONS = READY_SECTIONS.collections;

/** AC-5 · 로딩(loading) — 섹션 자리에 스켈레톤, 고정 블록(인사·검색·hero·온램프)은 정상. */
export const HOME_LOADING_PROPS: HomeScreenProps = {
  hero: HERO,
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
// 이고 데이터만 다르다: 배지 "여행 중"+"· 1일차"(N일차), 인사 이름줄 greetName + 타이틀
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
    badgeSub: '· 1일차', // N일차(붙임) — 여행 첫날 = 1일차
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
    ctaLabel: '회고 보기', // 라이브 생산자(resolveHomePhase)와 같은 문구 — 꺾쇠 없음(TRIP-1369)
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
  hero: HERO,
  sections: READY_SECTIONS,
  phase: PLANNING_PHASE,
};

/** planning '여행 중' 얼굴(TRIP-697) — 여행 중 배지·N일차·이름줄 인사·2섹션(컬렉션+스팟). */
export const HOME_TRAVELING_PROPS: HomeScreenProps = {
  hero: HERO,
  sections: READY_SECTIONS,
  phase: TRAVELING_PHASE,
};

/** postTrip 얼굴 — 종료된 여행(통합 히어로 회고 보기·지난 여행·다음 추천). */
export const HOME_POST_TRIP_PROPS: HomeScreenProps = {
  hero: HERO,
  sections: READY_SECTIONS,
  phase: POST_TRIP_PHASE,
};
