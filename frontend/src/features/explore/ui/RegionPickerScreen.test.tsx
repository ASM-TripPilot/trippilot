import { fireEvent, render, screen } from '@testing-library/react-native';

import { REGIONS } from '../model/regions';
import { RegionPickerScreen } from './RegionPickerScreen';
import type { RegionPickerScreenProps } from './RegionPickerScreen';

/**
 * TRIP-183 e00·d1b 지역 선택 화면 — 프레젠테이션 전용.
 *
 * **왜 props만 받는가**: dev 프리뷰(`src/app/_dev/preview.tsx`)가 이 화면을 정적으로 그리는데,
 * 동결 테스트 `devPreview.test.tsx`가 `@/shared/api`·컨테이너·훅을 **전이 의존으로라도** 끌고
 * 오면 지뢰 목으로 즉시 터뜨린다. 그래서 `expo-location`과 쿼리 훅은 컨테이너에만 둔다.
 *
 * 3동작 뼈대: 준비=props 조립 → 실행=render(+press/changeText) → 단언=화면에 보이는 것.
 */

function props(
  over: Partial<RegionPickerScreenProps> = {}
): RegionPickerScreenProps {
  return {
    purpose: 'stay',
    query: '',
    regions: REGIONS,
    nearby: { kind: 'idle' },
    onChangeQuery: jest.fn(),
    onSelectRegion: jest.fn(),
    onSelectNearby: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

describe('BR-U1-07 · 목적 파라미터 분기 — 같은 컴포넌트, 카피만 다르다', () => {
  it("purpose='stay'는 숙소 카피를 쓴다 (Figma e00)", () => {
    render(<RegionPickerScreen {...props({ purpose: 'stay' })} />);

    expect(screen.getByText('지역 선택')).toBeTruthy();
    expect(screen.getByText('어디서 묵을까요?')).toBeTruthy();
    expect(
      screen.getByText('지역을 고르면 숙소를 모아 보여드려요')
    ).toBeTruthy();
    expect(screen.getByText('지역별 숙소')).toBeTruthy();
  });

  it("purpose='trip'은 여행지 카피를 쓴다 (Figma d1b)", () => {
    render(<RegionPickerScreen {...props({ purpose: 'trip' })} />);

    expect(screen.getByText('여행지 선택')).toBeTruthy();
    expect(screen.getByText('어디로 떠날까요?')).toBeTruthy();
    expect(screen.getByText('가고 싶은 도시를 먼저 골라요')).toBeTruthy();
    expect(screen.getByText('인기 여행지')).toBeTruthy();
  });

  it('목적이 달라도 지역 카드 집합은 같다 — 컴포넌트가 하나라는 증거', () => {
    const { unmount } = render(
      <RegionPickerScreen {...props({ purpose: 'stay' })} />
    );
    const stayCodes = REGIONS.map((r) =>
      screen.getByTestId(`explore-region-${r.code}`)
    ).length;
    unmount();

    render(<RegionPickerScreen {...props({ purpose: 'trip' })} />);
    const tripCodes = REGIONS.map((r) =>
      screen.getByTestId(`explore-region-${r.code}`)
    ).length;

    expect({ stayCodes, tripCodes }).toEqual({ stayCodes: 6, tripCodes: 6 });
  });
});

describe('지역 카드 (testID 규약 explore-region-{code} · 정본 §6)', () => {
  it('전달받은 지역을 전부 그린다', () => {
    render(<RegionPickerScreen {...props()} />);

    REGIONS.forEach((r) => {
      expect(screen.getByTestId(`explore-region-${r.code}`)).toBeTruthy();
      expect(screen.getByText(r.name)).toBeTruthy();
    });
  });

  it('카드를 누르면 그 지역 객체를 그대로 올려보낸다', () => {
    const onSelectRegion = jest.fn();
    render(<RegionPickerScreen {...props({ onSelectRegion })} />);

    fireEvent.press(screen.getByTestId('explore-region-jeju'));

    // 코드 문자열이 아니라 객체를 넘긴다 — 호출부가 name(서버 질의값)을 다시 찾지 않아도 된다.
    expect(onSelectRegion).toHaveBeenCalledWith(
      REGIONS.find((r) => r.code === 'jeju')
    );
  });

  it('집계(숙소 수·최저가)를 표시하지 않는다 — 계약이 없다(US-EXPL-02 예외항)', () => {
    render(<RegionPickerScreen {...props()} />);

    // "카드는 유지하고 집계 값만 생략한다"는 규칙대로, 카드는 있고 숫자는 없다.
    expect(screen.queryByText(/곳/)).toBeNull();
    expect(screen.queryByText(/원~/)).toBeNull();
  });

  it('빈 목록이면 카드가 하나도 없다 — 검색 결과 0건이 그대로 보인다', () => {
    render(<RegionPickerScreen {...props({ regions: [], query: '없는곳' })} />);

    expect(screen.queryByTestId('explore-region-jeju')).toBeNull();
    expect(screen.getByText('검색 결과가 없어요')).toBeTruthy();
  });
});

describe('검색 (Q4 — 상수 목록 클라이언트 필터)', () => {
  it('목적에 따라 placeholder가 다르다', () => {
    const { unmount } = render(
      <RegionPickerScreen {...props({ purpose: 'stay' })} />
    );
    expect(screen.getByPlaceholderText('지역·숙소 이름 검색')).toBeTruthy();
    unmount();

    render(<RegionPickerScreen {...props({ purpose: 'trip' })} />);
    expect(screen.getByPlaceholderText('도시·지역 검색')).toBeTruthy();
  });

  it('입력하면 그대로 올려보낸다 — 필터 판정은 화면 밖에서 한다', () => {
    const onChangeQuery = jest.fn();
    render(<RegionPickerScreen {...props({ onChangeQuery })} />);

    fireEvent.changeText(screen.getByTestId('explore-region-search'), '제주');

    expect(onChangeQuery).toHaveBeenCalledWith('제주');
  });
});

describe("'내 주변' (US-STAY-01 정상 · Figma 공백이라 이 칸에서 신설)", () => {
  it('진입 항목이 있고 누르면 콜백이 불린다', () => {
    const onSelectNearby = jest.fn();
    render(<RegionPickerScreen {...props({ onSelectNearby })} />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    expect(onSelectNearby).toHaveBeenCalledTimes(1);
  });

  it("purpose='trip'에서는 '내 주변'을 보이지 않는다 — 숙소 탐색 전용 진입이다", () => {
    render(<RegionPickerScreen {...props({ purpose: 'trip' })} />);

    // US-STAY-01의 '내 주변'은 숙소 스토리다. 여행지 선택에 끌고 오면 범위가 샌다.
    expect(screen.queryByTestId('explore-region-nearby')).toBeNull();
  });

  it('측위 중에는 진행 상태를 보인다', () => {
    render(<RegionPickerScreen {...props({ nearby: { kind: 'locating' } })} />);

    expect(screen.getByText('현재 위치를 확인하는 중')).toBeTruthy();
  });
});

describe('BR-U1-11 · 대체 조회 고지 — 침묵하지 않는다(INV-4)', () => {
  it('등록 숙소로 대체했으면 그 사실을 화면에 보인다', () => {
    render(<RegionPickerScreen {...props({ nearby: { kind: 'fallback' } })} />);

    // Figma i21(1790:3549)의 문구를 차용했다 — "현재 위치 대신 등록 숙소를 기준으로 …"
    expect(screen.getByTestId('explore-region-notice')).toBeTruthy();
    expect(
      screen.getByText('현재 위치 대신 등록 숙소를 기준으로 찾았어요')
    ).toBeTruthy();
  });

  it('권한도 없고 등록 숙소도 없으면 지역 선택을 안내한다', () => {
    render(
      <RegionPickerScreen
        {...props({
          nearby: { kind: 'unavailable', reason: 'denied-no-fallback' },
        })}
      />
    );

    expect(
      screen.getByText(
        '위치 권한이 꺼져 있고 등록한 숙소도 없어요. 지역을 골라 주세요'
      )
    ).toBeTruthy();
  });

  it('측위 실패는 권한 거부와 다른 안내를 낸다 — 할 일이 다르다', () => {
    render(
      <RegionPickerScreen
        {...props({
          nearby: { kind: 'unavailable', reason: 'position-failed' },
        })}
      />
    );

    expect(
      screen.getByText('현재 위치를 확인하지 못했어요. 지역을 골라 주세요')
    ).toBeTruthy();
  });

  it('idle이면 고지가 없다 — 아무 일도 안 했는데 안내를 띄우지 않는다', () => {
    render(<RegionPickerScreen {...props({ nearby: { kind: 'idle' } })} />);

    expect(screen.queryByTestId('explore-region-notice')).toBeNull();
  });
});

describe('INV-3 · 소요시간 미표시', () => {
  it('어떤 상태에서도 소요시간 문자열이 나타나지 않는다', () => {
    render(<RegionPickerScreen {...props({ nearby: { kind: 'fallback' } })} />);

    expect(screen.queryByText(/소요/)).toBeNull();
    expect(screen.queryByText(/\d+\s*분/)).toBeNull();
    expect(screen.queryByText(/\d+\s*시간/)).toBeNull();
  });
});

describe('앱바', () => {
  it('뒤로가기를 누르면 콜백이 불린다', () => {
    const onBack = jest.fn();
    render(<RegionPickerScreen {...props({ onBack })} />);

    fireEvent.press(screen.getByTestId('explore-region-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
