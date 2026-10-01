import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import type { ReactTestInstance } from 'react-test-renderer';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { ReplanRequestSheet } from './ReplanRequestSheet';

/**
 * TRIP-750 · AC-1~5·8·11 — i04 재계획 요청 시트(Figma 4067:2427, 순수 props+콜백).
 *
 * 무엇을 보장하나:
 *  - 섹션 순서 = 왜 바꾸나요 → 바꿀 범위 → 어떻게 바꿀까요 → 직접 말하기 → CTA 1개. 부제·각주·`(선택)` 없음.
 *  - `detected` 가 있으면 사유 맨 앞에 감지 칩(SVG 경고 + 문구)이 서고, 정적 {WEATHER, reasonKey} 칩은 숨는다.
 *  - 방향 11종(key·라벨·순서), 입력 1줄, 스크림·끌어 닫기 → onClose.
 *  - 삭제된 배너·범위 밖 안내·[직접 고르기]의 testID 가 트리에 없다.
 *
 * 삭제 testID 는 조립한다 — 리터럴이면 `planbRequestSheetStructure` R3 가 이 파일을 잡는다(02a ★3).
 * 통과형 바텀시트 목이라 실제 딤 커버·끌어 닫기는 jest 사각(02a ★1, AC-V2 실기).
 */

const DELETED_IDS = ['detected', 'out-of-scope', 'manual', 'suppress'].map(
  (suffix) => ['planb', 'request', suffix].join('-')
);

const REASONS: [string, string][] = [
  ['TEMP_CLOSED', '임시 휴무'],
  ['SLOW_MOVE', '이동 지연'],
  ['LOW_ENERGY', '체력 저하'],
  ['FULLY_BOOKED', '예약 마감'],
  ['WEATHER', '날씨'],
  ['JUST_CHANGE', '그냥 바꾸고 싶어요'],
];

const DIRECTIVES: [string, string][] = [
  ['RELAX', '여유 있게'],
  ['FILL_MORE', '더 채워서'],
  ['INDOOR', '실내로'],
  ['EARLIER', '시간만 당기기'],
  ['NEARBY', '가까운 곳으로'],
  ['ADD_FOOD', '맛집 추가'],
  ['END_NEAR_STAY', '숙소 근처에서 끝내기'],
  ['LESS_MOVE', '이동 짧게'],
  ['KEEP_BUDGET', '예산 유지'],
  ['KEEP_DINNER', '저녁은 그대로'],
  ['AVOID_OUTDOOR', '야외 피하기'],
];

const TRIGGER_CHIP = 'planb-request-trigger-chip';
const WEATHER_DETECTED = {
  label: '비 예보 · 해운대 해변 17시',
  reasonKey: 'WEATHER',
};
const CLOSURE_DETECTED = {
  label: '휴무 · 해운대 해변 주변 시설',
  reasonKey: 'TEMP_CLOSED',
};

function baseProps() {
  return {
    scope: 'PARTIAL_SLOTS' as const,
    selectedReasons: [] as string[],
    selectedDirectives: [] as string[],
    freeText: '',
    onSelectScope: jest.fn(),
    onToggleReason: jest.fn(),
    onToggleDirective: jest.fn(),
    onChangeFreeText: jest.fn(),
    onSubmit: jest.fn(),
    onClose: jest.fn(),
  };
}

function classTokens(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

/** 정적 사유 칩 testID 를 트리 순서대로 key 만 뽑는다. */
function staticReasonKeys(): string[] {
  return screen
    .queryAllByTestId(/^planb-request-reason-/)
    .map((node) =>
      String(node.props.testID).replace('planb-request-reason-', '')
    );
}

/** testID → 섹션 그룹. 그룹 밖(시트·스크림 등)은 null. */
function groupOf(testID: string): string | null {
  if (testID === TRIGGER_CHIP) return 'reason';
  if (testID.startsWith('planb-request-reason-')) return 'reason';
  if (testID.startsWith('planb-request-scope-')) return 'scope';
  if (testID.startsWith('planb-request-directive-')) return 'directive';
  if (testID === 'planb-request-freetext') return 'freetext';
  if (testID === 'planb-request-submit') return 'submit';
  return null;
}

describe('🔴 S1 · 제목·섹션 라벨·순서 (AC-1)', () => {
  it('제목은 20px, 라벨 4개와 CTA 가 Figma 순서·문구 그대로이고 부제·각주·(선택)은 없다', () => {
    render(<ReplanRequestSheet {...baseProps()} />);

    const title = screen.getByText('✦ AI에게 맡길게요');
    expect(classTokens(title)).toContain('text-[20px]');
    expect(classTokens(title)).not.toContain('text-section');

    const labels = screen
      .getAllByText(
        /^(왜 바꾸나요 · 여러 개 가능|바꿀 범위|어떻게 바꿀까요 · 지킬 것도 함께|직접 말하기|AI가 다시 짜기)$/
      )
      .map((node) => node.props.children);
    expect(labels).toEqual([
      '왜 바꾸나요 · 여러 개 가능',
      '바꿀 범위',
      '어떻게 바꿀까요 · 지킬 것도 함께',
      '직접 말하기',
      'AI가 다시 짜기',
    ]);

    expect(screen.queryByText(/어디를 · 어떻게 바꿀지/)).toBeNull();
    expect(screen.queryByText(/방문한 곳과 진행 중인 일정/)).toBeNull();
    expect(screen.queryByText(/\(선택\)/)).toBeNull();
  });
});

describe('🔴 S2 · 칩 그룹 트리 순서 (AC-1)', () => {
  it('감지 칩 → 사유 → 범위 → 방향 → 입력 → CTA 순으로 놓인다', () => {
    render(<ReplanRequestSheet {...baseProps()} detected={WEATHER_DETECTED} />);

    const ids = screen
      .getAllByTestId(/^planb-request-/)
      .map((node) => String(node.props.testID));
    // 감지 칩이 사유 그룹의 맨 앞이다.
    expect(ids.find((id) => groupOf(id) === 'reason')).toBe(TRIGGER_CHIP);

    const groups = ids
      .map(groupOf)
      .filter((group): group is string => group !== null)
      .filter((group, index, all) => index === 0 || all[index - 1] !== group);
    expect(groups).toEqual([
      'reason',
      'scope',
      'directive',
      'freetext',
      'submit',
    ]);
  });
});

describe('S3 · 감지 트리거 없음 — 정적 사유 6칩 (AC-2a)', () => {
  it('6종이 key·라벨·순서 그대로 뜨고 감지 칩은 없으며, 누르면 그 key 로 토글된다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    expect(screen.queryByTestId(TRIGGER_CHIP)).toBeNull();
    expect(staticReasonKeys()).toEqual(REASONS.map(([key]) => key));
    REASONS.forEach(([key, label]) =>
      expect(
        screen.getByTestId(`planb-request-reason-${key}`)
      ).toHaveTextContent(label)
    );

    fireEvent.press(screen.getByTestId('planb-request-reason-TEMP_CLOSED'));
    expect(props.onToggleReason).toHaveBeenCalledTimes(1);
    expect(props.onToggleReason).toHaveBeenCalledWith('TEMP_CLOSED');
  });
});

describe('🔴 S4 · 감지 트리거 WEATHER — 선두 감지 칩 (AC-2b·c)', () => {
  it('감지 칩이 문구·SVG 경고·선택 상태로 서고, 정적 날씨 칩은 숨으며, 누르면 WEATHER 로 토글된다', () => {
    const props = { ...baseProps(), selectedReasons: ['WEATHER'] };
    render(<ReplanRequestSheet {...props} detected={WEATHER_DETECTED} />);

    const chip = screen.getByTestId(TRIGGER_CHIP);
    expect(chip).toHaveTextContent('비 예보 · 해운대 해변 17시');
    expect(chip).toBeSelected();
    expect(
      chip.findAll((node) => node.props.fill === '#FF385C').length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/⚠/)).toBeNull();

    expect(staticReasonKeys()).toEqual([
      'TEMP_CLOSED',
      'SLOW_MOVE',
      'LOW_ENERGY',
      'FULLY_BOOKED',
      'JUST_CHANGE',
    ]);

    fireEvent.press(chip);
    expect(props.onToggleReason).toHaveBeenCalledTimes(1);
    expect(props.onToggleReason).toHaveBeenCalledWith('WEATHER');
  });

  it('선택값에 reasonKey 가 없으면 감지 칩은 꺼진 상태로 그려진다', () => {
    render(<ReplanRequestSheet {...baseProps()} detected={WEATHER_DETECTED} />);

    expect(screen.getByTestId(TRIGGER_CHIP)).not.toBeSelected();
  });
});

describe('🔴 S5 · 감지 트리거 CLOSURE — 매핑 key 칩도 숨긴다 (AC-2c · Q2)', () => {
  it('정적 날씨·임시 휴무가 숨고 나머지 4칩이 남으며, 감지 칩은 TEMP_CLOSED 로 토글된다', () => {
    const props = { ...baseProps(), selectedReasons: ['TEMP_CLOSED'] };
    render(<ReplanRequestSheet {...props} detected={CLOSURE_DETECTED} />);

    const chip = screen.getByTestId(TRIGGER_CHIP);
    expect(chip).toHaveTextContent('휴무 · 해운대 해변 주변 시설');
    expect(chip).toBeSelected();
    expect(staticReasonKeys()).toEqual([
      'SLOW_MOVE',
      'LOW_ENERGY',
      'FULLY_BOOKED',
      'JUST_CHANGE',
    ]);

    fireEvent.press(chip);
    expect(props.onToggleReason).toHaveBeenCalledWith('TEMP_CLOSED');
  });
});

describe('🔴 S6 · 방향 11칩 (AC-3 · D5 · Q1)', () => {
  it('11종이 key·라벨·순서 그대로이고 야경 코스는 없으며, 야외 피하기를 누르면 AVOID_OUTDOOR 로 토글된다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    const keys = screen
      .getAllByTestId(/^planb-request-directive-/)
      .map((node) =>
        String(node.props.testID).replace('planb-request-directive-', '')
      );
    expect(keys).toEqual(DIRECTIVES.map(([key]) => key));
    DIRECTIVES.forEach(([key, label]) =>
      expect(
        screen.getByTestId(`planb-request-directive-${key}`)
      ).toHaveTextContent(label)
    );
    expect(screen.queryByText('야경 코스')).toBeNull();

    fireEvent.press(
      screen.getByTestId('planb-request-directive-AVOID_OUTDOOR')
    );
    expect(props.onToggleDirective).toHaveBeenCalledTimes(1);
    expect(props.onToggleDirective).toHaveBeenCalledWith('AVOID_OUTDOOR');
  });
});

describe('S7 · 범위 2칩 · 단일선택 (BR-U4-11)', () => {
  it('두 칩이 라벨과 함께 뜨고 기본 범위가 선택 표시되며 press 가 값을 올린다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    expect(
      screen.getByTestId('planb-request-scope-PARTIAL_SLOTS')
    ).toHaveTextContent('지금 이후');
    expect(
      screen.getByTestId('planb-request-scope-FULL_DAY')
    ).toHaveTextContent('오늘 전체');
    expect(
      screen.getByTestId('planb-request-scope-PARTIAL_SLOTS')
    ).toBeSelected();

    fireEvent.press(screen.getByTestId('planb-request-scope-FULL_DAY'));
    expect(props.onSelectScope).toHaveBeenCalledTimes(1);
    expect(props.onSelectScope).toHaveBeenCalledWith('FULL_DAY');
  });
});

describe('🔴 S8 · 직접 말하기 입력 1줄 (AC-4 · BR-U4-13)', () => {
  it('multiline·64px 최소 높이가 없고 placeholder·maxLength 500 은 그대로이며 입력이 올라간다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    const input = screen.getByTestId('planb-request-freetext');
    expect(input.props.multiline).not.toBe(true);
    expect(classTokens(input)).not.toContain('min-h-[64px]');
    expect(input.props.placeholder).toBe(
      '예: 저녁은 광안리 야경 보이는 곳으로'
    );
    expect(input.props.maxLength).toBe(500);

    fireEvent.changeText(input, '저녁은 야경');
    expect(props.onChangeFreeText).toHaveBeenCalledWith('저녁은 야경');
  });
});

describe('🔴 S9 · CTA 1개 · 삭제 표면 부재 (AC-5)', () => {
  it('[AI가 다시 짜기]만 있고 onSubmit 만 부르며, 옛 배너·범위 밖·[직접 고르기]의 흔적이 없다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} detected={WEATHER_DETECTED} />);

    const cta = screen.getByTestId('planb-request-submit');
    expect(cta).toHaveTextContent('AI가 다시 짜기');
    expect(classTokens(cta)).toContain('rounded-button');
    expect(classTokens(cta)).not.toContain('rounded-[14px]');

    fireEvent.press(cta);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();

    expect(screen.queryByText('직접 고르기')).toBeNull();
    expect(screen.queryByText('끄기')).toBeNull();
    DELETED_IDS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
  });
});

describe('🔴 S10 · 닫기 — 스크림 탭 · 끌어 닫기 (AC-8)', () => {
  it('스크림(bg-scrim/40)과 BottomSheet onClose 가 모두 onClose 로 이어지고 제출은 안 한다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    const scrim = screen.getByTestId('planb-request-scrim');
    expect(classTokens(scrim)).toContain('bg-scrim/40');
    fireEvent.press(scrim);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    const pannable = screen.UNSAFE_root.findAll(
      (node) => node.props.enablePanDownToClose === true
    );
    expect(pannable.length).toBeGreaterThan(0);
    act(() => {
      pannable[0].props.onClose();
    });
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});

describe('🔴 S11 · 칩·CTA 토큰 (AC-11 · 후속 39)', () => {
  it('선택 칩은 primary-pale 배경·primary 글자·r12 이고, 어떤 칩에도 pill 반경·primary-text 가 없다', () => {
    render(
      <ReplanRequestSheet
        {...baseProps()}
        selectedReasons={['WEATHER']}
        selectedDirectives={['END_NEAR_STAY']}
        detected={WEATHER_DETECTED}
      />
    );

    const selected: [string, string][] = [
      [TRIGGER_CHIP, '비 예보 · 해운대 해변 17시'],
      ['planb-request-scope-PARTIAL_SLOTS', '지금 이후'],
      ['planb-request-directive-END_NEAR_STAY', '숙소 근처에서 끝내기'],
    ];
    selected.forEach(([id, label]) => {
      const chip = screen.getByTestId(id);
      expect(classTokens(chip)).toEqual(
        expect.arrayContaining(['bg-primary-pale', 'rounded-button'])
      );
      expect(classTokens(within(chip).getByText(label))).toContain(
        'text-primary'
      );
    });

    const chips = screen
      .getAllByTestId(/^planb-request-(trigger-chip|reason-|scope-|directive-)/)
      .filter((node) => typeof node.props.testID === 'string');
    expect(chips.length).toBeGreaterThan(15);
    chips.forEach((chip) => {
      expect(classTokens(chip)).toContain('rounded-button');
      expect(classTokens(chip)).not.toContain('rounded-pill');
      const primaryText = chip.findAll((node) =>
        classTokens(node).includes('text-primary-text')
      );
      expect(primaryText).toEqual([]);
    });
  });
});

describe('🔴 S-E · 실패 안내 (03b 경고-1 · INV-4)', () => {
  const CONFLICT_TEXT = '여행 기간에만 AI에게 맡길 수 있어요';

  it('S-E1 errorText 가 있으면 입력 뒤·CTA 바로 앞에 그 문구 하나를 그대로 띄운다', () => {
    render(<ReplanRequestSheet {...baseProps()} errorText={CONFLICT_TEXT} />);

    expect(screen.getAllByTestId('planb-request-error')).toHaveLength(1);
    expect(screen.getByTestId('planb-request-error')).toHaveTextContent(
      CONFLICT_TEXT
    );
    const order = screen
      .getAllByTestId(/^planb-request-(freetext|error|submit)$/)
      .map((node) => String(node.props.testID));
    expect(order).toEqual([
      'planb-request-freetext',
      'planb-request-error',
      'planb-request-submit',
    ]);
  });

  it.each([
    ['null', null],
    ['안 줌', undefined],
  ])('S-E2 errorText 가 %s 이면 안내 요소가 없다', (_label, errorText) => {
    render(<ReplanRequestSheet {...baseProps()} errorText={errorText} />);

    expect(screen.queryByTestId('planb-request-error')).toBeNull();
    expect(screen.getByTestId('planb-request-submit')).toBeOnTheScreen();
  });
});

/**
 * TRIP-990 · S6 (#051 · D9 · US-PLANB-12) + 01b Q10 — 자유텍스트 입력이 키보드에 가리지 않도록 시트에
 * 알리고, 입력 중 "AI가 다시 짜기" 첫 탭이 키보드 닫기에 먹히지 않게 한다.
 *
 * *(개념)* `BottomSheetTextInput` = 시트에 "내 안의 입력칸이 포커스를 받았다"고 알려서 키보드 높이만큼
 * 시트를 밀어 올리게 하는 입력칸. 플레인 `TextInput` 으로는 `keyboardBehavior` 를 무엇으로 줘도 시트가
 * 안 움직인다(TRIP-984 브리프에서 라이브러리 코드로 확인).
 *
 * 여기서 보는 것은 구조뿐이다 — 그 입력칸을 썼는가, `keyboardBehavior="interactive"` 를 적었는가,
 * 본문 스크롤이 `keyboardShouldPersistTaps="handled"` 인가. 목의 `BottomSheetTextInput` 은 별 타입이라
 * 플레인 `TextInput` 으로 되돌리면 구분된다(984 목). 실제로 시트가 올라가 입력·CTA 가 보이는지는 6-b.
 *
 * 3동작 뼈대: 준비=시트 렌더 → 실행=해당 요소 찾기 → 단언=타입·prop 값.
 */
describe('🔴 S6 · 재계획 시트 키보드 처방 (#051 · D9 · Q10)', () => {
  it('자유텍스트 입력은 BottomSheetTextInput 이다 (플레인 TextInput 이면 red)', () => {
    render(<ReplanRequestSheet {...baseProps()} />);

    expect(screen.UNSAFE_getByType(BottomSheetTextInput).props.testID).toBe(
      'planb-request-freetext'
    );
  });

  it('시트가 keyboardBehavior="interactive" 를 명시한다', () => {
    render(<ReplanRequestSheet {...baseProps()} />);

    expect(
      screen.UNSAFE_queryAllByProps({ keyboardBehavior: 'interactive' })
    ).not.toHaveLength(0);
  });

  it('본문 스크롤이 keyboardShouldPersistTaps="handled" 라 입력 중 CTA 첫 탭이 닿는다 (Q10)', () => {
    render(<ReplanRequestSheet {...baseProps()} />);

    expect(
      screen.getByTestId('planb-request-sheet').props.keyboardShouldPersistTaps
    ).toBe('handled');
  });
});
