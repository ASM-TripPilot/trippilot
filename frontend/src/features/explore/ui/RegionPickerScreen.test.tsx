import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';

import { RegionPickerScreen } from './RegionPickerScreen';
import type { RegionPickerScreenProps } from './RegionPickerScreen';

/**
 * TRIP-445 e00·d1b 지역 선택 화면 — 서버 카탈로그(`GET /regions`)를 그린다.
 *
 * 무엇이 바뀌었나(현행 대비):
 *  · `regions`가 상수 6개가 아니라 **서버 `Region`**(regionCode·name·sidoName·level·
 *    selectable·poiCount)이다. testID·key·tint는 `regionCode`가 식별자다(D2).
 *  · `poiCount === 0`은 "준비 중"으로 그리고 **선택 불가**(AC-2), `selectable === false`는
 *    음영 라벨 행으로 **보이되 선택 불가**(AC-3) — 둘 다 "선택 불가"지만 사유가 다르다.
 *  · 조회 실패(`isError`)를 **빈 목록으로 뭉개지 않고** 실패 얼굴로 그린다(AC-6·INV-4).
 *  · **'내 주변' 진입은 완전히 제거됐다**(AC-7) — `nearby`·`onSelectNearby` prop이 없다.
 *
 * 3동작 뼈대: 준비=props 조립 → 실행=render(+press/changeText) → 단언=화면에 보이는 것.
 * ★ "준비 중" 같은 카드 텍스트는 **정규식**으로 단언한다 — `toHaveTextContent('준비 중')`
 *   문자열은 카드 집계 텍스트("부산광역시준비 중")에서 완전 일치라 실패한다(02a §5-①ㆍ★2).
 */

/** 서버 `Region` 표본 도우미 — required 6필드를 채운다. */
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

const BUSAN = region({ regionCode: '26', name: '부산광역시', poiCount: 12 });
const JEJU = region({ regionCode: '50', name: '제주특별자치도', poiCount: 8 });

function props(
  over: Partial<RegionPickerScreenProps> = {}
): RegionPickerScreenProps {
  return {
    purpose: 'stay',
    query: '',
    regions: [BUSAN, JEJU],
    isLoading: false,
    isError: false,
    onChangeQuery: jest.fn(),
    onSelectRegion: jest.fn(),
    onRetry: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

describe('BR-U1-07 · 목적 파라미터 분기 — 같은 컴포넌트, 카피만 다르다', () => {
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

describe('AC-1 · 서버 카탈로그를 그대로 그린다 (regionCode가 식별자)', () => {
  it('서버가 준 지역 카드를 개수·이름·testID 그대로 그린다', () => {
    render(<RegionPickerScreen {...props({ regions: [BUSAN, JEJU] })} />);

    expect(screen.getByTestId('explore-region-26')).toBeTruthy();
    expect(screen.getByTestId('explore-region-50')).toBeTruthy();
    expect(screen.getByText('부산광역시')).toBeTruthy();
    expect(screen.getByText('제주특별자치도')).toBeTruthy();
  });

  it('선택 가능·poiCount>0 카드를 누르면 그 서버 Region 객체를 그대로 올려보낸다', () => {
    const onSelectRegion = jest.fn();
    render(<RegionPickerScreen {...props({ onSelectRegion })} />);

    fireEvent.press(screen.getByTestId('explore-region-50'));

    // 코드 문자열이 아니라 객체를 넘긴다 — 호출부가 name(서버 질의값)을 다시 찾지 않아도 된다.
    expect(onSelectRegion).toHaveBeenCalledWith(JEJU);
  });
});

describe('AC-2 · poiCount===0 → "준비 중" + 선택 불가', () => {
  it('poiCount=0 지역은 "준비 중"을 달고, 눌러도 선택되지 않는다', () => {
    const onSelectRegion = jest.fn();
    const empty = region({
      regionCode: '43',
      name: '충청북도',
      selectable: true,
      poiCount: 0,
    });
    render(
      <RegionPickerScreen
        {...props({ regions: [empty, JEJU], onSelectRegion })}
      />
    );

    // 보인다 + "준비 중"(정규식 — 카드 집계 텍스트라 완전일치는 실패, ★2).
    const card = screen.getByTestId('explore-region-43');
    expect(card).toHaveTextContent(/준비 중/);

    // 실제 press를 발화하고 미호출을 확인한다(★8 — 비-Pressable이라도 3단으로).
    fireEvent.press(card);
    expect(onSelectRegion).not.toHaveBeenCalled();

    // 긍정 짝 — poiCount>0 지역은 정상 선택된다.
    fireEvent.press(screen.getByTestId('explore-region-50'));
    expect(onSelectRegion).toHaveBeenCalledWith(JEJU);
  });
});

describe('AC-3 · selectable===false → 묶음 표시 + 선택 불가', () => {
  it('selectable=false 행은 보이되, 눌러도 선택되지 않는다', () => {
    const onSelectRegion = jest.fn();
    const group = region({
      regionCode: '51',
      name: '강원특별자치도',
      level: RegionLevel.SIDO,
      sidoName: '강원특별자치도',
      selectable: false,
      poiCount: 30,
    });
    render(
      <RegionPickerScreen
        {...props({ regions: [group, JEJU], onSelectRegion })}
      />
    );

    // 보인다.
    expect(screen.getByTestId('explore-region-51')).toBeTruthy();
    expect(screen.getByText('강원특별자치도')).toBeTruthy();

    // 눌러도 선택 안 됨.
    fireEvent.press(screen.getByTestId('explore-region-51'));
    expect(onSelectRegion).not.toHaveBeenCalled();

    // 부정 짝 — selectable=true 지역은 선택된다.
    fireEvent.press(screen.getByTestId('explore-region-50'));
    expect(onSelectRegion).toHaveBeenCalledWith(JEJU);
  });
});

describe('AC-6 · 조회 실패는 빈 목록으로 뭉개지 않는다 (INV-4)', () => {
  it('isError면 실패 얼굴을 그리고, "검색 결과가 없어요"로 뭉개지 않는다', () => {
    const onRetry = jest.fn();
    render(
      <RegionPickerScreen {...props({ isError: true, regions: [], onRetry })} />
    );

    // 실패 안내(StateNotice error)가 보인다.
    expect(screen.getByTestId('explore-region-error')).toBeTruthy();
    // 빈 목록 문구로 뭉개지지 않는다(부정 짝).
    expect(screen.queryByText('검색 결과가 없어요')).toBeNull();

    // 다시 시도 → refetch 콜백.
    fireEvent.press(screen.getByTestId('explore-region-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('부정 짝 · ready+빈 결과는 "검색 결과가 없어요"이고 실패 얼굴이 아니다', () => {
    render(
      <RegionPickerScreen
        {...props({
          isError: false,
          isLoading: false,
          regions: [],
          query: '없는곳',
        })}
      />
    );

    expect(screen.getByText('검색 결과가 없어요')).toBeTruthy();
    expect(screen.queryByTestId('explore-region-error')).toBeNull();
  });

  it('로딩 중은 빈 결과와 다르다 — "검색 결과가 없어요"·실패 얼굴을 안 낸다', () => {
    render(<RegionPickerScreen {...props({ isLoading: true, regions: [] })} />);

    expect(screen.getByTestId('explore-region-loading')).toBeTruthy();
    expect(screen.queryByText('검색 결과가 없어요')).toBeNull();
    expect(screen.queryByTestId('explore-region-error')).toBeNull();
  });
});

describe("AC-7 · '내 주변'이 화면 어디에도 없다", () => {
  it("purpose='stay'에서도 '내 주변' 진입과 텍스트가 없다", () => {
    render(<RegionPickerScreen {...props({ purpose: 'stay' })} />);

    expect(screen.queryByTestId('explore-region-nearby')).toBeNull();
    expect(screen.queryByText('내 주변')).toBeNull();
  });
});

describe('검색 · 앱바 — 이월 유지', () => {
  it('입력하면 그대로 올려보낸다 — 필터 판정은 화면 밖에서 한다', () => {
    const onChangeQuery = jest.fn();
    render(<RegionPickerScreen {...props({ onChangeQuery })} />);

    fireEvent.changeText(screen.getByTestId('explore-region-search'), '제주');

    expect(onChangeQuery).toHaveBeenCalledWith('제주');
  });

  it('뒤로가기를 누르면 콜백이 불린다', () => {
    const onBack = jest.fn();
    render(<RegionPickerScreen {...props({ onBack })} />);

    fireEvent.press(screen.getByTestId('explore-region-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('INV-3 · 소요시간 미표시', () => {
  it('어떤 상태에서도 소요시간 문자열이 나타나지 않는다', () => {
    render(<RegionPickerScreen {...props()} />);

    expect(screen.queryByText(/소요/)).toBeNull();
    expect(screen.queryByText(/\d+\s*분/)).toBeNull();
    expect(screen.queryByText(/\d+\s*시간/)).toBeNull();
  });
});
