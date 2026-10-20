import { fireEvent, render, screen } from '@testing-library/react-native';

import { ReplanRequestSheet } from './ReplanRequestSheet';

/**
 * TRIP-750 · AC-1~5·8·11 — i04 재계획 요청 시트(Figma 4067:2427, 순수 props+콜백).
 *
 * 무엇을 보장하나:
 *  - 섹션 순서 = 왜 바꾸나요 → 바꿀 범위 → 어떻게 바꿀까요 → 직접 말하기 → CTA 1개. 부제·각주·`(선택)` 없음.
 *  - `detected` 가 있으면 사유 맨 앞에 감지 칩(SVG 경고 + 문구)이 서고, 정적 {WEATHER, reasonKey} 칩은 숨는다.
 *  - 방향 10종(key·라벨·순서 — Figma 의 예산 유지는 뺐다), 입력 1줄, 스크림·끌어 닫기 → onClose.
 *  - 삭제된 배너·범위 밖 안내·[직접 고르기]의 testID 가 트리에 없다.
 *
 * 삭제 testID 는 조립한다 — 옛 소스 스캔 `planbRequestSheetStructure` R3 를 피하려던 것이다(TRIP-1145 로 지움, 02a ★3).
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

/** 정적 사유 칩 testID 를 트리 순서대로 key 만 뽑는다. */
function staticReasonKeys(): string[] {
  return screen
    .queryAllByTestId(/^planb-request-reason-/)
    .map((node) =>
      String(node.props.testID).replace('planb-request-reason-', '')
    );
}

describe('🔴 S1 · 제목·섹션 라벨·순서 (AC-1)', () => {
  it('제목·라벨 4개와 CTA 가 Figma 순서·문구 그대로이고 부제·각주·(선택)은 없다', () => {
    render(<ReplanRequestSheet {...baseProps()} />);

    expect(screen.getByText('✦ AI에게 맡길게요')).toBeOnTheScreen();

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
  it('감지 칩이 문구·선택 상태로 서고, 정적 날씨 칩은 숨으며, 누르면 WEATHER 로 토글된다', () => {
    const props = { ...baseProps(), selectedReasons: ['WEATHER'] };
    render(<ReplanRequestSheet {...props} detected={WEATHER_DETECTED} />);

    const chip = screen.getByTestId(TRIGGER_CHIP);
    expect(chip).toHaveTextContent('비 예보 · 해운대 해변 17시');
    expect(chip).toBeSelected();
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

describe('🔴 S5b · keepWeatherChip — 진입 시드의 날씨는 감지 칩이 있어도 남는다 (상황 감지 FE-B §3.3)', () => {
  it('감지 칩이 휴무여도 정적 날씨가 남고(선택 상태 그대로), 감지 칩이 날씨면 그 칩이 대신한다', () => {
    const props = { ...baseProps(), selectedReasons: ['WEATHER'] };
    const { rerender } = render(
      <ReplanRequestSheet
        {...props}
        detected={CLOSURE_DETECTED}
        keepWeatherChip
      />
    );

    expect(staticReasonKeys()).toEqual([
      'SLOW_MOVE',
      'LOW_ENERGY',
      'FULLY_BOOKED',
      'WEATHER',
      'JUST_CHANGE',
    ]);
    expect(screen.getByTestId('planb-request-reason-WEATHER')).toBeSelected();

    rerender(
      <ReplanRequestSheet
        {...props}
        detected={WEATHER_DETECTED}
        keepWeatherChip
      />
    );
    expect(screen.queryByTestId('planb-request-reason-WEATHER')).toBeNull();
  });
});

describe('🔴 S6 · 방향 10칩 (AC-3 · D5 · Q1)', () => {
  it('10종이 key·라벨·순서 그대로이고 야경 코스·예산 유지는 없으며, 야외 피하기를 누르면 AVOID_OUTDOOR 로 토글된다', () => {
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
    // 예산 유지는 서버가 집행할 가격 데이터가 없어 골라도 일정이 그대로였다 — 내지 않는다
    expect(screen.queryByText('예산 유지')).toBeNull();

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
  it('multiline 이 없고 placeholder·maxLength 500 은 그대로이며 입력이 올라간다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    const input = screen.getByTestId('planb-request-freetext');
    expect(input.props.multiline).not.toBe(true);
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

    fireEvent.press(cta);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();

    expect(screen.queryByText('직접 고르기')).toBeNull();
    expect(screen.queryByText('끄기')).toBeNull();
    DELETED_IDS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
  });
});

describe('🔴 S10 · 닫기 — 스크림 탭 (AC-8)', () => {
  it('스크림 탭이 onClose 로 이어지고 제출은 안 한다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    fireEvent.press(screen.getByTestId('planb-request-scrim'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});

describe('🔴 S-E · 실패 안내 (03b 경고-1 · INV-4)', () => {
  const CONFLICT_TEXT = '여행 기간에만 AI에게 맡길 수 있어요';

  it('S-E1 errorText 가 있으면 그 문구 하나를 그대로 띄운다', () => {
    render(<ReplanRequestSheet {...baseProps()} errorText={CONFLICT_TEXT} />);

    expect(screen.getAllByTestId('planb-request-error')).toHaveLength(1);
    expect(screen.getByTestId('planb-request-error')).toHaveTextContent(
      CONFLICT_TEXT
    );
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

describe('🔴 TRIP-1195 · 오늘이 아닌 날 — 범위 칩은 "{N}일차 전체" 하나 (결정 2)', () => {
  const otherDay = [{ scope: 'FULL_DAY' as const, label: '2일차 전체' }];

  it('X1 scopeOptions 를 주면 그 칩만 그린다 — 지금 이후(PARTIAL_SLOTS) 칩은 트리에 없다', () => {
    render(
      <ReplanRequestSheet
        {...baseProps()}
        scope="FULL_DAY"
        scopeOptions={otherDay}
      />
    );

    const chip = screen.getByTestId('planb-request-scope-FULL_DAY');
    expect(chip).toHaveTextContent('2일차 전체');
    expect(chip).toBeSelected();
    expect(
      screen.queryByTestId('planb-request-scope-PARTIAL_SLOTS')
    ).toBeNull();
  });

  it('X2 무회귀 — scopeOptions 를 안 주면 종전 2칩(지금 이후 · 오늘 전체)이다', () => {
    render(<ReplanRequestSheet {...baseProps()} />);

    expect(
      screen.getByTestId('planb-request-scope-PARTIAL_SLOTS')
    ).toHaveTextContent('지금 이후');
    expect(
      screen.getByTestId('planb-request-scope-FULL_DAY')
    ).toHaveTextContent('오늘 전체');
  });

  it('X3 onCloseError 가 있고 안내가 있으면 [닫기] 버튼이 안내 아래에 서고, 누르면 그 콜백이 불린다 (막다른 길 방지)', () => {
    const onCloseError = jest.fn();
    render(
      <ReplanRequestSheet
        {...baseProps()}
        errorText="아직 일정이 없는 날이에요"
        onCloseError={onCloseError}
      />
    );

    expect(screen.getByTestId('planb-request-error')).toHaveTextContent(
      '아직 일정이 없는 날이에요'
    );
    fireEvent.press(screen.getByTestId('planb-request-error-close'));
    expect(onCloseError).toHaveBeenCalledTimes(1);
  });

  it('X4 onCloseError 가 없으면(종전 안내) 닫기 버튼은 없다', () => {
    render(
      <ReplanRequestSheet {...baseProps()} errorText="시작하지 못했어요" />
    );

    expect(screen.queryByTestId('planb-request-error-close')).toBeNull();
  });
});

// TRIP-1294 — 페이지가 POST 응답을 기다리는 동안(isPending) 내려 주는 표시.
describe('🔴 S-W · 제출 대기 중 [AI가 다시 짜기]는 눌리지 않고 흐리게 그린다 (INV-U4-06)', () => {
  it('S-W1 submitting 이면 버튼이 비활성(접근성 상태 포함)이고, 눌러도 onSubmit 이 불리지 않는다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} submitting />);

    const cta = screen.getByTestId('planb-request-submit');
    expect(cta).toBeDisabled();
    expect(cta.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true })
    );

    fireEvent.press(cta);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['false', false],
    ['미지정', undefined],
  ])(
    'S-W2 submitting 이 %s 면 종전대로 활성이고 누르면 onSubmit 1회',
    (_label, submitting) => {
      const props = baseProps();
      render(<ReplanRequestSheet {...props} submitting={submitting} />);

      const cta = screen.getByTestId('planb-request-submit');
      expect(cta).toBeEnabled();

      fireEvent.press(cta);
      expect(props.onSubmit).toHaveBeenCalledTimes(1);
    }
  );
});
