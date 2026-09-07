import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { TripDestination } from '@/shared/api/generated/schemas';

import { DestinationEditSheet } from './DestinationEditSheet';

/**
 * TRIP-666 g01 여행지 편집 바텀시트 — **props-only 프레젠테이션**(01b D5).
 *
 * 무엇을 보장하나: 시트가 넘겨받은 destinations 를 행마다(도시명·"N박"·+/−·삭제×) 그리고,
 * 스테퍼/삭제/도시추가/적용 press 를 **받은 콜백으로 정확히** 올린다. 개폐 상태·스토어는 배선
 * (TripNewStep1Page) 소유라 이 컴포넌트는 신호만 위로 보낸다 — 여기선 jest.fn 스파이로 그 신호를 잰다.
 *
 * 왜 콜백 스파이인가: 즉시 스토어 반영(D3)은 페이지가 `onChangeNights={setNights}` 로 배선해 성립한다.
 * 시트 자체는 스토어를 모른다(props-only). 그래서 이 파일은 "시트가 무엇을, 어떤 인자로 부르는가"까지만
 * 잠그고, 실제 스토어 반영은 페이지 통합 테스트(다른 파일)가 잠근다.
 *
 * ⚠️ 바텀시트 통과형 목(`__mocks__/@gorhom/bottom-sheet.tsx`): 마운트하면 children 을 무조건 렌더한다.
 * 그래서 트리 존재·콜백까지만 관측 가능 — 실제 개폐·딤·중앙정렬·터치차단은 jest 원리적 사각(6-b 실기).
 *
 * ⚠️ `−` 비활성(nights===1)은 `toBeDisabled()` 단독이 아니라 **매처 + press + 콜백 0회 3단**으로 잠근다:
 * 진짜 `disabled` prop 은 press 를 막지만 accessibilityState 만 세운 가짜는 press 가 그대로 발화한다
 * (실측 02a §5-1 — [[disabled prop과 accessibilityState]]).
 */

const BUSAN2_GYEONGJU1: TripDestination[] = [
  { seq: 1, region: '부산', nights: 2 },
  { seq: 2, region: '경주', nights: 1 },
];

function renderSheet(destinations: TripDestination[]) {
  const spies = {
    onChangeNights: jest.fn(),
    onRemove: jest.fn(),
    onAddCity: jest.fn(),
    onApply: jest.fn(),
  };
  render(<DestinationEditSheet destinations={destinations} {...spies} />);
  return spies;
}

describe('AC-1 · 도시 행 렌더', () => {
  it('행마다 도시명·"N박"·+/−·삭제× 를 그리고, 도시 추가·적용 버튼이 있다', () => {
    renderSheet(BUSAN2_GYEONGJU1);

    // 컨테이너
    expect(
      screen.getByTestId('trip-wizard-destination-sheet')
    ).toBeOnTheScreen();

    // 행 1 — 부산 2박 + 세 컨트롤
    const row1 = screen.getByTestId('trip-wizard-destination-row-1');
    expect(within(row1).getByText('부산')).toBeOnTheScreen();
    expect(within(row1).getByText('2박')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-destination-nights-inc-1')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-destination-nights-dec-1')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-destination-remove-1')
    ).toBeOnTheScreen();

    // 행 2 — 경주 1박
    const row2 = screen.getByTestId('trip-wizard-destination-row-2');
    expect(within(row2).getByText('경주')).toBeOnTheScreen();
    expect(within(row2).getByText('1박')).toBeOnTheScreen();

    // 도시 추가(캐논 testID) + 적용
    expect(screen.getByTestId('trip-wizard-destination-add')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-destination-apply')
    ).toBeOnTheScreen();
  });
});

describe('AC-2 · 스테퍼 증감 → onChangeNights(seq, nights±1)', () => {
  it('+/− 가 해당 seq 의 절대 박수(현재±1)로 콜백하고, 다른 행과 안 섞인다 (교차 seq 잠금)', () => {
    const spies = renderSheet(BUSAN2_GYEONGJU1);

    // + row1 (2 → 3)
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc-1'));
    expect(spies.onChangeNights).toHaveBeenLastCalledWith(1, 3);

    // + row2 (1 → 2) — seq 2 로 정확히 간다(뒤바꾼 구현이 red)
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc-2'));
    expect(spies.onChangeNights).toHaveBeenLastCalledWith(2, 2);

    // − row1 (2 → 1) — nights 2 라 활성
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-dec-1'));
    expect(spies.onChangeNights).toHaveBeenLastCalledWith(1, 1);
  });
});

describe('AC-2 · − 는 nights===1 이면 진짜 disabled (01b D1)', () => {
  it('disabled 매처 + press 무반응 + 콜백 0회 3단', () => {
    const spies = renderSheet([{ seq: 1, region: '부산', nights: 1 }]);

    const dec = screen.getByTestId('trip-wizard-destination-nights-dec-1');
    expect(dec).toBeDisabled();

    // 진짜 disabled prop 이면 press 가 안 먹는다(accessibilityState 만 세운 가짜는 여기서 red).
    fireEvent.press(dec);
    expect(spies.onChangeNights).not.toHaveBeenCalled();

    // 짝(긍정) — + 는 여전히 활성이라 눌린다(1 → 2).
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc-1'));
    expect(spies.onChangeNights).toHaveBeenCalledWith(1, 2);
  });
});

describe('AC-3 · 도시 추가 → onAddCity', () => {
  it('"도시 추가" press 가 onAddCity 를 한 번 부른다 (편집 콜백은 안 부른다)', () => {
    const spies = renderSheet(BUSAN2_GYEONGJU1);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    expect(spies.onAddCity).toHaveBeenCalledTimes(1);
    // 짝 — 도시 추가는 박수/삭제를 건드리지 않는다.
    expect(spies.onChangeNights).not.toHaveBeenCalled();
    expect(spies.onRemove).not.toHaveBeenCalled();
  });
});

describe('AC-4 · 적용 → onApply (닫기뿐, 커밋 없음)', () => {
  it('"적용" press 가 onApply 만 부르고 편집 콜백은 안 부른다 (즉시반영이라 재커밋 없음)', () => {
    const spies = renderSheet(BUSAN2_GYEONGJU1);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-apply'));

    expect(spies.onApply).toHaveBeenCalledTimes(1);
    expect(spies.onChangeNights).not.toHaveBeenCalled();
    expect(spies.onRemove).not.toHaveBeenCalled();
    expect(spies.onAddCity).not.toHaveBeenCalled();
  });
});

describe('AC-4/5 · 삭제× → onRemove(seq)', () => {
  it('같은 지역을 두 번 담아도 누른 seq 만 정확히 넘긴다 (TRIP-364 함정의 시트 층)', () => {
    const spies = renderSheet([
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '부산', nights: 5 },
    ]);

    // 두 번째 부산(seq 2)의 × — 이름/인덱스로 짚는 구현이 red.
    fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-2'));
    expect(spies.onRemove).toHaveBeenLastCalledWith(2);

    // 짝 — 첫 번째(seq 1)
    fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-1'));
    expect(spies.onRemove).toHaveBeenLastCalledWith(1);
  });
});
