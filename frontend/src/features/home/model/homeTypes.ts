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
  /** 카드 배경 사진 URI(TRIP-694). `resolveAssetSource(...).uri`로 푼 문자열, jest·웹에선 null(사진 자리 토큰 tint). */
  imageUrl?: string | null;
}

/** 섹션2 "지금 뜨는 장소" 카드 1장 — 사진 위 타이틀·해시태그. */
export interface HomeSpotCard {
  /** '전포 카페거리' */
  title: string;
  /** '#감성카페' — 해시태그 한 줄 */
  tag: string;
  /** 카드 배경 사진 URI(TRIP-694). jest·웹에선 null(사진 자리 토큰 tint). */
  imageUrl?: string | null;
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
  /** 히어로 배경 사진 URI(TRIP-694). jest·웹에선 null(사진 자리 토큰 tint). */
  imageUrl?: string | null;
}

/**
 * 판별 유니온(discriminated union) — kind 값에 따라 나머지 필드 구성이 달라진다.
 * 3섹션(컬렉션·스팟·일정)을 한 덩어리로 묶어 "부분 실패 시 전 섹션 동시 loading"을
 * 표현한다. 섹션별 독립 실패는 이 union으로는 표현 불가 — 상태 5종 티켓에서 필요 시 확장.
 */
export type HomeSections =
  | {
      kind: 'ready';
      collections: readonly HomeCollectionCard[];
      spots: readonly HomeSpotCard[];
      itineraries: readonly HomeItineraryCard[];
    }
  | { kind: 'loading' };

/**
 * ── TRIP-317 여행 단계 phase 계약(컴파일용 타입 선언 — 런타임 로직 0) ──────────────
 * 316 discovery(발견·영감 피드) 위에 단계 얼굴 2종(planning·postTrip; collecting·upcoming은
 * TRIP-701 제거)을 additive로 얹는다. 화면은 `phase.kind`로
 * 스위치만 하고 여행 데이터를 뜯어 단계를 스스로 도출하지 않는다(TRIP-206 S-6). `phase` 미전달/
 * `discovery` → 316 얼굴 폴백. 각 payload는 브리프 §3 델타의 단계별 데이터만 담는다.
 * INV-3: 어떤 payload에도 소요시간 필드 없음 — 시각(`09:30`)·거리(`950m`)만.
 */

/** planning·postTrip 통합 히어로 카드(tripHero, TRIP-696 풀블리드 재작성). */
export interface TripHeroData {
  /** '계획 중'(primary 톤) / '여행 완료'(§698 success 톤) — 배지 주 텍스트 */
  badge: string;
  /**
   * '· D-21'(계획 중) / '· N 일차'(§697 여행 중) — 두 톤 배지의 보조(ink 톤) 텍스트.
   * TRIP-696에서 구 우상단 대형 D-day(`dday`)를 배지 보조로 흡수하며 교체됐다.
   * TRIP-698: 여행 완료 얼굴은 단일 배지("여행 완료"만)라 이 값이 없다(옵셔널 additive) —
   * IntegratedTripHero 가 badgeSub 있을 때만 둘째 <Text> 리프를 그린다. 계획/여행 중은 항상 넘김.
   */
  badgeSub?: string;
  /**
   * 배지 주 텍스트 톤(TRIP-698). 미지정/'primary' → text-primary(계획·여행 중) · 'success' →
   * text-success(초록, 여행 완료). Figma 라이브 배지 색 바인딩이 얼굴마다 달라 파라미터화했다.
   */
  badgeTone?: 'primary' | 'success';
  /** '일정 이어서 짜기 ›'(꺾쇠 포함) — 하단 primary CTA 라벨 */
  ctaLabel: string;
  /** '부산 여행' — 여행명 타이틀 */
  title: string;
  /** '6월 10일 – 6월 13일 · 3박 4일 · 2명' — 기간·박수·인원(소요시간 아님, INV-3) */
  meta: string;
}

/** postTrip '지난 여행' 가로 사진 카드 1장(TRIP-698). */
export interface PastTrip {
  /** '경주 여행' — 여행명(날짜는 dateLabel 로 분리) */
  title: string;
  /** '2026.04 · 2박' — 카드 둘째줄 날짜·박수 라벨 */
  dateLabel: string;
  /** 카드 배경 사진 URI. 실사진 미소싱이라 현재 null(토큰 tint), 실기 썸네일은 후속(01b Q2). */
  imageUrl?: string | null;
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
 * 계약)로 그리므로 payload 없음. 나머지 2종만 단계별 데이터를 담는다.
 */
export type HomePhase =
  | { kind: 'discovery' }
  | {
      kind: 'planning';
      greetTitle: string;
      /**
       * TRIP-696 인사 2줄 서브카피('일정을 이어서 짜볼까요'). 옵셔널 additive — 동결 리터럴·
       * 테스트가 phase 를 직접 만들 때 이 값이 없어도 컴파일돼야 한다(`dominantTripId?` 선례).
       */
      greetSubtitle?: string;
      /**
       * TRIP-696 지역 컬렉션 헤더('${region}에서 담을 만한 곳'). 미지정이면 컬렉션 헤더가
       * 기본 '요즘 사람들이 담는 곳'을 그린다(옵셔널 additive).
       */
      collectionsTitle?: string;
      /**
       * TRIP-697 여행 중 인사 이름줄('태현님,'). 인사는 이름↑→타이틀↓ 순서로 2줄이 된다.
       * 옵셔널 additive — resolveHomePhase 는 라이브 이름 소스가 없어 이 값을 채우지 않는다
       * (픽스처 HOME_TRAVELING_PROPS 전용, 라이브 여행 중은 이름줄 없이 타이틀만 — 브리프 맹점③).
       * 동결 planning 리터럴·계획 중 얼굴은 이 필드 없이 컴파일돼야 한다(`dominantTripId?` 선례).
       */
      greetName?: string;
      /**
       * TRIP-697 여행 중 2섹션 판별(컬렉션 + '지금 뜨는 장소'). resolveHomePhase 가 isTraveling
       * 일 때 true 로 채우고, PlanningBody 가 true 면 SpotsSection 도 렌더한다(미설정/false → 1섹션).
       * 옵셔널 additive — 계획 중·동결 리터럴은 이 필드 없이 컴파일된다(showSpots 미설정 = 1섹션).
       */
      showSpots?: boolean;
      /**
       * 지배 여행 tripId — 홈 카드 CTA 가 이 여행의 일정 화면으로 라우팅한다(TRIP-401). 서버
       * 스키마 미참조 로컬 필드. 옵셔널인 이유: 프리뷰 픽스처·테스트가 phase 를 직접 만들 때
       * 이 값을 안 넣어도 컴파일돼야 한다(라우팅 없는 정적 렌더). 라우트는 존재할 때만 CTA 를 건다.
       */
      dominantTripId?: string;
      trip: TripHeroData;
      bridge: HomeSoftNote;
    }
  | {
      kind: 'postTrip';
      greetTitle: string;
      /** TRIP-698 인사 2줄 서브카피('기록을 정리하고 나눠볼까요'). */
      greetSubtitle: string;
      /** TRIP-698 통합 히어로 재사용 — 배지 "여행 완료"(success)·CTA "회고 보기 ›". */
      trip: TripHeroData;
      recommendationTitle: string;
      recommendations: readonly HomeCollectionCard[];
      pastTrips: readonly PastTrip[];
    };

export interface HomeScreenProps {
  /**
   * 상단 영감 카드 — 상태 무관 고정 블록(discovery). TRIP-694로 단일→5장 배열(페이징 캐러셀).
   * discovery는 배열 전체를 캐러셀 5페이지로, 단계 얼굴(collecting·planning)은 `hero[0]`만 쓴다.
   */
  hero: readonly HomeMagazineHero[];
  /** 3섹션 데이터셋(판별 유니온) */
  sections: HomeSections;
  /** 여행 단계 판별값(TRIP-317) — 미전달/discovery면 316 얼굴, 그 외 kind면 단계 얼굴 */
  phase?: HomePhase;
  /**
   * CTA 배선 콜백(TRIP-370, 전부 옵셔널) — 화면은 라우터를 모른 채 넘겨받은 함수만 발화한다
   * (라우팅은 `(tabs)/index.tsx` seam 이 진다, homeStructure D-1). 옵셔널이라 콜백을 안 넘기는
   * 호출부(`_dev/preview.tsx` 등)도 깨지지 않는다.
   */
  /** FAB "여행 만들기" press → 여행 생성 1/2 진입 */
  onPressCreateTrip?: () => void;
  /** 온램프 "담은 곳" press·saved-menu 담은 장소 미니 FAB → 담은 장소 화면(d02) */
  onPressSavedPlaces?: () => void;
  /** saved-menu 저장한 숙소 미니 FAB → 저장한 숙소 화면(e04, TRIP-494) */
  onPressSavedStays?: () => void;
  /**
   * saved-menu 담은 장소·저장 숙소 개수 배지(TRIP-695, 전부 옵셔널·additive) — 열림+count≥1
   * 일 때만 미니 FAB 우상단에 핑크 배지를 그린다(0/미지정/음수→미표시, BR-U1-06/09). 값은
   * 라우트가 `savedPoiIds.length`·`useSavedStays().savedCount` 에서 뽑아 주입한다.
   */
  savedPlacesCount?: number;
  savedStaysCount?: number;
  /** 담은 곳 saved-menu 열림 상태(TRIP-494) — 라우트 소유(화면 useState 0건). 미지정=닫힘 */
  savedMenuOpen?: boolean;
  /** 담은 곳 saved-menu 하트/닫기 토글 press → 라우트가 open 을 뒤집는다 */
  onToggleSavedMenu?: () => void;
  /** "지금 뜨는 장소" 더 보기 press → 장소 탐색 */
  onPressSpotsMore?: () => void;
  /** planning 여행 카드 주 CTA press → 그 여행의 일정 화면(목적지는 라우트가 계산, TRIP-401) */
  onPressTripHeroCta?: () => void;
  /** 검색바 press → 통합 검색(d05, `/explore/search`, TRIP-453) */
  onPressSearch?: () => void;
  /**
   * discovery 캐러셀 page0(매거진 히어로) press → a02 매거진 목록(`/magazine`, TRIP-700). 옵셔널
   * additive(test-designer 컴파일용 타입 선언 선반영, TRIP-695 선례) — 콜백 미주입 호출부
   * (`_dev/preview.tsx`·버튼-집합 테스트)도 깨지지 않는다. 라우팅은 `(tabs)/index.tsx` 가 진다.
   */
  onPressMagazine?: () => void;
  /** 인사 헤더 종 press → 알림함(TRIP-939). 라우팅은 `(tabs)/index.tsx` 가 진다. */
  onPressBell?: () => void;
}
