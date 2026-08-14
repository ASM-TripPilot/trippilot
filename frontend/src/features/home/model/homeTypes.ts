// 홈 "발견·영감 피드" 프레젠테이션 화면의 prop 계약(TRIP-316 · 라이브 Figma 2091:1357).
// HomeScreen은 이 타입만 알고 서버·네비게이션을 모른다 — 네트워크·라우팅은 이 계약 밖
// (repo-trap: 홈 전용 서버 API 없음). 구 세대 "여행 상태 대시보드" 계약(trip·nextPlan·
// resume·taste)은 신 프레임에 대응 요소가 없어 전부 폐기됐다.

/** 섹션1 "요즘 사람들이 담는 곳" 카드 1장 — 사진 위 badge pill·타이틀·지역. */
export interface HomeCollectionCard {
  /** '감천문화마을' */
  title: string;
  /** '부산 사하구' — 핀 아이콘 옆 지역명 */
  region: string;
  /** '당일치기'(discovery) · '부산'(collecting 지역 badge) — 좌상단 pill. 얼굴별 의미가 갈린다(TRIP-317 가정 D). */
  badge: string;
  /** '7월 30일 담음' — collecting 변형의 저장일 메타(옵셔널, discovery엔 없음, TRIP-317). */
  savedAtLabel?: string;
}

/** 섹션2 "지금 뜨는 장소" 카드 1장 — 사진 위 타이틀·해시태그. */
export interface HomeSpotCard {
  /** '전포 카페거리' */
  title: string;
  /** '#감성카페' — 해시태그 한 줄 */
  tag: string;
}

/** 섹션3 "여행자 일정" 카드 1장 — 사진 + 타이틀·박수 라벨. */
export interface HomeItineraryCard {
  /** '부산 미식 3일 코스' */
  title: string;
  /** '2박 3일' — 'N박 M일' 표기(소요시간 아님, INV-3) */
  nights: string;
}

/** 상단 영감 카드(magazineHero) — 상태와 무관한 고정 블록(3상태 모두 렌더). */
export interface HomeMagazineHero {
  /** '오늘의 여행 영감' — eyebrow pill 라벨 */
  eyebrow: string;
  /** '부산 · 광안리의 밤' — 28px 흰 타이틀 */
  title: string;
  /** '다리 위로 번지는 불빛, 상상만으로 설레는 야경' */
  subtitle: string;
  /** ['당일치기로 충분', '야경 명소'] — 반투명 흰 메타칩 */
  chips: readonly string[];
}

/**
 * 판별 유니온(discriminated union) — kind 값에 따라 나머지 필드 구성이 달라진다.
 * 3섹션(컬렉션·스팟·일정)을 한 덩어리로 묶어 "부분 실패 시 전 섹션 동시 empty/loading"을
 * 표현한다. 섹션별 독립 실패는 이 union으로는 표현 불가 — 상태 5종 티켓에서 필요 시 확장.
 */
export type HomeSections =
  | {
      kind: 'ready';
      collections: readonly HomeCollectionCard[];
      spots: readonly HomeSpotCard[];
      itineraries: readonly HomeItineraryCard[];
    }
  | { kind: 'empty' }
  | { kind: 'loading' };

/**
 * ── TRIP-317 여행 단계 phase 계약(컴파일용 타입 선언 — 런타임 로직 0) ──────────────
 * 316 discovery(발견·영감 피드) 위에 단계 얼굴 4종을 additive로 얹는다. 화면은 `phase.kind`로
 * 스위치만 하고 여행 데이터를 뜯어 단계를 스스로 도출하지 않는다(TRIP-206 S-6). `phase` 미전달/
 * `discovery` → 316 얼굴 폴백. 각 payload는 브리프 §3 델타의 단계별 데이터만 담는다.
 * INV-3: 어떤 payload에도 소요시간 필드 없음 — 시각(`09:30`)·거리(`950m`)만.
 */

/** planning·upcoming 공용 여행 히어로 카드(tripHero, 브리프 §3-C). */
export interface TripHeroData {
  /** '계획 중'(planning) · '출발 전'(upcoming) — 좌상단 흰 pill */
  badge: string;
  /** 'D-21' / 'D-3' — 우상단 대형 D-day */
  dday: string;
  /** '일정 이어서 짜기'(planning) · '오늘 일정 보기'(upcoming) — primary CTA(no-op) */
  ctaLabel: string;
  /** '부산 여행' — 여행명 타이틀 */
  title: string;
  /** '6월 10일 – 6월 13일 · 3박 4일 · 2명' — 기간·박수·인원(소요시간 아님, INV-3) */
  meta: string;
}

/** upcoming dashRow 스탯 타일 1개. */
export interface HomeStatTile {
  /** '일정' / '숙소' */
  label: string;
  /** '9곳 완성' / '3/3' */
  value: string;
  /** '3박 등록' — 보조 캡션(옵셔널) */
  caption?: string;
}

/** upcoming '가장 먼저 갈 곳' 카드 — 시각·거리만(INV-3, 소요시간 없음). */
export interface NextStop {
  /** '1' — 순번 badge */
  order: string;
  /** '09:30 · 활동' — 방문 시각(INV-2 솔버검증값 표시 허용, 소요시간 아님) */
  time: string;
  /** '광안리 해변' — 장소명 */
  title: string;
  /** '24시간 개방 · 숙소서 950m' — 영업시간 + 거리(소요시간 아님, INV-3) */
  placeMeta: string;
}

/** upcoming '지금 내 주변' 미니맵 카드. */
export interface NearbyCard {
  /** '지금 내 주변 살펴보기' */
  title: string;
  /** '부산 해운대구 · 걸어서 갈 만한 곳' */
  subtitle: string;
}

/** postTrip '회고 보기' 미니맵 카드 — 방문 수·거리·사진 수만(INV-3). */
export interface RecapCard {
  /** '부산 여행 회고 보기' */
  title: string;
  /** '4곳 방문 · 12km · 사진 6장 · 6.10–6.13' — 거리(km)만, 소요시간 없음 */
  meta: string;
}

/** upcoming·postTrip '지난 여행' 카드 1장. */
export interface PastTrip {
  /** '경주 여행 2026.04 · 2박' */
  title: string;
}

/** planning 브릿지행 / postTrip 공유행 — 같은 softNote 슬롯, 카피·버튼만 다름. */
export interface HomeSoftNote {
  /** '담은 곳 3곳이 아직 일정에 없어요' / '공유 카드로 남기기' */
  title: string;
  /** '남은 자리에 넣어볼까요' / '사진·동선을 카드 한 장으로' */
  subtitle: string;
  /** '일정에 추가' / '공유 카드 만들기' — no-op CTA */
  ctaLabel: string;
}

/**
 * 여행 단계 판별 유니온 — kind로 얼굴을 가른다. discovery(폴백)는 hero·sections(316 기존
 * 계약)로 그리므로 payload 없음. 나머지 4종만 단계별 데이터를 담는다.
 */
export type HomePhase =
  | { kind: 'discovery' }
  | {
      kind: 'collecting';
      greetTitle: string;
      greetSubtitle: string;
      sectionTitle: string;
      savedChipLabel: string;
      collections: readonly HomeCollectionCard[];
    }
  | {
      kind: 'planning';
      greetTitle: string;
      trip: TripHeroData;
      bridge: HomeSoftNote;
    }
  | {
      kind: 'upcoming';
      greetName: string;
      greetTitle: string;
      trip: TripHeroData;
      stats: readonly HomeStatTile[];
      nextStop: NextStop;
      nearby: NearbyCard;
      pastTrips: readonly PastTrip[];
    }
  | {
      kind: 'postTrip';
      greetTitle: string;
      recap: RecapCard;
      share: HomeSoftNote;
      recommendationTitle: string;
      recommendations: readonly HomeCollectionCard[];
      pastTrips: readonly PastTrip[];
    };

export interface HomeScreenProps {
  /** 상단 영감 카드 — 상태 무관 고정 블록(discovery) */
  hero: HomeMagazineHero;
  /** 3섹션 데이터셋(판별 유니온) */
  sections: HomeSections;
  /** 여행 단계 판별값(TRIP-317) — 미전달/discovery면 316 얼굴, 그 외 kind면 단계 얼굴 */
  phase?: HomePhase;
}
