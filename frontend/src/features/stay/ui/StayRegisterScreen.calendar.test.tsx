import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayRegisterFlow } from '../model/stayRegisterForm';
import { StayRegisterScreen } from './StayRegisterScreen';

/**
 * SC-1~SC-5 (TRIP-390 AC-1·2·3·5·6 · 01b Seed) — 숙소 등록 달력의 선택 피드백·범위 하이라이트·
 * 여행 기간 상·하한을 화면 렌더 층에서 잠근다.
 *
 * 무엇을 보장하나: 달력 셀이 상태에 따라 서로 다른 얼굴을 갖는다.
 *  - 고른 날(끝점)·그 사이(범위)가 색과 `accessibilityState.selected`로 구별된다(AC-1·2)
 *  - 체크인만 고른 상태가 '날짜를 선택하세요'가 아니라 다음 걸음(체크아웃)을 말한다(AC-3)
 *  - 여행 기간을 알면 그 밖 날짜가 **진짜 `disabled` prop**으로 차단되고(AC-5), 모르면
 *    현행대로 오늘+ 전부 열린다(AC-6)
 *
 * 무엇을 못 보나(6-b 실기 전용): 바텀시트 목이 children을 무조건 렌더하므로 셀의 className·
 * `accessibilityState`·`disabled`는 관측되지만 **실제 하이라이트 페인팅·시트 열림/딤은 jest가
 * 원리적으로 못 본다**(repo-traps 「바텀시트」, AC-8). green ≠ "강조돼 보인다".
 *
 * 지도는 목으로 바꾼다(선례 `StayRegisterScreen.test.tsx:31`) — 인라인 팩토리는 NativeWind
 * babel의 `_ReactNativeCSSInterop` 호이스트 규칙을 위반하므로 모듈 스코프 파일을 require 한다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

/** 픽스처는 파일마다 각자 갖는 것이 리포 관례. 달력만 보므로 검색·좌표 축은 비활성으로 둔다. */
const BASE_FLOW: StayRegisterFlow = {
  activeTab: 'mapsearch',
  query: '',
  name: '',
  searchStatus: 'idle',
  candidates: [],
  selectedCandidate: null,
  coordSource: 'MAP_SEARCH',
  pinAddressStatus: 'idle',
  coordConfirmed: false,
  mapSheetState: 'closed',
  checkIn: null,
  checkOut: null,
  dateSheetOpen: false,
  submitStatus: 'idle',
};

/** 과거 날짜 비활성(§3-4)이 실행 날짜에 흔들리지 않게 주입 고정. */
const TODAY = '2026-06-15';

const onPickDate = jest.fn();

function makeHandlers() {
  return {
    onSelectTab: jest.fn(),
    onChangeName: jest.fn(),
    onPinMessage: jest.fn(),
    onChangeQuery: jest.fn(),
    onSubmitQuery: jest.fn(),
    onRetrySearch: jest.fn(),
    onSelectCandidate: jest.fn(),
    onOpenMapSheet: jest.fn(),
    onConfirmCoord: jest.fn(),
    onCloseMapSheet: jest.fn(),
    onOpenDateSheet: jest.fn(),
    onPickDate,
    onCloseDateSheet: jest.fn(),
    onSubmit: jest.fn(),
  };
}

beforeEach(() => onPickDate.mockClear());

/** className을 **토큰 배열**로 읽는다 — `bg-primary`는 `bg-primary-pale`의 접두라 문자열
 * `includes`면 범위 셀이 끝점으로 오인된다. 배열 원소 일치가 그 접두 오탐을 구조적으로 막는다
 * (02a §5 실검증 · 선례 `SocialLoginScreen.visual.test.tsx:46`). */
function classTokens(node: { props: { className?: string } }): string[] {
  return (node.props.className ?? '').trim().split(/\s+/);
}

function cell(date: string) {
  return screen.getByTestId(`stay-register-date-cell-${date}`);
}

describe('SC-1 · 끝점 셀 강조 (AC-1)', () => {
  it('체크인으로 고른 셀이 bg-primary와 selected 접근성 상태를 갖는다', () => {
    // 준비: 체크인 하나만 고른 채 달력을 연다.
    render(
      <StayRegisterScreen
        flow={{ ...BASE_FLOW, checkIn: '2026-06-16', dateSheetOpen: true }}
        today={TODAY}
        {...makeHandlers()}
      />
    );

    // 단언: 끝점 셀은 강조색 bg-primary(범위색 아님) + selected.
    expect(classTokens(cell('2026-06-16'))).toContain('bg-primary');
    expect(classTokens(cell('2026-06-16'))).not.toContain('bg-primary-pale');
    expect(cell('2026-06-16')).toBeSelected();

    // 짝: 안 고른 셀은 선택 표시가 없다.
    expect(cell('2026-06-20')).not.toBeSelected();
  });
});

describe('SC-2 · 범위 셀 강조 (AC-2)', () => {
  it('체크인·체크아웃 사이 셀이 bg-primary-pale, 끝점은 bg-primary로 갈린다', () => {
    // 준비: 체크인 16·체크아웃 18 — 사이(17)가 범위다.
    render(
      <StayRegisterScreen
        flow={{
          ...BASE_FLOW,
          checkIn: '2026-06-16',
          checkOut: '2026-06-18',
          dateSheetOpen: true,
        }}
        today={TODAY}
        {...makeHandlers()}
      />
    );

    // 사이 셀: 범위색만, 끝점색 아님, selected.
    expect(classTokens(cell('2026-06-17'))).toContain('bg-primary-pale');
    expect(classTokens(cell('2026-06-17'))).not.toContain('bg-primary');
    expect(cell('2026-06-17')).toBeSelected();

    // 끝점 셀: 강조색만(범위이기도 하나 삼항이 bg-primary를 먼저 집는다), selected.
    for (const endpoint of ['2026-06-16', '2026-06-18']) {
      expect(classTokens(cell(endpoint))).toContain('bg-primary');
      expect(classTokens(cell(endpoint))).not.toContain('bg-primary-pale');
      expect(cell(endpoint)).toBeSelected();
    }

    // 범위 밖 셀: 아무 색도 없고 선택도 아니다.
    expect(classTokens(cell('2026-06-20'))).not.toContain('bg-primary');
    expect(classTokens(cell('2026-06-20'))).not.toContain('bg-primary-pale');
    expect(cell('2026-06-20')).not.toBeSelected();
  });

  it('짝: 반쪽(체크인만)이면 사이가 될 셀도 범위색이 안 붙는다', () => {
    // isDateInRange는 한쪽이 null이면 항상 false — 미완성 범위는 칠하지 않는다.
    render(
      <StayRegisterScreen
        flow={{
          ...BASE_FLOW,
          checkIn: '2026-06-16',
          checkOut: null,
          dateSheetOpen: true,
        }}
        today={TODAY}
        {...makeHandlers()}
      />
    );

    expect(classTokens(cell('2026-06-17'))).not.toContain('bg-primary-pale');
    expect(cell('2026-06-17')).not.toBeSelected();
  });
});

describe('SC-3 · 체크인만 고른 상태의 다음-단계 안내 (AC-3)', () => {
  it('체크인만 있으면 요약이 "체크아웃도 선택하세요"이고 "날짜를 선택하세요"가 아니다', () => {
    // 준비: 체크인만, 체크아웃 없음(요약은 본 화면 필드라 시트 열림과 무관).
    render(
      <StayRegisterScreen
        flow={{ ...BASE_FLOW, checkIn: '2026-06-16', checkOut: null }}
        today={TODAY}
        {...makeHandlers()}
      />
    );

    // toHaveTextContent(문자열)은 완전 일치(02a §5) — 이 한 줄이 문구 전체를 잠근다.
    const summary = screen.getByTestId('stay-register-date-summary');
    expect(summary).toHaveTextContent('체크아웃도 선택하세요');
    expect(summary).not.toHaveTextContent('날짜를 선택하세요');
  });

  it('짝: 아무것도 안 골랐으면 요약은 "날짜를 선택하세요" 그대로다', () => {
    render(
      <StayRegisterScreen
        flow={{ ...BASE_FLOW, checkIn: null, checkOut: null }}
        today={TODAY}
        {...makeHandlers()}
      />
    );

    expect(screen.getByTestId('stay-register-date-summary')).toHaveTextContent(
      '날짜를 선택하세요'
    );
  });
});

describe('SC-4 · 여행 기간 상·하한 (AC-5)', () => {
  it('기간 밖 셀은 진짜 disabled라 눌러도 onPickDate가 불리지 않는다', () => {
    // 준비: 오늘 06-15, 여행 기간 하한 06-18·상한 06-20 → 실효 하한 max(오늘, 06-18)=06-18.
    const handlers = makeHandlers();
    render(
      <StayRegisterScreen
        flow={{ ...BASE_FLOW, dateSheetOpen: true }}
        today={TODAY}
        minDate="2026-06-18"
        maxDate="2026-06-20"
        {...handlers}
      />
    );

    // 상한 밖: 회색 비활성 + 눌러도 무동작(accessibilityState만이 아니라 실 disabled여야 press가 막힌다).
    expect(cell('2026-06-21')).toBeDisabled();
    fireEvent.press(cell('2026-06-21'));
    expect(handlers.onPickDate).not.toHaveBeenCalled();

    // 하한 밖(오늘 이후지만 시작일 이전): 시작일까지 하한이 올라간다.
    expect(cell('2026-06-16')).toBeDisabled();

    // 양 끝 포함(BR-U1-27 관례) — 상한 당일과 기간 내부는 열려 있다.
    expect(cell('2026-06-20')).toBeEnabled();
    expect(cell('2026-06-19')).toBeEnabled();
  });
});

describe('SC-5 · 여행 기간 모름 = 상한 없음 (AC-6)', () => {
  it('min/max를 안 주면 오늘 한참 뒤 날짜도 눌리고, 과거만 잠긴다', () => {
    // 현행 보존 회귀 앵커 — 무관한 상한이 끼면 이 테스트가 red로 잡는다.
    const handlers = makeHandlers();
    render(
      <StayRegisterScreen
        flow={{ ...BASE_FLOW, dateSheetOpen: true }}
        today={TODAY}
        {...handlers}
      />
    );

    expect(cell('2026-06-30')).toBeEnabled();
    fireEvent.press(cell('2026-06-30'));
    expect(handlers.onPickDate).toHaveBeenCalledWith('2026-06-30');

    // 기존 하한은 유지 — 오늘 이전은 여전히 잠긴다.
    expect(cell('2026-06-14')).toBeDisabled();
  });
});
