import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PreferenceView } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-205 g01 1/2 배선 — 스토어 ↔ 화면 ↔ 라우터를 한 줄기로 잇는다.
 *
 * 무엇을 보장하나: 화면이 올려보낸 탭이 실제로 드래프트를 바꾸고 그 결과가 화면에 되비치며
 * (왕복), `[다음]`의 활성 여부가 **`validateTripDraft` 결과 그대로** 갈리고, 화면을 떠났다
 * 돌아와도 입력이 남는다(AC-11). 그리고 **배선을 통과한 실제 화면에도 오류 문구가 없다**
 * (AC-10c — 화면 단위 테스트가 놓칠 수 있는 "페이지가 위반을 몰래 내려보내는" 경로를 여기서 막는다).
 *
 * 커버하지 않는 것: 프레젠테이션 세부(문구·칩 배치)는 `TripWizardStep1Screen.test.tsx`가
 * 이미 본다. 여기서 보는 것은 그 밖의 것 — 스토어 반영·게이트 판정·기준일 주입·재진입.
 *
 * 왜 통합 버킷이 아닌가: 이 칸은 서버를 부르지 않는다(제출은 TRIP-206). 유일한 네트워크
 * 훅 `usePreferencePrefill`은 실 요청 경로를 `useCreateTrip.integration.test.tsx`가 이미
 * 덮었으므로 여기서는 모듈째 목킹해 node 버킷에 남긴다(`PrefStep1Page.test.tsx`와 같은 형태).
 *
 * ⚠️ `jest.mock` 팩토리는 파일 최상단으로 끌어올려진다. 팩토리가 참조하는 바깥 변수는
 * 이름이 `mock`으로 시작해야 예외를 받는다 — **아래 변수 이름을 바꾸지 마라**(리포 확립 규칙).
 */

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

let mockPreference: PreferenceView | undefined;

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: mockPreference }),
}));

/** 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다(01b D5). */
const BASE = '2026-06-10';

/** 도시 추가 시트를 열어 지역 하나를 N박으로 확정하는 3동작 묶음. */
function addDestination(regionCode: string, nights: number): void {
  fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
  fireEvent.press(
    screen.getByTestId(`trip-wizard-destination-region-${regionCode}`)
  );
  // 시트의 박수 기본값은 1이다.
  for (let i = 1; i < nights; i += 1) {
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
  }
  fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));
}

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

beforeEach(() => {
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트가 남긴 값으로 AC-11이 거짓 green이 된다.
  useTripWizardStore.getState().reset();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
  routerMock.replace.mockClear();
  mockPreference = {
    styles: { value: ['미식', '전시'] },
    activities: { value: ['야경'] },
  };
});

describe('AC-10b · AC-10c · 진입 직후', () => {
  it('[다음]이 비활성이고 인원은 1명이다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(screen.getByTestId('trip-wizard-step1-next')).toBeDisabled();
    expect(screen.getByTestId('trip-wizard-party-stepper')).toHaveTextContent(
      /1명/
    );
  });

  it('배선을 통과한 화면에도 오류 문구가 하나도 없다 (AC-10c)', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // 화면 단위 테스트는 "화면이 위반 prop을 안 받는다"까지만 보증한다. 페이지가 우회로
    // 문자열을 만들어 내려보내는 경로는 여기서만 잡힌다.
    expect(root()).not.toHaveTextContent(
      /NO_DESTINATION|END_BEFORE_START|NIGHTS_EXCEED_PERIOD|PARTY_BELOW_ONE/
    );
    expect(root()).not.toHaveTextContent(/빨라요|많아요|다시 확인해주세요/);

    // 짝(긍정) — 화면이 실제로 그려졌고 게이트는 닫혀 있다(빈 렌더가 위를 공짜로
    // 통과하는 것을 막는다).
    expect(root()).toHaveTextContent(/어디로 갈까요\?/);
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeDisabled();
  });
});

describe('AC-3 · AC-4 · 여행지 왕복', () => {
  it('시트에서 고른 도시가 화면의 칩과 스토어에 함께 반영된다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    addDestination('busan', 2);

    // 화면 — 탭이 실제로 다시 그리게 만들었다(셀렉터 구독 배선의 증거).
    const chip = screen.getByTestId('trip-wizard-destination-busan');
    expect(chip).toHaveTextContent(/부산/);
    expect(chip).toHaveTextContent(/2박/);

    // 스토어 — 서버 계약 형태 그대로다(`region`은 한글 이름, `seq`는 1부터).
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 2 },
    ]);
  });
});

describe('AC-5 · 프리셋이 주입된 기준일로 날짜를 채운다', () => {
  it('3박 4일을 고르면 기준일 2026-06-10 기준 범위가 보인다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));

    // 실행일이 언제든 같은 값이다 — 화면도 페이지도 시계를 읽지 않고 주입값만 쓴다.
    expect(screen.getByTestId('trip-wizard-date-field')).toHaveTextContent(
      /6월 10일 – 6월 13일/
    );
    expect(useTripWizardStore.getState().startDate).toBe('2026-06-10');
  });
});

describe('AC-10a · AC-10b · [다음] 게이트가 validateTripDraft 결과로 갈린다', () => {
  it('여행지와 날짜를 채우면 열린다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // 부산 3박 + 3박 4일 = 박수 합 3 ≤ 기간 3 → 위반 없음.
    addDestination('busan', 3);
    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));

    expect(screen.getByTestId('trip-wizard-step1-next')).toBeEnabled();
  });

  it('박수 합이 기간을 넘으면 닫힌 채로 남고 눌러도 이동하지 않는다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // 부산 5박인데 기간은 3박 → NIGHTS_EXCEED_PERIOD(BR-U1-34 · INV-U1-14).
    addDestination('busan', 5);
    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));

    const next = screen.getByTestId('trip-wizard-step1-next');
    // 두 단언이 짝이다 — 접근성 상태만 회색인 버튼은 매처를 통과하면서 눌린다(02a ★1).
    expect(next).toBeDisabled();
    fireEvent.press(next);
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});

describe('AC-7 · AC-8 · 인원과 동반 유형', () => {
  it('1명에서 −를 눌러도 1명 아래로 내려가지 않는다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-party-stepper-dec'));

    // 화면에 보이는 값으로 본다 — 비활성 버튼의 press가 부모로 올라가 값이 바뀌는
    // 경로까지 여기서 잡힌다(02a ★4).
    expect(screen.getByTestId('trip-wizard-party-stepper')).toHaveTextContent(
      /1명/
    );
    expect(useTripWizardStore.getState().party).toBe(1);
  });

  it('동반 유형은 마지막에 고른 하나만 남는다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-companion-partner'));
    fireEvent.press(screen.getByTestId('trip-wizard-companion-family'));

    expect(useTripWizardStore.getState().companionType).toBe('가족');
    expect(screen.getByTestId('trip-wizard-companion-family')).toBeSelected();
    expect(
      screen.getByTestId('trip-wizard-companion-partner')
    ).not.toBeSelected();
  });
});

describe('AC-9 · 취향 프리필 (BR-U1-38)', () => {
  it('계정 취향 응답의 값이 카드 칩으로 그대로 보인다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    ['미식', '전시', '야경'].forEach((chip) => {
      expect(screen.getByText(chip)).toBeTruthy();
    });
  });

  it('취향 응답이 아직 없어도 화면이 죽지 않는다', () => {
    mockPreference = undefined;
    render(<TripNewStep1Page baseDate={BASE} />);

    // 카드는 남고 값만 빈다(리포 확립 규칙 — 카드는 유지하고 집계 값만 생략).
    expect(screen.getByTestId('trip-wizard-pref-card')).toBeTruthy();
    expect(screen.queryByText('미식')).toBeNull();
  });
});

describe('AC-11 · 떠났다 돌아와도 입력이 남는다 (BR-U1-33)', () => {
  it('화면을 내렸다 다시 올려도 여행지·날짜·인원이 그대로다', () => {
    const first = render(<TripNewStep1Page baseDate={BASE} />);

    addDestination('busan', 2);
    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));
    fireEvent.press(screen.getByTestId('trip-wizard-party-stepper-inc'));
    fireEvent.press(screen.getByTestId('trip-wizard-party-stepper-inc'));

    // 실행 — 화면을 통째로 내렸다가 새로 올린다(뒤로 갔다 돌아온 것과 같은 상황).
    first.unmount();
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(
      screen.getByTestId('trip-wizard-destination-busan')
    ).toHaveTextContent(/2박/);
    expect(screen.getByTestId('trip-wizard-date-field')).toHaveTextContent(
      /6월 10일 – 6월 13일/
    );
    expect(screen.getByTestId('trip-wizard-party-stepper')).toHaveTextContent(
      /3명/
    );
  });

  it('짝 — reset 뒤에 다시 올리면 빈 상태로 돌아온다', () => {
    const first = render(<TripNewStep1Page baseDate={BASE} />);
    addDestination('busan', 2);
    first.unmount();

    // 위 보존 단언이 "아무도 안 지웠을 뿐"이 아니라 **지울 수단이 있는데도 남았다**임을 보인다.
    useTripWizardStore.getState().reset();
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(screen.queryByTestId('trip-wizard-destination-busan')).toBeNull();
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeDisabled();
  });
});
