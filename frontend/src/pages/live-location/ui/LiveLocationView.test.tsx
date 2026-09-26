import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useGetStaysReverseGeocode } from '@/shared/api/generated/stays/stays';
import type { MapCenter } from '@/shared/map';

import { LiveLocationView } from './LiveLocationView';

/**
 * TRIP-442·866·979 — i20(수동 입력)·i21(권한 거부) **순수 뷰**. 조회·요청·라우터는 컨테이너
 * (`LiveLocationPage`)가 하고, 이 뷰는 받은 값만 그린다(프리뷰가 네트워크 없이 이 뷰를 태운다).
 * (TRIP-979 B 에서 옛 `LiveLocationPage.test.tsx` 를 뷰 대상으로 옮겼다 — 페이지가 컨테이너가 됐다.)
 *
 * 무엇을 보장하나(초심자용):
 *  - 한 컴포넌트를 `state` 로 두 얼굴로 그리고, 미지정·미지 값은 manual 얼굴로 폴백한다(AC-A7, INV-4).
 *  - 지도 중심·라벨은 **받은 값**이다 — 부산 하드코딩이 아니다(AC-B2·B3). 라벨은 `{placeName} 인근`,
 *    이름이 없으면 `여행지 기준`, 둘 다 "(추정)"이 붙는다.
 *  - `center` 가 null(일정 미도착)이면 지도(picker)를 **마운트하지 않는다** — picker 는 첫 center 만
 *    포획하므로 늦게 온 좌표를 못 받는다(맹점 ①-1). 그 자리엔 `live-location-loading`.
 *  - '이 위치로 계속' → 옮긴 중심(안 옮겼으면 받은 center)을 onConfirm 으로. 역지오코딩 0회(AC-9).
 *  - `errorText` 가 있으면 `live-location-error` 에 그대로 보인다.
 *
 * 3동작: 준비(props 로 render) → 실행(onPick 발화·confirm press) → 단언(얼굴·라벨·콜백·0회).
 *
 * ★ 문자열 matcher 는 **완전 일치**다(RNTL getByText·toHaveTextContent). 라벨처럼 한 Text 노드에
 *   통째로 담기는 값만 문자열로, 아이콘과 섞일 수 있는 문구는 정규식으로 잠근다.
 * ★ `center-pin-picker` 는 `mapViewMock` 목이다 — `.props.center` 로 마운트 때 넘긴 중심을 읽는다.
 *   지도가 실제로 그 좌표에 서는지는 6-b 실기 몫이다.
 */

// `@/shared/map` 을 목으로 — CenterPinPicker 가 center·onPick 을 host 로 통과한다.
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 역지오코딩 훅 목 — 이 화면은 이걸 **안 써야** 한다(AC-9). 0회 호출을 잠그는 트립와이어.
jest.mock('@/shared/api/generated/stays/stays', () => ({
  useGetStaysReverseGeocode: jest.fn(() => ({
    data: undefined,
    isError: false,
    isPending: false,
  })),
}));

const mockReverse = useGetStaysReverseGeocode as jest.Mock;

const SEOUL: MapCenter = { lat: 37.5796, lng: 126.977 };
const DURATION = /\d+\s*(초|분|시간)|소요/;

beforeEach(() => {
  mockReverse.mockClear();
});

/** 지도를 움직여 멈춰 중심 좌표가 보고된 상황을 흉내낸다(실 pan 은 6-b). */
function panTo(center: MapCenter): void {
  const picker = screen.getByTestId('center-pin-picker');
  act(() => {
    (picker.props as { onPick: (c: MapCenter) => void }).onPick(center);
  });
}

describe('LiveLocationView — i20 수동 입력 얼굴 (state=manual)', () => {
  it('manual 얼굴을 그리고 permission-denied 루트는 없다(상호배타)', () => {
    render(
      <LiveLocationView state="manual" center={SEOUL} placeName="경복궁" />
    );

    expect(screen.getByTestId('live-location-manual')).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-permission-denied')).toBeNull();
  });

  it('i20 배너·공통 subline·중립 건너뛰기 문구·지도(중앙 고정 핀)를 그린다', () => {
    render(
      <LiveLocationView state="manual" center={SEOUL} placeName="경복궁" />
    );

    expect(screen.getByText(/위치를 확인할 수 없어/)).toBeOnTheScreen();
    expect(screen.getByText(/추정 출발지로 사용돼요/)).toBeOnTheScreen();
    expect(
      screen.getByTestId('live-location-use-last-visit')
    ).toBeOnTheScreen();
    expect(
      screen.getByText(/마지막 방문지나 등록 숙소 기준/)
    ).toBeOnTheScreen();
    expect(screen.getByTestId('center-pin-picker')).toBeOnTheScreen();
  });
});

describe('LiveLocationView — i21 권한 거부 얼굴 (state=permission-denied)', () => {
  it('permission-denied 얼굴을 그리고 manual 루트는 없다(상호배타)', () => {
    render(
      <LiveLocationView
        state="permission-denied"
        center={SEOUL}
        placeName="경복궁"
      />
    );

    expect(
      screen.getByTestId('live-location-permission-denied')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-manual')).toBeNull();
  });

  it('🔴 AC-B3 · Q6 — 권한 거부 배너 + 일정 장소 기준 라벨(추정) + 새 안내 힌트, 등록 숙소 문구는 없다', () => {
    render(
      <LiveLocationView
        state="permission-denied"
        center={SEOUL}
        placeName="경복궁"
      />
    );

    expect(screen.getByText(/위치 권한이 꺼져 있어/)).toBeOnTheScreen();
    expect(screen.getByText('경복궁 인근(추정)')).toBeOnTheScreen();
    expect(
      screen.getByText(/일정 속 장소를 기준으로 잡았어요/)
    ).toBeOnTheScreen();
    // 숙소를 조회하지 않으니 "등록 숙소를 기준으로" 라고 말하면 거짓이다.
    expect(screen.queryByText(/등록 숙소를 기준으로/)).toBeNull();
    expect(screen.queryByText(/등록 숙소 기준\s*\(추정\)/)).toBeNull();
  });
});

describe('🔴 AC-B3 · Q6 — 선택 위치 라벨은 받은 기준 장소에서 만든다(광안리 하드코딩 없음)', () => {
  it.each([['manual'], ['permission-denied']])(
    '%s — placeName 이 있으면 "{이름} 인근(추정)"',
    (state) => {
      render(
        <LiveLocationView state={state} center={SEOUL} placeName="경복궁" />
      );

      expect(screen.getByText('경복궁 인근(추정)')).toBeOnTheScreen();
      expect(screen.queryByText(/광안리/)).toBeNull();
    }
  );

  it.each([['manual'], ['permission-denied']])(
    '%s — placeName 이 null 이면 "여행지 기준(추정)"',
    (state) => {
      render(
        <LiveLocationView state={state} center={SEOUL} placeName={null} />
      );

      expect(screen.getByText('여행지 기준(추정)')).toBeOnTheScreen();
      expect(screen.queryByText(/광안리/)).toBeNull();
    }
  );
});

describe('🔴 AC-B2 — 지도 중심은 받은 center 이고, center 가 없으면 지도를 마운트하지 않는다', () => {
  it('picker 가 마운트될 때 받은 center 를 그대로 넘긴다', () => {
    render(
      <LiveLocationView state="manual" center={SEOUL} placeName="경복궁" />
    );

    expect(screen.getByTestId('center-pin-picker').props.center).toEqual(SEOUL);
    expect(screen.queryByTestId('live-location-loading')).toBeNull();
  });

  it('center 가 null 이면 loading 자리만 있고 picker 는 없으며, 확정을 눌러도 콜백이 없다', () => {
    const onConfirm = jest.fn();
    render(
      <LiveLocationView
        state="manual"
        center={null}
        placeName={null}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByTestId('live-location-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('center-pin-picker')).toBeNull();

    fireEvent.press(screen.getByTestId('live-location-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-9 · AC-B5 — 좌표 확정: 중심좌표를 확정 콜백으로, 역지오코딩은 0회', () => {
  it('지도를 움직여 확정 버튼을 누르면 그 중심좌표가 onConfirm 으로 가고, 주소 조회는 없다', () => {
    const onConfirm = jest.fn();
    render(
      <LiveLocationView
        state="manual"
        center={SEOUL}
        placeName="경복궁"
        onConfirm={onConfirm}
      />
    );

    // 지도를 움직여 멈춤 → 좌표 담김(lat≠lng 로 축 스왑 방지).
    panTo({ lat: 37.55, lng: 126.99 });

    fireEvent.press(screen.getByTestId('live-location-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ lat: 37.55, lng: 126.99 });

    // ★ LiveLocation 은 좌표만 쓴다 — 역지오코딩 훅이 단 한 번도 호출되면 안 된다.
    expect(mockReverse).toHaveBeenCalledTimes(0);
  });

  it('지도를 안 옮겼으면 받은 center 가 onConfirm 으로 간다', () => {
    const onConfirm = jest.fn();
    render(
      <LiveLocationView
        state="manual"
        center={SEOUL}
        placeName="경복궁"
        onConfirm={onConfirm}
      />
    );

    fireEvent.press(screen.getByTestId('live-location-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(SEOUL);
    expect(mockReverse).toHaveBeenCalledTimes(0);
  });
});

describe('🔴 AC-B5 · Q7 — 요청 실패 안내 자리', () => {
  it('errorText 가 있으면 live-location-error 가 그 문구만 담는다', () => {
    render(
      <LiveLocationView
        state="manual"
        center={SEOUL}
        placeName="경복궁"
        errorText="여행 기간에만 AI에게 맡길 수 있어요"
      />
    );

    expect(screen.getByTestId('live-location-error')).toHaveTextContent(
      '여행 기간에만 AI에게 맡길 수 있어요'
    );
  });

  it('errorText 가 없으면(null·생략) 안내 자리도 없다', () => {
    const { rerender } = render(
      <LiveLocationView state="manual" center={SEOUL} placeName="경복궁" />
    );
    expect(screen.queryByTestId('live-location-error')).toBeNull();

    rerender(
      <LiveLocationView
        state="manual"
        center={SEOUL}
        placeName="경복궁"
        errorText={null}
      />
    );
    expect(screen.queryByTestId('live-location-error')).toBeNull();
  });
});

describe('TRIP-979 AC-A7 · state 미지정·미지 값은 manual 얼굴로 폴백한다 (INV-4)', () => {
  // 라우트는 URL `?state=` 원문을 검증 없이 내린다 — 빠지면 undefined, 오타면 아무 문자열,
  // 같은 키가 두 번이면 배열(expo-router 검색 파라미터 모양)이 온다.
  it.each([
    ['미지정(undefined)', undefined],
    ["미지 값('foo')", 'foo'],
    ["배열(['manual'])", ['manual']],
  ])('%s 이면 던지지 않고 manual 얼굴을 그린다', (_label, raw) => {
    render(<LiveLocationView state={raw} center={SEOUL} placeName="경복궁" />);

    expect(screen.getByTestId('live-location-manual')).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-permission-denied')).toBeNull();
    expect(screen.getByText(/위치를 확인할 수 없어/)).toBeOnTheScreen();
    expect(screen.getByTestId('center-pin-picker')).toBeOnTheScreen();
  });
});

describe('🔴 AC-B6 · INV-3 — 어느 얼굴·상태에도 소요·대기 시간 문구가 없다', () => {
  it.each([
    [
      'manual',
      SEOUL,
      '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요',
    ],
    ['permission-denied', SEOUL, '여행 기간에만 AI에게 맡길 수 있어요'],
    ['manual', null, null],
  ] as const)('%s · center=%j · error=%s', (state, center, errorText) => {
    render(
      <LiveLocationView
        state={state}
        center={center}
        placeName="경복궁"
        errorText={errorText}
      />
    );

    expect(screen.queryByText(DURATION)).toBeNull();
  });
});
