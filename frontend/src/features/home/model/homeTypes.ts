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
  /** '당일치기' — 좌상단 primary pill */
  badge: string;
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

export interface HomeScreenProps {
  /** 상단 영감 카드 — 상태 무관 고정 블록 */
  hero: HomeMagazineHero;
  /** 3섹션 데이터셋(판별 유니온) */
  sections: HomeSections;
}
