import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import Svg from 'react-native-svg';

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
    onClose: jest.fn(),
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

  // TRIP-1529 — 안내 문장은 말풍선·✦ 아바타 없이 평문. 부재는 testID 로 못 잡으니 "안내 블록 루트 안 Svg 0개"로 잰다.
  it('안내 문장은 평문 블록이고 그 안에 ✦ 아바타(Svg)가 없다', () => {
    renderView();
    const intro = screen.getByTestId('assistant-history-intro');
    expect(intro).toHaveTextContent(
      '이번 여행에서 도우미와 한 대화·변경이에요.'
    );
    expect(within(intro).UNSAFE_queryAllByType(Svg)).toHaveLength(0);
  });

  it('칩 줄은 [대화 이어서]·[이력 지우기]·[닫기] 세 개이고 입력 카드·quick reply 는 없다', () => {
    renderView();
    expect(screen.getByTestId('assistant-history-continue')).toHaveTextContent(
      '대화 이어서'
    );
    expect(screen.getByTestId('assistant-history-clear')).toHaveTextContent(
      '이력 지우기'
    );
    expect(screen.getByTestId('assistant-history-close')).toHaveTextContent(
      '닫기'
    );
    expect(screen.queryByTestId('assistant-input')).toBeNull();
    expect(screen.queryAllByTestId(/^assistant-quick-reply-/)).toHaveLength(0);
  });

  it('[닫기] → onClose 1회, 이어서·지우기 요청은 부르지 않는다', () => {
    const props = renderView();
    fireEvent.press(screen.getByTestId('assistant-history-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onContinue).not.toHaveBeenCalled();
    expect(props.onRequestClear).not.toHaveBeenCalled();
  });
});
