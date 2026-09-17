// a02 "여행지 둘러보기" 매거진 목록 화면의 prop 계약(TRIP-700 · 라이브 Figma 2091:1940).
// MagazineScreen 은 이 타입만 알고 서버·라우팅을 모른다 — 네트워크·라우팅은 이 계약 밖
// (homeStructure D-1 이 features/home 재귀 스캔으로 기계 강제, homeFixtures 선례). 칩 필터는
// 시각 전용 선택 표시일 뿐(서버 매거진 API 없음, 01b Q4) — 카드는 selected 와 무관하게 고정.
//
// ⚠️ 이 파일은 test-designer 가 [테스트] 단계에서 **컴파일용 prop 계약**으로 선작성했다
//    (프로덕션 런타임 0 — 순수 타입 선언, TRIP-695 "컴파일용 타입 선언 선반영" 선례). 런타임
//    (MagazineScreen.tsx·magazineFixtures.ts·MagazinePage.tsx)은 implementer 가 이 계약에 맞춰 채운다.

/** 매서너리 카드 1장 — 사진 위 타이틀·해시태그 태그·하트. height 가 2열 불균등을 결정(픽스처 고정). */
export interface MagazineCard {
  /** '전포 카페 투어' — 카드 타이틀 */
  title: string;
  /** '#감성카페' — 해시태그 한 줄 */
  tag: string;
  /** 카드 고정 높이(좌 200/250/180 · 우 260/190/220) — 매서너리 불균등의 데이터 출처(측정 로직 없음). */
  height: number;
  /** 카드 배경 사진 URI. 실사진 미소싱이라 현재 null(토큰 tint), jest·웹에선 null. */
  imageUrl?: string | null;
}

/** 에디토리얼 카드 — 좌상단 알약(eyebrow) + 대형 타이틀·서브 + 하단 칩 2. */
export interface MagazineEditorial {
  /** '이 주의 여행 이야기' — 좌상단 핑크 알약 라벨 */
  eyebrow: string;
  /** '골목마다 색이 다른 마을' — 26px 흰 타이틀 */
  title: string;
  /** '감천문화마을에서 반나절, 사진만 담아도 하루가 채워져요' — 흰 서브 */
  subtitle: string;
  /** ['당일치기', '포토 명소'] — 하단 반투명 흰 칩 2 */
  chips: readonly string[];
  /** 카드 배경 사진 URI(현재 null tint). */
  imageUrl?: string | null;
}

export interface MagazineScreenProps {
  /** 필터 칩 라벨(정확히 5) — ['전체','당일치기','1박 2일','2박 3일','한 달 살기'] */
  chips: readonly string[];
  /** 선택된 칩 라벨(정확히 1) — 그 칩만 bg-ink 하이라이트, 나머지는 비선택. 기본 '전체'. */
  selected: string;
  /** 에디토리얼 카드 데이터 */
  editorial: MagazineEditorial;
  /** 매서너리 카드(정확히 6, height 가 2열 불균등을 결정) */
  cards: readonly MagazineCard[];
  /** 칩 press → 누른 칩 라벨로 발화(선택 상태는 컨테이너 useState 소유, 화면은 콜백만). */
  onSelectChip?: (chip: string) => void;
  /** 앱바 뒤로가기 press → router.back()(라우트가 진다) */
  onBack?: () => void;
  /** 앱바 돋보기 press → 검색(라우트가 진다) */
  onSearch?: () => void;
  /** 매서너리 카드 press → 누른 카드로 발화 */
  onPressCard?: (card: MagazineCard) => void;
}
