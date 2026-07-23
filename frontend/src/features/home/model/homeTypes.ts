// 홈 대시보드 프레젠테이션 화면의 prop 계약(TRIP-170 · 02a §4-B). HomeScreen은 이 타입만
// 알고 서버·네비게이션을 모른다 — 네트워크·라우팅은 이 계약 밖(브리프 §6-1).

/** 여행 카드(hero) 사진 위 오버레이 — Figma empty·loading 프레임엔 없다(§0 확정) → null 허용. */
export interface HomeTripHero {
  overlay: { dday: string; nights: string; title: string } | null;
  /** '6.10~6.12 · 숙소 1곳 · 3명' */
  meta: string;
  /** 0~1 (default 픽스처 98/326 ≈ 0.3) */
  progressRatio: number;
}

/** 다음 일정 카드 — default 상태에만 존재. summary는 거리만 표기한다(INV-3). */
export interface HomeNextPlan {
  /** '6.11 (수)' */
  dateLabel: string;
  /** '09:00 · 감천문화마을 · 도보 850m' — 거리만, INV-3 */
  summary: string;
  /** '여행 준비' */
  prepLabel: string;
  /** '60%' */
  prepPercent: string;
  /** 0~1 */
  prepRatio: number;
}

/** 이어서 하기 카드 — default 상태에만 존재. */
export interface HomeResume {
  title: string;
  meta: string;
}

/** 인기 장소 카드 1장. hot=true면 '급상승' 배지(stat 무시), 아니면 stat 문구를 보여준다. */
export interface HomePopularPlace {
  name: string;
  stat: string | null;
  hot: boolean;
}

/** 취향 블록 — default 상태에만 존재. */
export interface HomeTasteBlock {
  chips: readonly string[];
  featured: { name: string; description: string; badge: string };
}

/** 커뮤니티 공개 기록 카드 1장. */
export interface HomeRecordCard {
  author: string;
  /** 아바타 원 안 글자 — Figma에서 author 전체 이름과 다른 별도 표시값(브리프 §authorRow). */
  authorInitial: string;
  authorTaste: string;
  title: string;
  chips: readonly string[];
  meta: string;
  likes: string;
  comments: string;
}

/**
 * 판별 유니온(discriminated union) — kind 값에 따라 나머지 필드 구성이 달라진다.
 * '인기·커뮤니티 자리'가 실카드(ready)/유도문구(empty)/스켈레톤(loading) 중
 * 하나의 모습만 가질 수 있음을 타입으로 강제한다.
 */
export type HomeSections =
  | {
      kind: 'ready';
      popular: readonly HomePopularPlace[];
      record: HomeRecordCard;
    }
  | { kind: 'empty' }
  | { kind: 'loading' };

export interface HomeScreenProps {
  /** null → no-trip 대시 카드(첫 사용자) */
  trip: HomeTripHero | null;
  /** default에만 값 — trip이 있어도 empty·loading은 null(§0 확정) */
  nextPlan: HomeNextPlan | null;
  resume: HomeResume | null;
  taste: HomeTasteBlock | null;
  sections: HomeSections;
}
