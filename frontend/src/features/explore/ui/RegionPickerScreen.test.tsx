import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';

import { RegionPickerScreen } from './RegionPickerScreen';
import type {
  RegionPickerScreenProps,
  RegionPurpose,
} from './RegionPickerScreen';

/**
 * TRIP-597 · d1b/e00 지역 선택 — 평면 그리드 → 시/도→구/군 2단 드릴다운(표면 A 확정).
 *
 * 무엇이 바뀌었나(현행 대비):
 *  · 빈 검색어 초기 뷰가 **선택 카드 평면 그리드**가 아니라 **시/도 행 목록(1단)**이다. 인천광역시와
 *    미추홀구가 한 평면에 함께 뜨지 않는다(AC-1) — 구/군은 시/도 안으로 접힌다.
 *  · 시/도 행(`explore-region-sido-{code}`)을 누르면 **2단 상세**로 들어가고, 최상단 '전체' 행 +
 *    구/군 카드가 보인다. 상세 뒤로가기(`explore-region-drilldown-back`)로 1단에 복귀한다(AC-2).
 *  · '전체' 행 = 그 시/도의 SIDO Region(`explore-region-{code}`). selectable=true 면 선택 카드
 *    ('인천 전체' 선택 가능, AC-3), false 면 선택 불가 묶음 행(AC-4).
 *  · 검색어를 넣으면 드릴다운을 **우회**하고 시도·구군 교차 평면 결과를 그린다(AC-6).
 *
 * 3동작 뼈대: 준비=props 조립 → 실행=render(+press/changeText/rerender) → 단언=화면에 보이는 것.
 * ★ testID·press 배선만 잠근다(구조). 드릴다운 레이아웃·'전체' 행 비주얼은 Figma 미설계라 6-b 실기로
 *   캘리브레이션(픽셀 대조 단계 부재, 02a 맹점③).
 * ★ "준비 중" 같은 카드 텍스트는 **정규식**으로 단언한다 — `toHaveTextContent('준비 중')` 문자열은
 *   카드 집계 텍스트("미추홀구준비 중")에서 완전 일치라 실패한다(02a §5, 트립445 §5-① 실증).
 *
 * 한 파일로 합친 기록(TRIP-1147): 옛 `RegionPickerScreen.search.test.tsx`(검색 결과 표면, TRIP-1023 칸 B
 * #007)를 아래 `검색 결과 표면` describe 로 옮겼다. 공통 픽스처(인천·미추홀·강원·춘천·홍천)는 두 파일
 * 값이 같아 하나로 쓰고, 기본 카탈로그(`props`)는 관점마다 달라 갈랐다. 소요시간 글자 0건 테스트(INV-3)
 * 둘은 README 판정 4 하위 규칙(지역 카탈로그엔 시간·거리 재료가 없다)으로 지웠다.
 */

/** 서버 `Region` 표본 도우미 — required 6필드를 채운다(계약 그대로). */
function region(
  over: Partial<Region> & Pick<Region, 'regionCode' | 'name'>
): Region {
  return {
    sidoName: over.sidoName ?? '',
    level: over.level ?? RegionLevel.SIGUNGU,
    selectable: over.selectable ?? true,
    poiCount: over.poiCount ?? 3,
    ...over,
  };
}

// 공통 픽스처(법정동 앞자리 현실값). 이름에 '전체' 부분문자열 없음(getByText(/전체/) 오검출 방지).
const INCHEON = region({
  regionCode: '28',
  name: '인천광역시',
  level: RegionLevel.SIDO,
  sidoName: '인천광역시',
  selectable: true,
  poiCount: 50,
});
const MICHUHOL = region({
  regionCode: '28177',
  name: '미추홀구',
  level: RegionLevel.SIGUNGU,
  sidoName: '인천광역시',
  poiCount: 8,
});
const YEONSU = region({
  regionCode: '28185',
  name: '연수구',
  level: RegionLevel.SIGUNGU,
  sidoName: '인천광역시',
  poiCount: 5,
});
const GANGWON = region({
  regionCode: '51',
  name: '강원특별자치도',
  level: RegionLevel.SIDO,
  sidoName: '강원특별자치도',
  selectable: false,
  poiCount: 30,
});
const CHUNCHEON = region({
  regionCode: '51110',
  name: '춘천시',
  level: RegionLevel.SIGUNGU,
  sidoName: '강원특별자치도',
  poiCount: 12,
});
const HONGCHEON = region({
  regionCode: '51720',
  name: '홍천군',
  level: RegionLevel.SIGUNGU,
  sidoName: '강원특별자치도',
  poiCount: 0, // 후보풀 빔 → "준비 중"
});

/** 시도·시군구 혼재 카탈로그(1단이 인천·강원 두 시/도로 접혀야 한다). */
const CATALOG: Region[] = [
  INCHEON,
  MICHUHOL,
  YEONSU,
  GANGWON,
  CHUNCHEON,
  HONGCHEON,
];

function props(
  over: Partial<RegionPickerScreenProps> = {}
): RegionPickerScreenProps {
  return {
    purpose: 'trip',
    query: '',
    regions: CATALOG,
    isLoading: false,
    isError: false,
    onChangeQuery: jest.fn(),
    onSelectRegion: jest.fn(),
    onRetry: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

describe('BR-U1-07 · 목적 파라미터 분기 — 같은 컴포넌트, 카피만 다르다 (보존)', () => {
  it("purpose='stay'는 숙소 카피를 쓴다 (Figma e00)", () => {
    render(<RegionPickerScreen {...props({ purpose: 'stay' })} />);

    expect(screen.getByText('지역 선택')).toBeTruthy();
    expect(screen.getByText('어디서 묵을까요?')).toBeTruthy();
    expect(screen.getByText('인기 지역')).toBeTruthy(); // TRIP-650 인기 스트립 헤더(stay)
  });

  it("purpose='trip'은 여행지 카피를 쓴다 (Figma d1b)", () => {
    render(<RegionPickerScreen {...props({ purpose: 'trip' })} />);

    expect(screen.getByText('여행지 선택')).toBeTruthy();
    expect(screen.getByText('어디로 떠날까요?')).toBeTruthy();
    expect(screen.getByText('인기 여행지')).toBeTruthy();
  });
});

describe('AC-1 · 평면 해소 — 빈 검색어는 시/도 행만, 구/군은 접힌다', () => {
  it('시/도 행만 보이고 인천광역시·미추홀구가 한 평면에 함께 나타나지 않는다', () => {
    // 준비: 인천(시도)+구/군들+강원(시도)+구/군들. 실행: 빈 검색어 초기 렌더.
    render(<RegionPickerScreen {...props({ query: '' })} />);

    // 시/도 행이 보인다(드릴다운 어포던스 — 선택 카드와 다른 testID).
    expect(screen.getByTestId('explore-region-sido-28')).toBeTruthy();
    expect(screen.getByTestId('explore-region-sido-51')).toBeTruthy();
    // 인천광역시는 인기 스트립 카드와 시/도 행 두 곳에 뜰 수 있다(TRIP-650 featured+전체 패턴) — ≥1.
    expect(screen.getAllByText('인천광역시').length).toBeGreaterThanOrEqual(1);

    // 구/군은 접혀 있다 — 미추홀구는 1단에 없다(★ AC-1 핵심).
    expect(screen.queryByTestId('explore-region-28177')).toBeNull();
    expect(screen.queryByText('미추홀구')).toBeNull();

    // 1단의 인천은 '시/도 행'일 뿐 '선택 카드'가 아니다 — 선택 카드 testID 는 상세에서만 뜬다(★4).
    expect(screen.queryByTestId('explore-region-28')).toBeNull();
  });
});

describe('AC-1b · 인기 여행지 가로 스트립 (TRIP-650)', () => {
  it('인기 스트립이 시/도 카드를 그리고, 카드 press → 그 시/도 상세로 드릴인한다', () => {
    render(<RegionPickerScreen {...props({ query: '' })} />);

    // 인기 스트립 + 시/도 카드(구/군 아님 — 드릴다운 불변식 유지). 인기 카드는 -popular- testID 라
    // 1단 시/도 행/선택 카드와 구분된다.
    expect(
      screen.getByTestId('explore-region-popular-strip')
    ).toBeOnTheScreen();
    const card = screen.getByTestId('explore-region-popular-28'); // 인천광역시
    expect(card).toBeOnTheScreen();

    // press → 그 시/도로 드릴인(하단 SidoRow 와 동일). 드릴인 전엔 접혀 있던 구/군(미추홀구)이 상세에 뜬다.
    expect(screen.queryByText('미추홀구')).toBeNull();
    fireEvent.press(card);
    expect(screen.getByText('미추홀구')).toBeOnTheScreen();
  });

  it('TRIP-707 — 첫 카드에 인기 배지가 붙고, 태그라인(로컬 카탈로그)이 뜬다', () => {
    render(<RegionPickerScreen {...props({ query: '' })} />);

    // 인기 배지는 정확히 첫 카드(인천/28)에만. 총 1개 + 그 1개가 첫 카드 서브트리 안이라야
    // "index===0"가 실제로 잠긴다(code-critic 경고-1: 총 개수만 보면 배지가 둘째 카드로 옮겨가도
    // green — 첫 카드 소속까지 봐야 한다).
    const firstCard = screen.getByTestId('explore-region-popular-28');
    const badge = within(firstCard).getByTestId('explore-region-popular-badge');
    expect(within(badge).getByText('인기')).toBeOnTheScreen();
    expect(screen.getAllByTestId('explore-region-popular-badge')).toHaveLength(
      1
    );

    // 인천(28)·강원(51) 태그라인이 로컬 카탈로그(POPULAR_TAGLINE)에서 온다(이 CATALOG 의 두 시/도).
    expect(screen.getByText('항구 · 근대')).toBeOnTheScreen();
    expect(screen.getByText('산 · 휴식')).toBeOnTheScreen();
  });
});

describe('AC-2 · 드릴다운 진입/복귀 + 상세 뒤로 ≠ 앱바 뒤로', () => {
  it('시/도 행을 누르면 그 시/도의 구/군 목록 + 전체 행 + 상세 뒤로가 보인다', () => {
    render(<RegionPickerScreen {...props({ query: '' })} />);

    // 실행: 인천 시/도 행을 누른다.
    fireEvent.press(screen.getByTestId('explore-region-sido-28'));

    // 상세: '전체' 행(SIDO 선택 카드) + 구/군 카드들 + 전체 어포던스 + 상세 뒤로가기.
    expect(screen.getByTestId('explore-region-28')).toBeTruthy(); // 인천 전체 행
    expect(screen.getByTestId('explore-region-28177')).toBeTruthy(); // 미추홀구
    expect(screen.getByTestId('explore-region-28185')).toBeTruthy(); // 연수구
    expect(screen.getAllByText(/전체/).length).toBeGreaterThan(0); // '전체' 어포던스
    expect(screen.getByTestId('explore-region-drilldown-back')).toBeTruthy();

    // 다른 시/도(강원)의 시/도 행은 상세에 없다 — 지금은 인천 상세 안이다.
    expect(screen.queryByTestId('explore-region-sido-51')).toBeNull();
  });

  it('상세 뒤로가기는 1단으로 복귀하고, 앱바 뒤로(onBack)를 부르지 않는다 (★3)', () => {
    const onBack = jest.fn();
    render(<RegionPickerScreen {...props({ query: '', onBack })} />);

    fireEvent.press(screen.getByTestId('explore-region-sido-28')); // 드릴인
    fireEvent.press(screen.getByTestId('explore-region-drilldown-back')); // 상세 뒤로

    // 1단 복귀 — 시/도 행 다시, 구/군은 다시 접힘.
    expect(screen.getByTestId('explore-region-sido-28')).toBeTruthy();
    expect(screen.queryByTestId('explore-region-28177')).toBeNull();
    // ★3: 상세 뒤로는 화면 내 상태 복귀지 라우터 이탈이 아니다.
    expect(onBack).not.toHaveBeenCalled();
  });

  it('앱바 뒤로(explore-region-back)는 상세에서도 라우터 back(onBack)을 부른다 (★3 분리 짝)', () => {
    const onBack = jest.fn();
    render(<RegionPickerScreen {...props({ query: '', onBack })} />);

    fireEvent.press(screen.getByTestId('explore-region-sido-28')); // 드릴인
    fireEvent.press(screen.getByTestId('explore-region-back')); // 앱바 뒤로

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("AC-3 · '전체' 행 선택 (selectable=true 시/도)", () => {
  it("selectable=true 시/도의 '전체' 행을 누르면 그 SIDO Region 을 그대로 올려보낸다", () => {
    const onSelectRegion = jest.fn();
    render(
      <RegionPickerScreen
        {...props({ regions: [INCHEON, MICHUHOL, YEONSU], onSelectRegion })}
      />
    );

    fireEvent.press(screen.getByTestId('explore-region-sido-28')); // 드릴인
    fireEvent.press(screen.getByTestId('explore-region-28')); // '인천 전체' 행

    // 인천 전체 선택 = SIDO Region 객체 그대로(재조립 금지, 객체 동일성).
    expect(onSelectRegion).toHaveBeenCalledWith(INCHEON);
  });
});

describe("AC-4 · '전체' 행 묶음 (selectable=false 시/도)", () => {
  it("selectable=false 시/도의 '전체' 행은 보이되 눌러도 선택되지 않는다", () => {
    const onSelectRegion = jest.fn();
    render(
      <RegionPickerScreen
        {...props({ regions: [GANGWON, CHUNCHEON], onSelectRegion })}
      />
    );

    fireEvent.press(screen.getByTestId('explore-region-sido-51')); // 강원 드릴인

    // '전체' 자리(강원 SIDO)는 보인다.
    expect(screen.getByTestId('explore-region-51')).toBeTruthy();

    // 실제 press 를 발화하고 미호출을 확인한다(★8 — 비-Pressable이라도 3단으로).
    fireEvent.press(screen.getByTestId('explore-region-51'));
    expect(onSelectRegion).not.toHaveBeenCalled();

    // 긍정 짝 — 그 안 selectable=true 구/군은 정상 선택된다(press 배선이 죽지 않았음을 증명).
    fireEvent.press(screen.getByTestId('explore-region-51110'));
    expect(onSelectRegion).toHaveBeenCalledWith(CHUNCHEON);
  });
});

describe('AC-5 · 후보 없는 지역 표기 (poiCount=0 구/군, INV-1 · TRIP-935 AC-8)', () => {
  it('🔴 poiCount=0 구/군은 "추천 장소 없음"을 달고("준비 중" 아님), 눌러도 선택되지 않는다', () => {
    const onSelectRegion = jest.fn();
    render(
      <RegionPickerScreen
        {...props({ regions: [GANGWON, CHUNCHEON, HONGCHEON], onSelectRegion })}
      />
    );

    fireEvent.press(screen.getByTestId('explore-region-sido-51')); // 강원 드릴인

    // 홍천군(poi=0): 데이터 상태 표기 "추천 장소 없음"(정규식 — 카드 집계 텍스트라 완전일치는
    // 실패, ★2). TRIP-935: "준비 중"은 심사에서 미완성 기능(2.1)으로 읽혀 문구만 바꿨다.
    const coming = screen.getByTestId('explore-region-51720');
    expect(coming).toHaveTextContent(/추천 장소 없음/);
    expect(coming).not.toHaveTextContent(/준비 중/);

    // 눌러도 선택 안 됨(★8 — 실제 press).
    fireEvent.press(coming);
    expect(onSelectRegion).not.toHaveBeenCalled();

    // 긍정 짝 — poiCount>0 구/군은 선택된다.
    fireEvent.press(screen.getByTestId('explore-region-51110'));
    expect(onSelectRegion).toHaveBeenCalledWith(CHUNCHEON);
  });
});

describe('AC-6 · 검색 우회 + 원본 객체 복원 (TRIP-387 성질 보존)', () => {
  it('검색어가 있으면 드릴다운을 건너뛰고 평면 결과를 그린다 — 시/도 행이 없다', () => {
    // 준비: 페이지가 이미 filterRegions 로 좁힌 결과를 내린다(교차 평면).
    render(
      <RegionPickerScreen
        {...props({ query: '구', regions: [MICHUHOL, YEONSU] })}
      />
    );

    // 평면 카드로 보인다(구/군 카드 직접).
    expect(screen.getByTestId('explore-region-28177')).toBeTruthy();
    expect(screen.getByTestId('explore-region-28185')).toBeTruthy();
    // 검색 모드는 평면이라 드릴다운 어포던스(시/도 행)가 없다.
    expect(screen.queryByTestId('explore-region-sido-28')).toBeNull();
  });

  it('검색 결과 카드를 누르면 좁힌 목록의 실제 Region 객체를 그대로 올려보낸다(원본 복원)', () => {
    const onSelectRegion = jest.fn();
    render(
      <RegionPickerScreen
        {...props({ query: '춘천', regions: [CHUNCHEON], onSelectRegion })}
      />
    );

    fireEvent.press(screen.getByTestId('explore-region-51110'));

    // 재조립한 값이 아니라 props 로 받은 그 객체(원본 카탈로그 파생) 그대로.
    expect(onSelectRegion).toHaveBeenCalledWith(CHUNCHEON);
  });

  it('드릴인한 뒤 검색어를 넣으면 상세가 사라지고 평면 검색 결과가 나온다(상태 혼선 방지, 개념③)', () => {
    const { rerender } = render(
      <RegionPickerScreen {...props({ query: '' })} />
    );

    // 드릴인 — 인천 상세로.
    fireEvent.press(screen.getByTestId('explore-region-sido-28'));
    expect(screen.getByTestId('explore-region-drilldown-back')).toBeTruthy();

    // 검색어 입력(페이지가 query 를 갱신해 다시 내림) — 상세를 우회하고 평면으로.
    rerender(
      <RegionPickerScreen
        {...props({ query: '구', regions: [MICHUHOL, YEONSU] })}
      />
    );

    expect(screen.queryByTestId('explore-region-drilldown-back')).toBeNull();
    expect(screen.getByTestId('explore-region-28177')).toBeTruthy();
    expect(screen.getByTestId('explore-region-28185')).toBeTruthy();
  });
});

describe('조회 실패·로딩 얼굴 — 이월 유지 (INV-4)', () => {
  it('isError면 실패 얼굴을 그리고, "검색 결과가 없어요"로 뭉개지 않는다', () => {
    const onRetry = jest.fn();
    render(
      <RegionPickerScreen {...props({ isError: true, regions: [], onRetry })} />
    );

    expect(screen.getByTestId('explore-region-error')).toBeTruthy();
    expect(screen.queryByText('검색 결과가 없어요')).toBeNull();

    fireEvent.press(screen.getByTestId('explore-region-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('로딩 중은 빈 결과와 다르다 — "검색 결과가 없어요"·실패 얼굴을 안 낸다', () => {
    render(<RegionPickerScreen {...props({ isLoading: true, regions: [] })} />);

    expect(screen.getByTestId('explore-region-loading')).toBeTruthy();
    expect(screen.queryByText('검색 결과가 없어요')).toBeNull();
    expect(screen.queryByTestId('explore-region-error')).toBeNull();
  });
});

describe('검색 · 앱바 — 이월 유지', () => {
  it('입력하면 그대로 올려보낸다 — 필터 판정은 화면 밖에서 한다', () => {
    const onChangeQuery = jest.fn();
    render(<RegionPickerScreen {...props({ onChangeQuery })} />);

    fireEvent.changeText(screen.getByTestId('explore-region-search'), '제주');

    expect(onChangeQuery).toHaveBeenCalledWith('제주');
  });

  it('빈 검색어 1단에서 뒤로가기를 누르면 라우터 back(onBack)이 불린다', () => {
    const onBack = jest.fn();
    render(<RegionPickerScreen {...props({ query: '', onBack })} />);

    fireEvent.press(screen.getByTestId('explore-region-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("AC · '내 주변'이 화면 어디에도 없다 (이월 유지)", () => {
  it("purpose='stay'에서도 '내 주변' 진입과 텍스트가 없다", () => {
    render(<RegionPickerScreen {...props({ purpose: 'stay' })} />);

    expect(screen.queryByTestId('explore-region-nearby')).toBeNull();
    expect(screen.queryByText('내 주변')).toBeNull();
  });
});

describe('🔴 TRIP-991 · 앱바 뒤로 접근성 (AC-1 role · AC-2 라벨)', () => {
  it('앱바 뒤로는 VoiceOver 에 "뒤로" 버튼으로 읽히고, 누르면 onBack 이 1회 불린다', () => {
    const onBack = jest.fn();
    render(<RegionPickerScreen {...props({ onBack })} />);

    // 역할(button)·이름("뒤로")으로 찾는다 — 둘 중 하나라도 없으면 여기서 실패한다.
    const back = screen.getByRole('button', { name: '뒤로' });
    expect(back).toHaveProp('testID', 'explore-region-back');

    fireEvent.press(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// ── 검색 결과 표면 (옛 `RegionPickerScreen.search.test.tsx`, TRIP-1023 칸 B #007 · 결정3 · Seed Q8) ──
// 검색어가 있으면 섹션 제목이 "검색 결과"이고(비면 "지역별 둘러보기" 그대로), 검색 결과의 **시군구**
// 카드에만 상위 시도명(`Region.sidoName`)이 부제로 붙는다 — 동명 시군구("중구")를 가르는 유일한 단서.
// 시도 행·2단 드릴다운·인기 스트립에는 붙이지 않는다(AC-B4).
// ★ 기댓값은 픽스처의 `sidoName` 을 그대로 쓴다 — 계약 예시 문자열을 손으로 적으면 어긋난다.
// ★ `getByText('검색 결과')` 는 완전일치라 빈 결과 문구 "검색 결과가 없어요" 에 걸리지 않는다(실검증).
describe('검색 결과 표면', () => {
  /** 일반시의 행정구 — 시군구지만 목적지가 아니다(선택 불가 묶음 행 갈래 ②, Q8). */
  const JANGAN = region({
    regionCode: '41111',
    name: '수원시 장안구',
    sidoName: '경기도',
    selectable: false,
    poiCount: 20,
  });
  /** 동명 시군구 — 부제 없이는 두 카드가 똑같이 "중구"로만 보인다(#007 의 핵심). */
  const SEOUL_JUNG = region({
    regionCode: '11140',
    name: '중구',
    sidoName: '서울특별시',
  });
  const BUSAN_JUNG = region({
    regionCode: '26110',
    name: '중구',
    sidoName: '부산광역시',
  });

  function searchProps(
    over: Partial<RegionPickerScreenProps> = {}
  ): RegionPickerScreenProps {
    return {
      purpose: 'trip',
      query: '',
      regions: [INCHEON, MICHUHOL, GANGWON, CHUNCHEON, HONGCHEON],
      isLoading: false,
      isError: false,
      onChangeQuery: jest.fn(),
      onSelectRegion: jest.fn(),
      onRetry: jest.fn(),
      onBack: jest.fn(),
      ...over,
    };
  }

  const PURPOSES: RegionPurpose[] = ['trip', 'stay'];

  describe('🔴 1023-B #007 · 검색어가 있으면 섹션 제목이 "검색 결과" 다 (AC-B1 · BR-U1-07 두 목적 공통)', () => {
    it.each(PURPOSES)(
      'purpose=%s — 결과가 있을 때 "검색 결과" 이고 "지역별 둘러보기" 는 없다',
      (purpose) => {
        render(
          <RegionPickerScreen
            {...searchProps({ purpose, query: '춘천', regions: [CHUNCHEON] })}
          />
        );

        // 앵커 — 검색 결과 카드가 실제로 그려졌다.
        expect(screen.getByTestId('explore-region-51110')).toBeOnTheScreen();
        expect(screen.getByText('검색 결과')).toBeOnTheScreen();
        expect(screen.queryByText('지역별 둘러보기')).toBeNull();
      }
    );

    it('결과가 0건이어도 검색 중이므로 제목은 "검색 결과" 이고, 빈 결과 문구가 함께 뜬다', () => {
      render(
        <RegionPickerScreen
          {...searchProps({ query: '없는곳', regions: [] })}
        />
      );

      expect(screen.getByText('검색 결과가 없어요')).toBeOnTheScreen();
      expect(screen.getByText('검색 결과')).toBeOnTheScreen();
      expect(screen.queryByText('지역별 둘러보기')).toBeNull();
    });
  });

  describe('1023-B #007 · 검색어가 비면 제목은 그대로 "지역별 둘러보기" 다 (AC-B2 · 선제 green 회귀 앵커)', () => {
    it.each([
      ['빈 문자열', ''],
      ['공백뿐(드릴다운과 같은 trim 판정)', '   '],
    ])(
      '%s — 1단 시/도 목록 위 제목이 "지역별 둘러보기" 다',
      (_label, query) => {
        render(<RegionPickerScreen {...searchProps({ query })} />);

        // 앵커 — 1단(시/도 행)이 그려졌다. 공백 검색어를 검색으로 치면 이 행이 사라지고 제목도 갈린다.
        expect(screen.getByTestId('explore-region-sido-28')).toBeOnTheScreen();
        expect(screen.getByText('지역별 둘러보기')).toBeOnTheScreen();
        expect(screen.queryByText('검색 결과')).toBeNull();
      }
    );

    it('2단 드릴다운 안에서도 제목이 "지역별 둘러보기" 다', () => {
      render(<RegionPickerScreen {...searchProps({ query: '' })} />);

      fireEvent.press(screen.getByTestId('explore-region-sido-51'));

      expect(
        screen.getByTestId('explore-region-drilldown-back')
      ).toBeOnTheScreen();
      expect(screen.getByText('지역별 둘러보기')).toBeOnTheScreen();
      expect(screen.queryByText('검색 결과')).toBeNull();
    });
  });

  describe('🔴 1023-B #007 · 검색 결과의 시군구 카드에 상위 시도명이 부제로 붙는다 (AC-B3 · Seed Q8)', () => {
    it.each([
      { kind: '선택 카드(poiCount>0)', target: CHUNCHEON, query: '춘천' },
      {
        kind: '"추천 장소 없음" 카드(poiCount=0)',
        target: HONGCHEON,
        query: '홍천',
      },
      { kind: '선택 불가 묶음 행(행정구)', target: JANGAN, query: '장안' },
    ])('$kind 에 sidoName 이 보인다', ({ target, query }) => {
      render(
        <RegionPickerScreen {...searchProps({ query, regions: [target] })} />
      );

      const card = screen.getByTestId(`explore-region-${target.regionCode}`);
      // 앵커 — 그 카드의 이름이 카드 안에 있다(부제만 있고 이름이 사라진 구현을 막는다).
      expect(within(card).getByText(target.name)).toBeOnTheScreen();
      expect(within(card).getByText(target.sidoName)).toBeOnTheScreen();
    });

    it('동명 시군구 두 "중구" 카드가 각자 자기 시도명을 단다 — 상수 부제가 아니다', () => {
      render(
        <RegionPickerScreen
          {...searchProps({ query: '중구', regions: [SEOUL_JUNG, BUSAN_JUNG] })}
        />
      );

      const seoul = screen.getByTestId('explore-region-11140');
      const busan = screen.getByTestId('explore-region-26110');
      expect(within(seoul).getByText(SEOUL_JUNG.sidoName)).toBeOnTheScreen();
      expect(within(seoul).queryByText(BUSAN_JUNG.sidoName)).toBeNull();
      expect(within(busan).getByText(BUSAN_JUNG.sidoName)).toBeOnTheScreen();
      expect(within(busan).queryByText(SEOUL_JUNG.sidoName)).toBeNull();
    });
  });

  describe('1023-B #007 · 부제를 붙이지 않는 자리 (AC-B4 · 선제 green 회귀 앵커)', () => {
    it('검색 결과의 시도 행은 이름과 같은 시도명을 한 번 더 붙이지 않는다', () => {
      render(
        <RegionPickerScreen
          {...searchProps({ query: '인천', regions: [INCHEON, MICHUHOL] })}
        />
      );

      // 대조 앵커 — 같은 화면의 시군구 카드엔 부제가 붙었다(부제 기능이 켜진 화면에서의 부재여야 의미가 있다).
      expect(
        within(screen.getByTestId('explore-region-28177')).getByText(
          MICHUHOL.sidoName
        )
      ).toBeOnTheScreen();
      // 시도 행 — "인천광역시" 가 카드 안에 정확히 한 번(이름)만 있다.
      expect(
        within(screen.getByTestId('explore-region-28')).getAllByText(
          INCHEON.sidoName
        )
      ).toHaveLength(1);
    });

    it('2단 드릴다운의 시군구 카드에는 부제가 없다 (이미 "{시도} 전체" 제목 아래)', () => {
      render(<RegionPickerScreen {...searchProps({ query: '' })} />);

      fireEvent.press(screen.getByTestId('explore-region-sido-51'));

      const card = screen.getByTestId('explore-region-51110');
      // 앵커 — 드릴인한 카드가 그려졌다.
      expect(within(card).getByText(CHUNCHEON.name)).toBeOnTheScreen();
      expect(within(card).queryByText(CHUNCHEON.sidoName)).toBeNull();
      // '전체' 자리(강원 SIDO 묶음 행)도 이름 한 번뿐이다.
      expect(
        within(screen.getByTestId('explore-region-51')).getAllByText(
          GANGWON.sidoName
        )
      ).toHaveLength(1);
    });

    it('인기 스트립 카드에는 부제가 없다 — 시도명이 카드에 한 번뿐이다', () => {
      render(<RegionPickerScreen {...searchProps({ query: '' })} />);

      const popular = screen.getByTestId('explore-region-popular-28');
      expect(within(popular).getAllByText(INCHEON.sidoName)).toHaveLength(1);
    });
  });
});
