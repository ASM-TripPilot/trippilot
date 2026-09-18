import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  MyStaysScreen,
  type MyStayRowVM,
  type MyStaysScreenProps,
} from './MyStaysScreen';

/**
 * TRIP-605 · l04 등록 숙소·예약 기록 — 순수 프레젠테이션 화면(VM 주입). 조회·조합은 페이지 몫이라
 * 여기선 완성 VM 을 props 로 넣고 렌더 계약만 잠근다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1(BR-U6-20) 행에 숙소명·위치·체크인/아웃·등록 출처·연결 여행이 보이고, 미연결은 정확히 '연결된 여행 없음'.
 *  - 🔴 AC-2(BR-U6-21 핵심) 출발점 토글 press → **다이얼로그가 먼저** 뜨고 확정 전엔 콜백 0회, 확정에서만 1회.
 *  - 🔴 AC-3(INV-U1-08) coordConfirmed=false → 토글 real disabled + press 무반응 + 콜백 0.
 *  - 🔴 AC-4(US-NOTIF-06) 0건 → empty 안내 + 탐색 콜백.
 *  - AC-5(INV-3) 렌더에 소요시간 문자열 0(선제 green 회귀 앵커).
 *
 * 왜 이렇게 테스트하나(02a ★1·★2):
 *  - 게이트는 화면이 로컬 상태로 다이얼로그를 여는 것(`LocationConsentScreen` 철회 게이트 선례). "다이얼로그 없이
 *    mutate 0회"를 증명하는 이음매가 **주입된 `onConfirmBaseToggle` 스파이**다(= mutate 스파이).
 *  - 다이얼로그 실제 덮임/딤/중앙정렬·터치차단은 jest 원리적 사각(6-b 실기) — 심판은 testID 트리존재 + 확정 전 0회.
 *  - push 목적지('/stays')·DELETE 목적지는 페이지 배선이라 화면은 콜백 호출까지만(`MyStaysPage.integration.test.tsx`가 잠금).
 *
 * (개념) `getByText('문자열')`=leaf 완전일치 · `getByText(/정규식/)`/`queryAllByText(/정규식/)`=부분포함
 *   (node_modules matches.js 실검증, 02a §5-A). `toBeDisabled()`=real disabled prop 판독(02a §5-B).
 */

/** 소요시간 표기 탐지기(INV-3) — 부분포함 정규식(TripCardContainer 선례 동형). */
const DURATION = /소요|\d+\s*분|\d+\s*시간/;

/** 등록됨(출발점 배정·연결 여행 有) 행. */
function assignedRow(over: Partial<MyStayRowVM> = {}): MyStayRowVM {
  return {
    savedStayId: 's1',
    name: '해운대 오션뷰',
    location: '부산 해운대구 우동',
    dateRangeLabel: '6.10 ~ 6.13',
    sourceLabel: 'OTA 예약',
    memoLabel: null,
    linkedTripLabel: '연결 여행 · 부산 여행',
    baseState: 'assigned',
    canAssignBase: true,
    tripId: 't1',
    baseAssignmentId: 'ba1',
    ...over,
  };
}

/** 미등록(출발점 미배정·연결 없음) 행. */
function unassignedRow(over: Partial<MyStayRowVM> = {}): MyStayRowVM {
  return {
    savedStayId: 's2',
    name: '남포동 게스트하우스',
    location: '부산 중구 남포동',
    dateRangeLabel: null,
    sourceLabel: '앱 저장',
    memoLabel: '예약번호 미입력',
    linkedTripLabel: '연결된 여행 없음',
    baseState: 'unassigned',
    canAssignBase: true,
    tripId: null,
    baseAssignmentId: null,
    ...over,
  };
}

function renderScreen(over: Partial<MyStaysScreenProps> = {}) {
  const onConfirmBaseToggle = jest.fn();
  const onPressExplore = jest.fn();
  const props: MyStaysScreenProps = {
    rows: [assignedRow()],
    isEmpty: false,
    onConfirmBaseToggle,
    onPressExplore,
    ...over,
  };
  render(<MyStaysScreen {...props} />);
  return { onConfirmBaseToggle, onPressExplore };
}

describe('🔴 AC-1 · 행 표시(BR-U6-20)', () => {
  it('연결된 행은 숙소명·위치·날짜·출처·여행명을, 미연결 행은 정확히 "연결된 여행 없음"을 보인다', () => {
    renderScreen({ rows: [assignedRow(), unassignedRow()] });

    // 연결된 행(s1)
    expect(screen.getByText('해운대 오션뷰')).toBeOnTheScreen();
    expect(screen.getByText('부산 해운대구 우동')).toBeOnTheScreen();
    expect(screen.getByText('6.10 ~ 6.13')).toBeOnTheScreen();
    expect(screen.getByText('OTA 예약')).toBeOnTheScreen();
    // 여행명은 부분포함(라벨이 '연결 여행 · 부산 여행' 이므로 leaf 완전일치는 못 씀).
    expect(screen.getByText(/부산 여행/)).toBeOnTheScreen();

    // 미연결 행(s2) — 정본 문안 완전일치.
    expect(screen.getByText('연결된 여행 없음')).toBeOnTheScreen();
  });
});

describe('🔴 AC-2 · 출발점 전환 다이얼로그 게이트(BR-U6-21)', () => {
  it('토글 press 는 다이얼로그를 먼저 띄우고 확정 전엔 콜백 0회, 확정에서만 1회 그 행으로 부른다', () => {
    const { onConfirmBaseToggle } = renderScreen({ rows: [assignedRow()] });

    // 준비 확인: 열기 전엔 다이얼로그가 없다.
    expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();

    // 실행: 출발점 토글 press.
    fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));

    // 급소: 다이얼로그가 먼저 뜨고, 확정 없이 mutate 콜백이 나가지 않는다(즉시 배정 금지).
    expect(screen.getByTestId('my-stays-base-dialog')).toBeOnTheScreen();
    expect(screen.getByText('출발점을 바꿀까요?')).toBeOnTheScreen();
    expect(onConfirmBaseToggle).not.toHaveBeenCalled();

    // 실행2: 확정.
    fireEvent.press(screen.getByTestId('my-stays-base-confirm'));

    // 확정에서만 그 행으로 1회 + 다이얼로그 닫힘.
    expect(onConfirmBaseToggle).toHaveBeenCalledTimes(1);
    expect(onConfirmBaseToggle.mock.calls[0][0].savedStayId).toBe('s1');
    expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
  });

  it('취소하면 콜백 0회로 다이얼로그만 닫힌다(짝)', () => {
    const { onConfirmBaseToggle } = renderScreen({ rows: [assignedRow()] });

    fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));
    expect(screen.getByTestId('my-stays-base-dialog')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('my-stays-base-cancel'));

    expect(onConfirmBaseToggle).not.toHaveBeenCalled();
    expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
  });
});

describe('🔴 AC-3 · 좌표 미확정 → 토글 비활성(INV-U1-08)', () => {
  it('canAssignBase=false 면 토글이 real disabled 이고 press 해도 다이얼로그·콜백이 없다', () => {
    const { onConfirmBaseToggle } = renderScreen({
      rows: [unassignedRow({ savedStayId: 's3', canAssignBase: false })],
    });

    const toggle = screen.getByTestId('my-stays-base-toggle-s3');
    // 급소: real disabled prop(accessibilityState 만이 아니다).
    expect(toggle).toBeDisabled();

    fireEvent.press(toggle);

    expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
    expect(onConfirmBaseToggle).not.toHaveBeenCalled();
  });

  it('canAssignBase=true 면 토글이 비활성이 아니다(짝)', () => {
    renderScreen({
      rows: [unassignedRow({ savedStayId: 's4', canAssignBase: true })],
    });

    expect(screen.getByTestId('my-stays-base-toggle-s4')).not.toBeDisabled();
  });
});

describe('🔴 AC-4 · 0건 empty + 숙소 탐색(US-NOTIF-06)', () => {
  it('isEmpty 면 안내를 보이고 "숙소 탐색" press 시 탐색 콜백을 1회 부른다', () => {
    const { onPressExplore } = renderScreen({ rows: [], isEmpty: true });

    expect(screen.getByTestId('my-stays-empty')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('my-stays-explore'));

    expect(onPressExplore).toHaveBeenCalledTimes(1);
  });

  it('행이 있으면 empty 안내가 없다(짝)', () => {
    renderScreen({ rows: [assignedRow()], isEmpty: false });

    expect(screen.queryByTestId('my-stays-empty')).toBeNull();
  });
});

describe('AC-5 · INV-3 소요시간 미표시(렌더, 선제 green 회귀 앵커)', () => {
  it('행을 그려도 분·시간·소요 표기가 0건이다', () => {
    renderScreen({ rows: [assignedRow(), unassignedRow()] });

    // 탐지기 자가검사(짝) — 실제 소요시간은 잡히고, 날짜(6.10 ~ 6.13)는 무시한다.
    expect('도보 15분').toMatch(DURATION);
    expect('6.10 ~ 6.13').not.toMatch(DURATION);

    // 렌더 결과를 훑는다 — 소요시간 문자열 0건.
    expect(screen.queryAllByText(DURATION)).toHaveLength(0);
  });
});
