import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { PlanbDraftPage } from './PlanbDraftPage';

/**
 * TRIP-751 · AC-9·AC-10 · E1·E3·E4 · Seed Q6·Q7·Q8 — i06 재계획안 페이지 배선판.
 *
 * 무엇을 보장하나(세션 판정 1회 → 같은 뷰의 세 상태):
 *  - DRAFT → 뷰를 제목만(일차·날짜·곳 수·칩·행 없음 — E4 정직 degrade)으로 그리고 [직접 수정]/[적용하기].
 *  - [적용하기] → 확정 seam `useApplyReplan().mutate({tripId, sessionId}, { onSuccess })` 1회(E1 — diff
 *    확인 페이지를 거치지 않는다). onSuccess → 허브로 `router.replace` + `applied=sessionId`(Q7).
 *  - 확정 요청 중이면 [적용하기] 잠금, 실패면 같은 안내 자리에 "변경을 반영하지 못했어요"(Q6).
 *  - NO_SOLUTION·FAILED → 같은 뷰의 안내 상태. FAILED 에서 옛 manual?variant=error push 는 없다(E3).
 *    [조건 바꿔 다시 짜기]/[다시 시도] → i04(`/trips/{id}/planb`), [직접 수정] → planb/manual.
 *  - SOLVING·closed·미도착 → 아무것도 안 그린다.
 *
 * ★ 뷰를 스텁하지 않고 실제로 그린다(02a ★6) — 잠금·실패 안내를 렌더 결과로 본다. 시트·지도는
 *   루트 `__mocks__` 통과형 목이 받는다.
 * ★ jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다(이름이 mock 으로 시작하는 것만
 *   예외). 그래서 세션·seam 상태를 mock 접두 홀더에 담고 목이 렌더 때 지연 읽기 한다.
 */

const TRIP_ID = 't1';
const SESSION_ID = 's9';

const mockSession: { data: Record<string, unknown> | undefined } = {
  data: undefined,
};
jest.mock('@/features/planb/model/useReplanSession', () => ({
  useReplanSession: () => ({
    data: mockSession.data,
    isPending: mockSession.data === undefined,
    isError: false,
  }),
}));

const mockMutate = jest.fn();
const mockApply = { isPending: false, isError: false };
jest.mock('@/features/planb/model/useApplyReplan', () => ({
  useApplyReplan: () => ({
    mutate: mockMutate,
    isPending: mockApply.isPending,
    isError: mockApply.isError,
  }),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
}));

function session(status: string): Record<string, unknown> {
  return {
    sessionId: SESSION_ID,
    tripId: TRIP_ID,
    itineraryId: 'it1',
    scope: 'PARTIAL_SLOTS',
    fromInstant: '2026-06-11T06:00:00Z',
    originKind: 'GPS',
    originLat: 35.1587,
    originLng: 129.1604,
    originEstimated: false,
    status,
    createdAt: '2026-06-11T05:59:00Z',
  };
}

const MANUAL_HREF = {
  pathname: '/trips/[tripId]/planb/manual',
  params: { tripId: TRIP_ID },
};
const REQUEST_HREF = `/trips/${TRIP_ID}/planb`;

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockMutate.mockClear();
  mockApply.isPending = false;
  mockApply.isError = false;
  mockSession.data = undefined;
});

function renderPage() {
  render(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
}

describe('🔴 P1 · AC-9(a) · Q8 — DRAFT 는 제목만 있는 i06 을 그린다', () => {
  it('헤더는 제목만, 곳 수 빈칸, 행·칩·안내 없음, 버튼 [직접 수정]/[적용하기], 라우터·확정 호출 0', () => {
    mockSession.data = session('DRAFT');
    renderPage();

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.queryByTestId('sheet-header-day')).toBeNull();
    expect(screen.queryByTestId('sheet-header-date')).toBeNull();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('');
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(0);
    expect(screen.queryByTestId('sheet-daychip-0')).toBeNull();
    expect(screen.queryByTestId('planb-draft-notice')).toBeNull();
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '직접 수정'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
      '적용하기'
    );

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 P2·P3 · AC-9(b)(c) · E1·Q7 — [적용하기]는 바로 확정하고 성공하면 허브로 바꿔 끼운다', () => {
  it('누르면 seam mutate 가 {tripId, sessionId} + onSuccess 로 1회, diff 로 가는 push 는 없다', () => {
    mockSession.data = session('DRAFT');
    renderPage();

    fireEvent.press(screen.getByText('적용하기'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith(
      { tripId: TRIP_ID, sessionId: SESSION_ID },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    expect(mockPush).not.toHaveBeenCalled();
    // 5-b 차단-1 — 성공 콜백 전에는 이동하지 않는다(P3 와 짝: "성공 뒤에만" replace).
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('onSuccess 가 불리면 router.replace 가 허브 + applied=sessionId 로 1회', () => {
    mockSession.data = session('DRAFT');
    renderPage();
    fireEvent.press(screen.getByText('적용하기'));

    const options = mockMutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => options.onSuccess());

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/live',
      params: { tripId: TRIP_ID, applied: SESSION_ID },
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 P4 · AC-9(d) — 확정 요청 중에는 [적용하기]가 잠긴다', () => {
  it('seam isPending 이면 버튼이 disabled 이고 눌러도 mutate 가 안 불린다(이중 POST → 409 차단)', () => {
    mockSession.data = session('DRAFT');
    mockApply.isPending = true;
    renderPage();

    const apply = screen.getByTestId('sheet-cta-button-1');
    expect(apply).toHaveTextContent('적용하기');
    expect(apply).toBeDisabled();
    fireEvent.press(apply);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 P4b · 5-b 경고-1 — 확정 요청 중에는 [직접 수정]도 잠긴다(교차 잠금)', () => {
  it('seam isPending 이면 [직접 수정]이 disabled 이고 눌러도 push 가 없다(밑에 남은 초안의 onSuccess 가 편집 화면을 갈아 끼우는 경로 차단)', () => {
    mockSession.data = session('DRAFT');
    mockApply.isPending = true;
    renderPage();

    const manual = screen.getByTestId('sheet-cta-button-0');
    expect(manual).toHaveTextContent('직접 수정');
    expect(manual).toBeDisabled();
    fireEvent.press(manual);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 P5 · AC-9(e) · Q6 — 확정 실패는 같은 안내 자리에', () => {
  it('seam isError 면 실패 안내가 뜨고 replace 는 없으며, [적용하기]가 그대로 재시도다', () => {
    mockSession.data = session('DRAFT');
    mockApply.isError = true;
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '변경을 반영하지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(
      '원래 일정은 그대로 있어요. 잠시 후 다시 시도해 주세요.'
    );
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('적용하기'));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    // 5-b 차단-1 — 재시도를 눌러도 성공 전에는 이동하지 않는다.
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 P6 · AC-10 · Q4 — NO_SOLUTION 은 같은 뷰의 대안 없음 상태', () => {
  it('안내 2줄(사유를 지어내지 않는 뒤 절만), 렌더만으로 push 0, 두 버튼이 i04·manual 로 간다', () => {
    mockSession.data = session('NO_SOLUTION');
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '대안을 찾지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('조건을 줄이거나 직접 고쳐 주세요');
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('조건 바꿔 다시 짜기'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenLastCalledWith(REQUEST_HREF);

    fireEvent.press(screen.getByText('직접 수정'));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenLastCalledWith(MANUAL_HREF);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 P7 · AC-10 · E3 — FAILED 도 같은 뷰에 착지한다(옛 variant=error push 반전)', () => {
  it('안내 "다시 짜지 못했어요", 렌더만으로 push 0, [다시 시도]→i04 · [직접 수정]→manual(variant 없음)', () => {
    mockSession.data = session('FAILED');
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '다시 짜지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('잠시 후 다시 시도하거나 직접 고쳐 주세요');
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('다시 시도'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenLastCalledWith(REQUEST_HREF);

    fireEvent.press(screen.getByText('직접 수정'));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenLastCalledWith(MANUAL_HREF);
  });
});

describe('🔴 P8 · AC-10 — SOLVING·closed·미도착은 아무것도 그리지 않는다', () => {
  it.each([['SOLVING'], ['APPLIED'], ['CANCELED']])(
    '%s 이면 렌더 없음 + 라우터·확정 호출 0',
    (status) => {
      mockSession.data = session(status);
      renderPage();

      expect(screen.toJSON()).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockMutate).not.toHaveBeenCalled();
    }
  );

  it('세션 미도착(data undefined)이면 렌더 없음 + 라우터 호출 0', () => {
    renderPage();

    expect(screen.toJSON()).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 P9 · Q8 — 뒤로가기', () => {
  it('지도 위 뒤로가기는 router.back 을 1회 부른다', () => {
    mockSession.data = session('DRAFT');
    renderPage();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
