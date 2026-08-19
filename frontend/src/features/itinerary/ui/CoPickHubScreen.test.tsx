import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { CoPickHubScreen } from './CoPickHubScreen';

/**
 * h16 슬롯 채우기 허브 — 순수(진행 판정은 props 로만 받는다, 재판정 금지).
 *
 * 무엇을 보장하나:
 *  - AC-6: 진행 카운터("N/M 슬롯 선택됨 · 남은 K개")를 props(progress)로만 그린다.
 *          슬롯 상태(찬/빈/고정)는 색이 아니라 텍스트로 관찰.
 *  - E2: "고른 일정 확정" CTA 는 remaining>0 이면 disabled + onPress 미부여(부분 확정 불허).
 */

const SLOTS = [
  {
    slotKey: '2026-06-10#p1',
    bandLabel: '오전 · 활동',
    name: '광안리 해변',
    status: 'filled' as const,
  },
  {
    slotKey: '2026-06-10#',
    bandLabel: '오후 · 전시/문화',
    name: '3개 후보 중 선택',
    status: 'empty' as const,
  },
  {
    slotKey: '2026-06-10#hotel',
    bandLabel: '저녁 · 숙소',
    name: '해운대 OO호텔',
    status: 'fixed' as const,
    fixedTimeLabel: '21:00 도착 · 변경 불가',
  },
];

function renderScreen(overrides: Record<string, unknown> = {}) {
  const spies = {
    onPickSlot: jest.fn(),
    onChangeSlot: jest.fn(),
    onConfirm: jest.fn(),
    onBack: jest.fn(),
  };
  render(
    <CoPickHubScreen
      slots={SLOTS}
      progress={{ total: 5, filled: 3, remaining: 2 }}
      {...spies}
      {...overrides}
    />
  );
  return spies;
}

describe('🔴 CoPickHubScreen (h16)', () => {
  it('C1 · AC-6 진행 카운터를 props 로만 그린다(3/5 · 남은 2)', () => {
    renderScreen();

    // 단언: 문장 안 조각이라 정규식(공백 허용).
    const progress = screen.getByTestId('itinerary-copick-hub-progress');
    expect(progress).toHaveTextContent(/3\s*\/\s*5/);
    expect(progress).toHaveTextContent(/남은\s*2/);
  });

  it('C2 · 슬롯 행 상태를 텍스트로 관찰(찬=변경 · 빈=고르기 · 고정=고정)', () => {
    renderScreen();

    const filled = within(
      screen.getByTestId('itinerary-copick-hub-slot-2026-06-10#p1')
    );
    const empty = within(
      screen.getByTestId('itinerary-copick-hub-slot-2026-06-10#')
    );
    const fixed = within(
      screen.getByTestId('itinerary-copick-hub-slot-2026-06-10#hotel')
    );
    expect(filled.getByText(/변경/)).toBeTruthy();
    expect(empty.getByText(/고르기/)).toBeTruthy();
    expect(fixed.getByText(/고정/)).toBeTruthy();
  });

  it('C3 · E2 remaining>0 이면 확정 CTA disabled + press 무발화', () => {
    const { onConfirm } = renderScreen({
      progress: { total: 5, filled: 3, remaining: 2 },
    });

    const confirm = screen.getByTestId('itinerary-copick-hub-confirm');
    expect(confirm.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(0);
  });

  it('C4 · E2 remaining=0 이면 확정 CTA 활성 · press → onConfirm', () => {
    const { onConfirm } = renderScreen({
      progress: { total: 5, filled: 5, remaining: 0 },
    });

    const confirm = screen.getByTestId('itinerary-copick-hub-confirm');
    expect(confirm.props.accessibilityState?.disabled).not.toBe(true);
    fireEvent.press(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('C5 · 슬롯 이동 콜백 — 빈=onPickSlot · 찬=onChangeSlot', () => {
    const { onPickSlot, onChangeSlot } = renderScreen();

    // 빈 슬롯 "고르기".
    fireEvent.press(
      within(
        screen.getByTestId('itinerary-copick-hub-slot-2026-06-10#')
      ).getByText(/고르기/)
    );
    expect(onPickSlot).toHaveBeenCalledWith('2026-06-10#');

    // 찬 슬롯 "변경".
    fireEvent.press(
      within(
        screen.getByTestId('itinerary-copick-hub-slot-2026-06-10#p1')
      ).getByText(/변경/)
    );
    expect(onChangeSlot).toHaveBeenCalledWith('2026-06-10#p1');
  });
});
