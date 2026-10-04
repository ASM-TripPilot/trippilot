import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { TripDestination } from '@/shared/api/index.schemas';

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
    onClose: jest.fn(), // TRIP-683: 딤 바깥 탭 닫힘 콜백(필수 prop 화)
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

describe('AC-2 · 다도시에서 − 는 nights===1 이면 진짜 disabled (01b D1)', () => {
  it('disabled 매처 + press 무반응 + 콜백 0회 3단', () => {
    const spies = renderSheet([
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '경주', nights: 1 },
    ]);

    const dec = screen.getByTestId('trip-wizard-destination-nights-dec-2');
    expect(dec).toBeDisabled();

    // 진짜 disabled prop 이면 press 가 안 먹는다(accessibilityState 만 세운 가짜는 여기서 red).
    fireEvent.press(dec);
    expect(spies.onChangeNights).not.toHaveBeenCalled();

    // 짝(긍정) — + 는 여전히 활성이라 눌린다(1 → 2).
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc-2'));
    expect(spies.onChangeNights).toHaveBeenCalledWith(2, 2);
  });
});

describe('0박 결정 · 도시가 하나면 − 가 0박(당일치기)까지 내려간다', () => {
  it('1박에서 − 는 활성이고 눌리면 (seq, 0) 으로 콜백한다', () => {
    const spies = renderSheet([{ seq: 1, region: '부산', nights: 1 }]);

    const dec = screen.getByTestId('trip-wizard-destination-nights-dec-1');
    expect(dec).not.toBeDisabled();

    fireEvent.press(dec);
    expect(spies.onChangeNights).toHaveBeenCalledWith(1, 0);
  });

  it('0박이면 라벨이 "당일치기"이고 − 는 진짜 disabled 다', () => {
    const spies = renderSheet([{ seq: 1, region: '부산', nights: 0 }]);

    const row = screen.getByTestId('trip-wizard-destination-row-1');
    expect(within(row).getByText('당일치기')).toBeOnTheScreen();
    expect(within(row).queryByText('0박')).toBeNull();

    const dec = screen.getByTestId('trip-wizard-destination-nights-dec-1');
    expect(dec).toBeDisabled();
    fireEvent.press(dec);
    expect(spies.onChangeNights).not.toHaveBeenCalled();
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

// TRIP-1093 결정 1 — 안내문의 N 은 꼭 갈 곳 수다(`mustVisits.length`). 옛 문구 "담은 곳"은 오표기였다(Figma 3626:2085).
describe('AC-6 · 꼭 갈 곳 안내문 (TRIP-736 · TRIP-1093 문구)', () => {
  // Arrange: mustVisitCount 를 명시해 다시 렌더하는 얇은 헬퍼(renderSheet 는 count 를 안 넘긴다).
  function renderWithCount(mustVisitCount?: number) {
    render(
      <DestinationEditSheet
        destinations={BUSAN2_GYEONGJU1}
        onChangeNights={jest.fn()}
        onRemove={jest.fn()}
        onAddCity={jest.fn()}
        onApply={jest.fn()}
        onClose={jest.fn()}
        mustVisitCount={mustVisitCount}
      />
    );
  }

  // 두 값(7·3)을 각각 태워 "N 이 하드코딩이 아니라 입력을 반영한다"까지 잠근다(code-critic 참고-1).
  it.each([7, 3])('count=%i 이면 그 수가 그대로 안내문에 박힌다', (count) => {
    renderWithCount(count);

    const note = screen.getByTestId('trip-wizard-destination-note');
    expect(note).toBeOnTheScreen();
    expect(note).toHaveTextContent(
      `꼭 갈 곳 ${count}곳이 여행지에 맞춰 정리돼요`
    );
  });

  it('count 가 0 이면 안내문을 안 그린다 (Figma 근거 없음 §F)', () => {
    renderWithCount(0);
    expect(
      screen.queryByTestId('trip-wizard-destination-note')
    ).not.toBeOnTheScreen();
  });

  it('count 를 안 넘기면(undefined) 안내문을 안 그린다', () => {
    renderWithCount(undefined);
    expect(
      screen.queryByTestId('trip-wizard-destination-note')
    ).not.toBeOnTheScreen();
  });
});

/**
 * TRIP-1210 — 도시 하나 제한(임시 게이트)을 걷었다. 서버가 날짜별로 도시를 나눠 주게 됐다(#932).
 * 이제 몇 곳이 담겨 있든 "도시 추가"는 지역 피커로 가는 신호(onAddCity)를 올리고, "준비 중" 안내는 없다.
 * (옛 계약 — 1곳 이상이면 추가를 막고 안내 — 은 이 describe 가 뒤집었다.)
 */
describe('TRIP-1210 · 도시를 여럿 담을 수 있다 (게이트 해제)', () => {
  const OLD_NOTICE = /여러 도시 여행은 준비 중/;

  it.each([
    ['0곳', []],
    ['1곳', [{ seq: 1, region: '서울특별시', nights: 1 }]],
    ['2곳', BUSAN2_GYEONGJU1],
    [
      '3곳',
      [
        { seq: 1, region: '서울특별시', nights: 1 },
        { seq: 2, region: '부산광역시', nights: 1 },
        { seq: 3, region: '경주시', nights: 1 },
      ],
    ],
  ] as [string, TripDestination[]][])(
    '%s 담긴 상태에서 "도시 추가"를 누르면 onAddCity 가 1번 불리고 준비 중 안내는 없다',
    (_label, destinations) => {
      // 준비
      const spies = renderSheet(destinations);
      const add = screen.getByTestId('trip-wizard-destination-add');
      expect(add).not.toBeDisabled();

      // 실행
      fireEvent.press(add);

      // 단언
      expect(spies.onAddCity).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId('trip-wizard-destination-one-city-notice')
      ).toBeNull();
      expect(screen.queryByText(OLD_NOTICE)).toBeNull();
    }
  );
});

/**
 * TRIP-1210 — 도시를 여럿 담게 되면서 새로 생긴 길: 박수 합이 이미 30박인데 도시를 더 담으면 31박이 된다
 * (새 도시는 최소 1박). 그래서 30박이면 "도시 추가"도 [+]처럼 진짜로 막고, 안내는 기존 '최대 30박' 문구
 * 하나를 그대로 쓴다(01b 결정 3 — 새 문구 금지).
 */
describe('TRIP-1210 · 박수 합이 30박이면 도시 추가도 막힌다 (기존 상한 안내 재사용)', () => {
  it.each([
    [
      '두 도시 20+10',
      [
        { seq: 1, region: '부산광역시', nights: 20 },
        { seq: 2, region: '경주시', nights: 10 },
      ],
    ],
    ['한 도시 30', [{ seq: 1, region: '서울특별시', nights: 30 }]],
  ] as [string, TripDestination[]][])(
    '%s박이면 "도시 추가"가 진짜 disabled — press 해도 onAddCity 0회, 상한 안내는 한 줄뿐이다',
    (_label, destinations) => {
      // 준비
      const spies = renderSheet(destinations);
      const add = screen.getByTestId('trip-wizard-destination-add');

      // 실행 — disabled 매처 + press + 콜백 0회 3단(가짜 disabled 는 press 가 먹는다).
      expect(add).toBeDisabled();
      fireEvent.press(add);

      // 단언
      expect(spies.onAddCity).not.toHaveBeenCalled();
      expect(
        screen.getByTestId('trip-wizard-destination-max-note')
      ).toHaveTextContent('최대 30박까지 정할 수 있어요');
      // 새 문구를 만들지 않았다 — 상한을 말하는 글은 기존 안내 하나뿐이다(행 라벨 "30박"은 안 걸리게 고른 낱말).
      expect(screen.getAllByText(/최대|넘|더 담을 수/)).toHaveLength(1);
    }
  );

  it('29박이면 "도시 추가"가 살아 있고 상한 안내는 없다 (경계 바로 아래)', () => {
    const spies = renderSheet([
      { seq: 1, region: '부산광역시', nights: 20 },
      { seq: 2, region: '경주시', nights: 9 },
    ]);

    expect(screen.queryByTestId('trip-wizard-destination-max-note')).toBeNull();
    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
    expect(spies.onAddCity).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-1219 a · 박수 상한', () => {
  it('박수 합이 30이면 모든 [+]가 진짜 disabled — press 해도 콜백 0회, 안내가 보인다', () => {
    const spies = renderSheet([
      { seq: 1, region: '부산', nights: 20 },
      { seq: 2, region: '경주', nights: 10 },
    ]);

    const inc1 = screen.getByTestId('trip-wizard-destination-nights-inc-1');
    expect(inc1).toBeDisabled();
    fireEvent.press(inc1);
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc-2'));
    expect(spies.onChangeNights).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('trip-wizard-destination-max-note')
    ).toHaveTextContent('최대 30박까지 정할 수 있어요');
  });

  it('상한 미만이면 [+]가 살아 있고 안내는 없다 (29박)', () => {
    const spies = renderSheet([{ seq: 1, region: '부산', nights: 29 }]);

    expect(
      screen.queryByTestId('trip-wizard-destination-max-note')
    ).not.toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc-1'));
    expect(spies.onChangeNights).toHaveBeenCalledWith(1, 30);
  });
});
