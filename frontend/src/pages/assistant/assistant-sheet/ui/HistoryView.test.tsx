import { fireEvent, render, screen } from '@testing-library/react-native';

import { sampleActionLogs } from '../api/assistantSamples';
import { HistoryView, type HistoryViewProps } from './HistoryView';

/**
 * TRIP-1325 · b06 · BR-U8-17~21 — 시트 안 이력 보기. 이력 지우기 확인 다이얼로그는 라이브러리 없는 오버레이라
 * 실제 덮임·터치 차단은 jest 사각(repo-traps) — testID 트리 + 확정 전 호출 0회까지만 잰다.
 */

function renderView(overrides: Partial<HistoryViewProps> = {}) {
  const props: HistoryViewProps = {
    logs: sampleActionLogs(),
    otherSessions: [],
    confirmingClear: false,
    clearing: false,
    onContinue: jest.fn(),
    onRequestClear: jest.fn(),
    onConfirmClear: jest.fn(),
    onCancelClear: jest.fn(),
    onOpenSession: jest.fn(),
    ...overrides,
  };
  render(<HistoryView {...props} />);
  return props;
}

describe('HistoryView (TRIP-1325)', () => {
  it('적용 기록 2건이면 행 2개', () => {
    renderView();
    expect(screen.getByTestId('assistant-history')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-history-row-log-1')).toHaveTextContent(
      '오늘 14:10 · 숙소 다시 찾기',
      { exact: false }
    );
    expect(screen.getByTestId('assistant-history-row-log-2')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/assistant-history-row-/)).toHaveLength(2);
  });

  it('기록이 없으면 빈 안내', () => {
    renderView({ logs: [] });
    expect(screen.getByTestId('assistant-history-empty')).toBeOnTheScreen();
  });

  it('[대화 이어서] → onContinue, [이력 지우기] → 확인 요청(아직 지우지 않는다)', () => {
    const props = renderView();
    fireEvent.press(screen.getByTestId('assistant-history-continue'));
    fireEvent.press(screen.getByTestId('assistant-history-clear'));
    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(props.onRequestClear).toHaveBeenCalledTimes(1);
    expect(props.onConfirmClear).not.toHaveBeenCalled();
  });

  it('확인 다이얼로그 — [지우기]만 확정, [취소]는 확정 0회', () => {
    const props = renderView({ confirmingClear: true });
    expect(
      screen.getByTestId('assistant-history-clear-dialog')
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('assistant-history-clear-cancel'));
    expect(props.onConfirmClear).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('assistant-history-clear-confirm'));
    expect(props.onConfirmClear).toHaveBeenCalledTimes(1);
  });

  it('이전 여행 대화 — 누르면 그 세션의 여행으로 연다', () => {
    const props = renderView({
      otherSessions: [
        {
          id: 'session-x',
          tripId: 'trip-x',
          tripTitle: '제주 여행',
          lastTurnAt: '',
        },
      ],
    });
    fireEvent.press(screen.getByTestId('assistant-history-session-session-x'));
    expect(props.onOpenSession).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: 'trip-x' })
    );
  });
});
