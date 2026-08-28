import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';

import { RegionPickerScreen } from './RegionPickerScreen';
import type { RegionPickerScreenProps } from './RegionPickerScreen';

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
    expect(screen.getByText('지역별 숙소')).toBeTruthy();
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
    expect(screen.getByText('인천광역시')).toBeTruthy();

    // 구/군은 접혀 있다 — 미추홀구는 1단에 없다(★ AC-1 핵심).
    expect(screen.queryByTestId('explore-region-28177')).toBeNull();
    expect(screen.queryByText('미추홀구')).toBeNull();

    // 1단의 인천은 '시/도 행'일 뿐 '선택 카드'가 아니다 — 선택 카드 testID 는 상세에서만 뜬다(★4).
    expect(screen.queryByTestId('explore-region-28')).toBeNull();
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

describe('AC-5 · 준비중 유지 (poiCount=0 구/군, INV-1)', () => {
  it('poiCount=0 구/군은 상세에서 "준비 중"을 달고, 눌러도 선택되지 않는다', () => {
    const onSelectRegion = jest.fn();
    render(
      <RegionPickerScreen
        {...props({ regions: [GANGWON, CHUNCHEON, HONGCHEON], onSelectRegion })}
      />
    );

    fireEvent.press(screen.getByTestId('explore-region-sido-51')); // 강원 드릴인

    // 홍천군(poi=0): "준비 중"(정규식 — 카드 집계 텍스트라 완전일치는 실패, ★2).
    const coming = screen.getByTestId('explore-region-51720');
    expect(coming).toHaveTextContent(/준비 중/);

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

describe('AC-7 · INV-3 소요시간 미표시', () => {
  it('1단에서 소요시간 문자열이 나타나지 않는다', () => {
    render(<RegionPickerScreen {...props({ query: '' })} />);

    expect(screen.queryByText(/소요/)).toBeNull();
    expect(screen.queryByText(/\d+\s*분/)).toBeNull();
    expect(screen.queryByText(/\d+\s*시간/)).toBeNull();
  });

  it('드릴다운 상세에서도 소요시간 문자열이 나타나지 않는다', () => {
    render(<RegionPickerScreen {...props({ query: '' })} />);
    fireEvent.press(screen.getByTestId('explore-region-sido-28'));

    expect(screen.queryByText(/소요/)).toBeNull();
    expect(screen.queryByText(/\d+\s*분/)).toBeNull();
    expect(screen.queryByText(/\d+\s*시간/)).toBeNull();
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
