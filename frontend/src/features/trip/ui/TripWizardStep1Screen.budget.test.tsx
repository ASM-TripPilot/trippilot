import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { REGIONS } from '@/features/explore/model/regions';

import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

/**
 * TRIP-207 g01 예산 블록 — **화면이 그리는 표면**(Figma `sec_budget` 2225:2375 실측).
 *
 * 무엇을 보장하나: 예산 블록이 취향 카드 뒤·하단 CTA 앞에 정본 문구대로 서고, 입력이 **제어
 * 입력**으로서 원문을 가공 없이 위로 올려보내며(01b D8 — 실시간 재포맷 금지), 오류 문구와
 * 프리필 안내는 **완성된 prop을 받았을 때만** 그려진다(TRIP-206 D1 관례 — 화면은 판정하지
 * 않는다). 그리고 **어떤 예산 값에도 파생값을 그리지 않는다**(AC-6).
 *
 * 왜 새 파일인가: `TripWizardStep1Screen.test.tsx`·`…errors.test.tsx`는 게이트①로 승인·동결된
 * 파일이다. 이 사이클이 그중 손대는 것은 전자의 AC-13 **한 it뿐**이고(02a §6-3), 나머지는
 * 한 줄도 건드리지 않는다.
 *
 * 커버하지 않는 것: **언제** 프리필·오류가 서는지(= `touched` 게이팅·파싱 판정)는 컨테이너
 * 몫이라 `TripNewStep1Page.budget.test.tsx`가 본다. `수정`의 **실제 포커스 이동**은 RNTL에
 * 포커스 매처가 없고 test renderer가 네이티브 포커스를 구현하지 않아 관찰 불가다 — [검증]
 * 육안 확인 항목이다(02a §7). 픽셀 충실도도 [검증] 스크린샷 대조 몫이다.
 *
 * ⚠️ 매처 함정(02a §5-2 실측): `toHaveDisplayValue('문자열')`은 **완전 일치**다 — 값이
 * `'1,200,000'`일 때 `toHaveDisplayValue('1,200')`은 실패한다. 부분 확인은 정규식으로 한다.
 * `toHaveTextContent('문자열')`도 같은 성질이다(2026-07-22 문제로그).
 *
 * 3동작 뼈대: 준비=props 조립 → 실행=render(+changeText/press/blur) → 단언=보이는 값 / 콜백.
 */

/**
 * 이 칸이 `TripWizardStep1ScreenProps`에 추가할 것(02a §2-5). **전부 optional이어야 한다** —
 * 승인된 두 파일의 props 팩토리가 전 필드 전수 리터럴이라, 하나라도 필수로 만들면 그 승인
 * 파일들이 tsc에서 깨진다(02a ★9, TRIP-206에서 실측된 함정).
 */
interface TripWizardStep1BudgetProps {
  /** 예산 입력에 그릴 **원문**(콤마 포함 가능). 없으면 빈 입력. */
  budgetText?: string;
  /** 취향에서 채워진 값인가 — true일 때만 Figma 고정 안내 문구를 그린다. */
  budgetPrefilled?: boolean;
  /** 예산 블록 인라인 문구(완성형). 화면은 문자열을 그대로 그릴 뿐 만들지 않는다. */
  budgetError?: string;
  onChangeBudget?(next: string): void;
  onBlurBudget?(): void;
  onPressBudgetEdit?(): void;
}

type Props = TripWizardStep1ScreenProps & TripWizardStep1BudgetProps;

/** Figma `2225:2391` 실측 문자열. ⚠️ 따옴표는 **곡선 따옴표**(‘ U+2018 / ’ U+2019)다 —
 * 곧은 `'`(U+0027)가 아니다. 브리프·Seed 본문에는 곧은 따옴표로 저장돼 있어 그대로 옮기면
 * 조용히 어긋난다(02a ★11 — 라이브 Figma를 직접 열어 확정했다). `formatDateRange`의
 * en dash(U+2013)와 같은 성질이다. */
const PREFILL_NOTE = '온보딩에서 고른 ‘중간(50~150만)’ 범위로 채웠어요';

/** 기준일 2026-06-10 + `3박 4일` 프리셋이 만드는 범위(승인 파일과 같은 값). */
const START = '2026-06-10';
const END = '2026-06-13';

/** 초기(빈) 드래프트 — 예산 prop은 하나도 없다. */
function props(over: Partial<Props> = {}): Props {
  return {
    destinations: [],
    startDate: undefined,
    endDate: undefined,
    presetCode: undefined,
    party: 1,
    companionType: undefined,
    preferenceChips: [],
    regions: REGIONS,
    canProceed: false,
    onBack: jest.fn(),
    onAddDestination: jest.fn(),
    onRemoveDestination: jest.fn(),
    onSelectPreset: jest.fn(),
    onPressPeriod: jest.fn(),
    onChangeParty: jest.fn(),
    onSelectCompanion: jest.fn(),
    onChangePreference: jest.fn(),
    onNext: jest.fn(),
    ...over,
  };
}

/** 정상적으로 다 채운 드래프트(승인 파일과 같은 값). */
function filledProps(over: Partial<Props> = {}): Props {
  return props({
    destinations: [
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '경주', nights: 1 },
    ],
    startDate: START,
    endDate: END,
    presetCode: '3n4d',
    party: 2,
    companionType: '친구',
    preferenceChips: ['미식', '전시', '야경'],
    canProceed: true,
    ...over,
  });
}

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

function block() {
  return screen.getByTestId('trip-wizard-budget-block');
}

function input() {
  return screen.getByTestId('trip-wizard-budget-input');
}

describe('AC-7① · 정본 문구가 실측대로 있다 (Figma 2225:2375)', () => {
  it('예산 · 선택 · ₩ · 원 · 1인 총액 기준 · 수정이 모두 블록 안에 있다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    const budget = block();
    // 블록 안으로 범위를 좁혀 본다 — 화면 다른 곳의 같은 글자와 섞이지 않게.
    ['예산', '선택', '₩', '원', '1인 총액 기준', '수정'].forEach((text) => {
      expect(within(budget).getByText(text)).toBeOnTheScreen();
    });
  });
});

describe('AC-7② · 블록이 취향 카드 뒤 · 하단 CTA 앞에 놓인다', () => {
  it('세 앵커가 트리 순서대로 나타난다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    // *(개념)* `getAllByTestId`에 정규식을 주면 매칭된 요소를 **트리 순서(pre-order)** 로
    // 돌려준다 — 부모가 먼저, 형제는 선언 순서대로(02a §5-1: 구현 확인 + 실행 확인).
    // 그래서 "무엇이 먼저 그려지는가"를 배열 비교 한 줄로 잠글 수 있다.
    const order = screen
      .getAllByTestId(/^trip-wizard-(pref-card|budget-block|step1-next)$/)
      .map((element) => element.props.testID);

    expect(order).toEqual([
      'trip-wizard-pref-card',
      'trip-wizard-budget-block',
      'trip-wizard-step1-next',
    ]);
  });
});

describe('AC-7③ · AC-5 — 편집 가능한 제어 입력이고, 원문을 가공하지 않는다', () => {
  it('입력이 편집 가능하고 친 문자열이 그대로 위로 올라간다', () => {
    const onChangeBudget = jest.fn();
    render(<TripWizardStep1Screen {...props({ onChangeBudget })} />);

    fireEvent.changeText(input(), '1200000');

    // 이 단언이 "편집 가능"의 증거를 겸한다 — RNTL의 `fireEvent`는 `editable !== false`인
    // TextInput에만 이벤트를 흘린다(02a §5-3 구현 확인). `editable={false}`면 콜백이
    // 아예 안 불려 여기서 실패한다.
    expect(onChangeBudget).toHaveBeenCalledWith('1200000');
    expect(onChangeBudget).toHaveBeenCalledTimes(1);
  });

  it('화면은 콤마를 찍지 않는다 — 받은 원문을 그대로 보여준다 (01b D8)', () => {
    const onChangeBudget = jest.fn();
    const { rerender } = render(
      <TripWizardStep1Screen {...props({ onChangeBudget })} />
    );

    // 공백·기호가 섞인 원문도 가공 없이 그대로 올린다. 화면이 여기서 다듬으면
    // "타이핑 중 원문 보존"(D8)이 화면 층에서 이미 깨진다.
    fireEvent.changeText(input(), ' 12ab, ');
    expect(onChangeBudget).toHaveBeenCalledWith(' 12ab, ');

    // 그리고 받은 값도 그대로 그린다 — 실시간 재포맷이 있으면 여기서 `1,200,000`이 된다.
    rerender(<TripWizardStep1Screen {...props({ budgetText: '1200000' })} />);
    expect(input()).toHaveDisplayValue('1200000');
  });

  it('blur는 값 변경 경로를 타지 않는다 — 알리기만 한다', () => {
    const onChangeBudget = jest.fn();
    const onBlurBudget = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ budgetText: '1200000', onChangeBudget, onBlurBudget })}
      />
    );

    fireEvent(input(), 'blur');

    // 짝 — blur가 스스로 `onChangeBudget`을 부르면 "사람이 값을 바꿨다"는 신호가 위조되고,
    // 그 신호가 touched를 켜서 **프리필이 잠긴다**(01b 불변식, 02a ★1-b). 화면 층에서
    // 그 경로를 먼저 막는다.
    expect(onBlurBudget).toHaveBeenCalledTimes(1);
    expect(onChangeBudget).not.toHaveBeenCalled();
  });
});

describe('AC-1 · 프리필 값과 안내 문구', () => {
  it('받은 값이 콤마가 찍힌 그대로 입력에 보인다', () => {
    render(<TripWizardStep1Screen {...props({ budgetText: '1,200,000' })} />);

    // ⚠️ 완전 일치다(02a §5-2 실측) — `toHaveDisplayValue('1,200')`은 실패한다.
    expect(input()).toHaveDisplayValue('1,200,000');
  });

  it('budgetPrefilled면 Figma 고정 안내 문구가 뜬다', () => {
    render(
      <TripWizardStep1Screen
        {...props({ budgetText: '1,200,000', budgetPrefilled: true })}
      />
    );

    expect(
      within(screen.getByTestId('trip-wizard-budget-note')).getByText(
        PREFILL_NOTE
      )
    ).toBeOnTheScreen();
  });

  it('짝 — 프리필이 아니면 안내 문구가 없고 입력은 비어 있다 (AC-1b)', () => {
    render(<TripWizardStep1Screen {...props()} />);

    expect(screen.queryByTestId('trip-wizard-budget-note')).toBeNull();
    // 제어 입력의 빈 상태. `undefined`가 아니라 빈 문자열이라야 값의 주인이 하나다.
    expect(input()).toHaveDisplayValue('');
  });
});

describe('AC-4 · 인라인 오류는 완성된 prop을 받았을 때만 그린다 (TRIP-206 D1)', () => {
  it('받은 문구를 그대로 그린다', () => {
    const message = '숫자만 입력해 주세요';
    render(<TripWizardStep1Screen {...props({ budgetError: message })} />);

    expect(
      within(screen.getByTestId('trip-wizard-error-budget')).getByText(message)
    ).toBeOnTheScreen();
  });

  it('짝 — 문구를 안 넘기면 아무것도 안 그린다', () => {
    // 화면은 원문을 보고 스스로 판정하지 않는다. 판정→문구 매핑은 컨테이너 몫이다.
    render(<TripWizardStep1Screen {...props({ budgetText: 'abc' })} />);

    expect(screen.queryByTestId('trip-wizard-error-budget')).toBeNull();
    // 짝(긍정) — 그런데도 값 자체는 그대로 남아 있다(AC-4의 "남아 있으면"이 성립하는 조건).
    expect(input()).toHaveDisplayValue('abc');
  });
});

describe('D2 · 수정 어포던스', () => {
  it('누르면 알림만 올라가고 값은 바뀌지 않는다', () => {
    const onPressBudgetEdit = jest.fn();
    const onChangeBudget = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          budgetText: '1,200,000',
          onPressBudgetEdit,
          onChangeBudget,
        })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-budget-edit'));

    expect(onPressBudgetEdit).toHaveBeenCalledTimes(1);
    // 짝 — `수정`이 표시↔편집 모드 전환이나 값 초기화를 하지 않는다(01b D2가 기각한 선택지).
    expect(onChangeBudget).not.toHaveBeenCalled();
    expect(input()).toHaveDisplayValue('1,200,000');
  });
});

describe('AC-6 · 금지 — 일수·인원으로 나눈 파생값을 그리지 않는다', () => {
  it('예산 120만 · 2명 · 3박 4일에서 나눗셈 결과가 화면에 없다', () => {
    render(
      <TripWizardStep1Screen
        {...filledProps({ budgetText: '1,200,000', party: 2 })}
      />
    );

    // ⚠️ Figma의 `1인 총액 기준`은 **고정 라벨이지 계산 결과가 아니다**(01b D4·AC-6). 그
    // 문구를 보고 `budgetTotal ÷ party`를 붙이는 순간 이 AC 위반이다 — 예산 분배는
    // 서버·AI 책임이고(US-TRIP-01), 클라가 다시 판정하면 서버와 갈라진다(INV-2 계열).
    [
      '600,000', // ÷ 2명
      '400,000', // ÷ 3박
      '300,000', // ÷ 4일
    ].forEach((derived) => {
      expect(screen.queryByText(derived)).toBeNull();
    });
    expect(root()).not.toHaveTextContent(/1인당|하루|일 평균|1일 예산/);

    // 짝(긍정) — **이게 없으면 아무것도 안 그리는 화면이 위 부정 단언을 공짜로 통과한다**
    // (TRIP-205 02a ★2 실측). 화면에 나타나는 예산 숫자는 받은 값 그 자체 하나뿐이다.
    expect(within(block()).getByText('1인 총액 기준')).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue('1,200,000');
  });

  it('INV-3 — 예산 값이 있어도 소요 시간 문자열은 나타나지 않는다', () => {
    render(
      <TripWizardStep1Screen {...filledProps({ budgetText: '1,200,000' })} />
    );

    expect(root()).not.toHaveTextContent(/소요/);
    expect(root()).not.toHaveTextContent(/\d+\s*분/);
    expect(root()).not.toHaveTextContent(/\d+\s*시간/);

    // 짝(긍정) — 스캔이 실제로 텍스트를 봤고, 위 정규식이 정상 표기를 오탐하지 않는다.
    expect(root()).toHaveTextContent(/3박 4일/);
    expect(root()).toHaveTextContent(/예산/);
  });
});
