import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useGetStaysReverseGeocode } from '@/shared/api/generated/stays/stays';
import type { MapCenter } from '@/shared/map';

import { LiveLocationPage } from './LiveLocationPage';

/**
 * TRIP-442·866 · AC-2·AC-3·AC-4·AC-9 — i20(수동 입력)·i21(권한 거부) 얼굴 + **중앙 고정 핀** 전환.
 *
 * 무엇을 보장하나(초심자용): **한 컴포넌트**를 `state` prop 하나로 두 얼굴로 그리고, 좌표 수집을
 * 옛 `<MapView>`(롱프레스 예정) 대신 **`CenterPinPicker`**(지도를 움직여 중앙 핀에 맞춤)로 한다.
 *  - onPick 으로 중심 좌표를 담고, `live-location-confirm` 을 눌러 확정 콜백(onConfirm)에 넘긴다.
 *  - ★ StayRegister 와 달리 **역지오코딩을 하지 않는다** — 여기선 좌표만 쓰고 주소는 안 쓴다(AC-9).
 *    `useGetStaysReverseGeocode` 목이 0회 호출됨을 잠가, 이 화면에 주소 조회가 새 들어오는 것을 막는다.
 *
 * 3동작: 준비(state·onConfirm 으로 render) → 실행(onPick 발화·confirm press) → 단언(얼굴·콜백·0회).
 *
 * ★ 문구 단언은 **정규식 부분일치**다 — 문자열 matcher 는 완전일치라(RNTL) 아이콘+텍스트 한
 *   노드에서 깨진다. 특징 구절만 잠근다.
 * ★ 지도 실 pan·"(추정)" i20 선택값은 가짜 SDK/실기 몫(AC-6). 여기서는 center-pin-picker **마운트**와
 *   onPick 배선까지만 본다.
 * ★ 구현 전에는 화면이 `<MapView>` 를 쓰고 confirm 콜백이 없어 center-pin-picker·live-location-confirm
 *   이 없으므로 그 축이 red 다.
 */

// `@/shared/map` 을 목으로 — CenterPinPicker 가 onPick 을 host 로 통과해 테스트가 직접 발화한다.
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

describe('LiveLocationPage — i20 수동 입력 얼굴 (state=manual)', () => {
  it('manual 얼굴을 그리고 permission-denied 루트는 없다(상호배타)', () => {
    render(<LiveLocationPage tripId="trip-1" state="manual" />);

    expect(screen.getByTestId('live-location-manual')).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-permission-denied')).toBeNull();
  });

  it('i20 배너·공통 subline·중립 건너뛰기 문구·지도(중앙 고정 핀)를 그린다', () => {
    render(<LiveLocationPage tripId="trip-1" state="manual" />);

    expect(screen.getByText(/위치를 확인할 수 없어/)).toBeOnTheScreen();
    expect(screen.getByText(/추정 출발지로 사용돼요/)).toBeOnTheScreen();
    expect(
      screen.getByTestId('live-location-use-last-visit')
    ).toBeOnTheScreen();
    expect(
      screen.getByText(/마지막 방문지나 등록 숙소 기준/)
    ).toBeOnTheScreen();
    // 지도 마운트가 이제 CenterPinPicker 다(옛 map-root 아님).
    expect(screen.getByTestId('center-pin-picker')).toBeOnTheScreen();
  });
});

describe('LiveLocationPage — i21 권한 거부 얼굴 (state=permission-denied)', () => {
  it('permission-denied 얼굴을 그리고 manual 루트는 없다(상호배타)', () => {
    render(<LiveLocationPage tripId="trip-1" state="permission-denied" />);

    expect(
      screen.getByTestId('live-location-permission-denied')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-manual')).toBeNull();
  });

  it('권한 거부 배너 + 등록 숙소 기준(추정) 프리시드 + 지도(중앙 고정 핀)를 그린다', () => {
    render(<LiveLocationPage tripId="trip-1" state="permission-denied" />);

    expect(screen.getByText(/위치 권한이 꺼져 있어/)).toBeOnTheScreen();
    expect(screen.getByText(/등록 숙소 기준\s*\(추정\)/)).toBeOnTheScreen();
    expect(screen.getByTestId('center-pin-picker')).toBeOnTheScreen();
  });
});

describe('🔴 AC-9 · i20 좌표 확정 — 중심좌표를 확정 콜백으로, 역지오코딩은 0회', () => {
  it('지도를 움직여 확정 버튼을 누르면 그 중심좌표가 onConfirm 으로 가고, 주소 조회는 없다', () => {
    const onConfirm = jest.fn();
    render(
      <LiveLocationPage tripId="trip-1" state="manual" onConfirm={onConfirm} />
    );

    // 지도를 움직여 멈춤 → 좌표 담김(lat≠lng 로 축 스왑 방지).
    panTo({ lat: 35.1, lng: 129.1 });

    // 확정 버튼 → 담긴 중심좌표가 확정 콜백으로 그대로 전달된다.
    fireEvent.press(screen.getByTestId('live-location-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ lat: 35.1, lng: 129.1 });

    // ★ 헤드라인 — LiveLocation 은 좌표만 쓴다. 역지오코딩 훅이 단 한 번도 호출되면 안 된다
    //   (StayRegister 와의 단일 경로 구분 — 여기에 주소 조회가 새 들어오는 회귀를 잡는다).
    expect(mockReverse).toHaveBeenCalledTimes(0);
  });
});

describe('🔴 TRIP-979 AC-A7 · state 미지정·미지 값은 manual 얼굴로 폴백한다 (INV-4)', () => {
  // 라우트는 URL `?state=` 원문을 검증 없이 내린다 — 빠지면 undefined, 오타면 아무 문자열,
  // 같은 키가 두 번이면 배열(expo-router 검색 파라미터 모양)이 온다.
  it.each([
    ['미지정(undefined)', undefined],
    ["미지 값('foo')", 'foo'],
    ["배열(['manual'])", ['manual']],
  ])('%s 이면 던지지 않고 manual 얼굴을 그린다', (_label, raw) => {
    render(<LiveLocationPage tripId="trip-1" state={raw} />);

    expect(screen.getByTestId('live-location-manual')).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-permission-denied')).toBeNull();
    expect(screen.getByText(/위치를 확인할 수 없어/)).toBeOnTheScreen();
    expect(screen.getByTestId('center-pin-picker')).toBeOnTheScreen();
    // INV-3 — 폴백 얼굴 어디에도 소요시간 문구가 없다.
    expect(screen.queryByText(/\d+\s*(분|시간)|소요/)).toBeNull();
  });
});
