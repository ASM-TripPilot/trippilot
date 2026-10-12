import { AssistantApiError } from '../api/assistantPort';
import { sampleSession } from '../api/assistantSamples';
import { resolveSheetState } from './resolveSheetState';

/** TRIP-1320 — 시트 상태 판정은 페이지에서 1회(frontend-components §3). 뷰는 재판정하지 않는다. */

describe('resolveSheetState (TRIP-1320)', () => {
  it('세션을 여는 중이면 LOADING', () => {
    expect(resolveSheetState({ status: 'pending', error: null })).toBe(
      'LOADING'
    );
  });

  it('여행 세션이 열리면 READY', () => {
    expect(
      resolveSheetState({
        status: 'success',
        error: null,
        session: sampleSession('t1'),
      })
    ).toBe('READY');
  });

  it('여행 없이 열리면 NO_CONTEXT(b07 — 비활성 아님, BR-U8-05)', () => {
    expect(
      resolveSheetState({
        status: 'success',
        error: null,
        session: sampleSession(null),
      })
    ).toBe('NO_CONTEXT');
  });

  it('열기 실패면 OPEN_FAILED(BR-U8-07)', () => {
    expect(
      resolveSheetState({
        status: 'error',
        error: new AssistantApiError('SERVER'),
      })
    ).toBe('OPEN_FAILED');
    expect(
      resolveSheetState({ status: 'error', error: new Error('net') })
    ).toBe('OPEN_FAILED');
  });

  it('401 이면 UNAUTHORIZED — 페이지가 시트를 닫는다', () => {
    expect(
      resolveSheetState({
        status: 'error',
        error: new AssistantApiError('UNAUTHORIZED'),
      })
    ).toBe('UNAUTHORIZED');
  });
});
