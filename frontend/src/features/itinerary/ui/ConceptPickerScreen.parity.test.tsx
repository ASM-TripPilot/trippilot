import { View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ConceptPickerScreen } from './ConceptPickerScreen';

/**
 * TRIP-794 · h09 컨셉 고르기 Figma 정합(3845:2227) — 프레젠테이션만 바뀐다(행위 계약 불변).
 *
 * 동결 앵커는 형제 파일이 지킨다: `ConceptPickerScreen.test.tsx`(C1~C3 행위)·
 * `ConceptPickerScreen.icon.test.tsx`(U2 틴트)는 **무변경**으로 green 유지가 계약(AC-8). 이 파일은
 * 새로 붙는 표면만 잠근다.
 *
 * 무엇을 보장하나:
 *  - 🔴 AC-1 진행줄(일차/날짜 좌 · 슬롯 N/M 우 · 4분할 진행바) — props 로 받아 **Figma 그대로** 그린다
 *       (슬롯 3/4인데 bar 1칸인 모순도 화면이 안 고침, 브리프 §B).
 *  - 🔴 AC-3 헤드라인('다음, 뭘 할까요?'+부제) 제거.
 *  - 🔴 AC-4 컨셉 설명 5종을 config 값으로 렌더(문구 정본 = 브리프 §D).
 *  - 🔴 AC-5 배지(AI 추천/컨셉 매칭)·N곳 **렌더 0**(BE 계약 대기 — 픽스처 억지주입 금지).
 *  - 🔴 AC-6 첫 카드만 primary 테두리(정적, selectedKey prop 없음).
 *  - 🔴 AC-7 건너뛰기 회색 full pill 한 줄('테마 없이 건너뛰기 · AI가 알아서 추천'), 점선 제거.
 *  - 🔴 AC-2 배선 stepperSlot(ReactNode) 를 그린다 — CoPickStepper 위젯 자체는 별 파일(층 경계상
 *       features 는 widgets 를 import 못 해 SlotFillPage 가 노드로 내린다).
 *  - AC-8 행위 보존 — 새 표면 공존 하에서도 카드 탭·스킵 콜백 그대로.
 *
 * *(개념)* `queryBy*`===null = 부재 단언(`getBy*`는 못 찾으면 throw 라 부정에 못 씀). `toHaveTextContent`
 *  문자열은 완전일치(RNTL v13 exact, 02a §5-1). `className` 색·테두리 토큰은 공백 쪼갠 정확 토큰으로 본다.
 */

const CONCEPTS = [
  { key: 'meal', label: '식사' },
  { key: 'cafe', label: '카페·디저트' },
  { key: 'culture', label: '전시·문화' },
  { key: 'outdoor', label: '야외·산책' },
  { key: 'shopping', label: '쇼핑' },
] as const;

// 설명 문구 정본 — 브리프 §D 표(config `CONCEPT_DESCRIPTIONS` 와 값 일치, F4 가 config 소스를 잠근다).
const DESC: Record<string, string> = {
  meal: '근처 로컬 맛집',
  cafe: '전시 보고 쉬어가기 좋아요',
  culture: '미술 취향과 잘 맞아요',
  outdoor: '바다·공원 가까워요',
  shopping: '근처 상권',
};

const PROGRESS = {
  dayLabel: '1일차 / 4 · 6월 10일(수)',
  slotCurrent: 3,
  slotTotal: 4,
  barFilled: 1, // Figma 모순: 슬롯 3/4 인데 bar 1칸 — 화면은 안 고침(브리프 §B).
  barTotal: 4,
};

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

function classSet(testID: string): Set<string> {
  const node = screen.getByTestId(testID);
  return new Set(String(node.props.className ?? '').split(/\s+/));
}

// 새 표면 prop 을 다 준 상태로 렌더한다(파리티 테스트의 기본형).
function renderParity(overrides: Record<string, unknown> = {}): {
  onPickConcept: jest.Mock;
  onSkip: jest.Mock;
} {
  const onPickConcept = jest.fn();
  const onSkip = jest.fn();
  render(
    <ConceptPickerScreen
      concepts={CONCEPTS}
      progress={PROGRESS}
      stepperSlot={<View testID="fake-stepper" />}
      onPickConcept={onPickConcept}
      onSkip={onSkip}
      onBack={jest.fn()}
      {...(overrides as Record<string, never>)}
    />
  );
  return { onPickConcept, onSkip };
}

describe('🔴 S0 · INV-3 탐지기 자가검사', () => {
  it('소요시간은 잡고, 시간대·슬롯 수·날짜는 안 잡는다', () => {
    expect(DURATION_TEXT.test('30분')).toBe(true);
    expect(DURATION_TEXT.test('오후 · 전시')).toBe(false);
    expect(DURATION_TEXT.test('슬롯 3 / 4')).toBe(false);
    expect(DURATION_TEXT.test('6월 10일(수)')).toBe(false);
  });
});

describe('🔴 AC-1 · 진행줄 (일차/날짜 · 슬롯 N/M · 4분할 바)', () => {
  it('progress prop 을 Figma 그대로 렌더한다(모순 포함, 화면은 안 고침)', () => {
    renderParity();

    // 진행줄 루트 + 좌 라벨(verbatim) + 우 슬롯 수.
    expect(
      screen.getByTestId('itinerary-copick-concept-progress')
    ).toBeTruthy();
    expect(
      screen.getByTestId('itinerary-copick-concept-progress-day')
    ).toHaveTextContent('1일차 / 4 · 6월 10일(수)');
    expect(
      screen.getByTestId('itinerary-copick-concept-progress-count')
    ).toHaveTextContent('3 / 4');

    // 4분할 진행바 — 채운 1칸 + 빈 3칸(색이 아니라 개수 계약).
    expect(
      screen.getAllByTestId('itinerary-copick-concept-progress-cell-filled')
    ).toHaveLength(1);
    expect(
      screen.getAllByTestId('itinerary-copick-concept-progress-cell-track')
    ).toHaveLength(3);
  });
});

describe('🔴 AC-3 · 헤드라인 제거', () => {
  it("'다음, 뭘 할까요?'·부제가 사라진다(카드는 남는다)", () => {
    renderParity();

    // 부정 — 헤드라인·부제 부재.
    expect(screen.queryByText('다음, 뭘 할까요?')).toBeNull();
    expect(
      screen.queryByText('여행 컨셉에 맞춰 추천 순서로 정렬했어요')
    ).toBeNull();

    // 긍정 짝 — 카드 5장은 여전히 있다(공허 통과 방지).
    for (const { key } of CONCEPTS) {
      expect(
        screen.getByTestId(`itinerary-copick-concept-${key}`)
      ).toBeTruthy();
    }
  });
});

describe('🔴 AC-4 · 컨셉 설명(config 값)', () => {
  it('5개 컨셉이 각자의 설명 문구를 렌더한다', () => {
    renderParity();

    for (const { key } of CONCEPTS) {
      expect(
        screen.getByTestId(`itinerary-copick-concept-desc-${key}`)
      ).toHaveTextContent(DESC[key]);
    }
  });
});

describe('🔴 AC-5 · 배지·N곳 렌더 0 (BE 대기, 억지주입 금지)', () => {
  it('AI 추천/컨셉 매칭 배지·N곳 문구가 하나도 없다(카드는 있다)', () => {
    renderParity();

    // 부정 — 배지·카운트 문구 0.
    expect(screen.queryByText('AI 추천')).toBeNull();
    expect(screen.queryByText('컨셉 매칭')).toBeNull();
    expect(screen.queryByText(/\d+\s*곳/)).toBeNull();

    // 긍정 짝 — 카드 자체는 렌더(부정이 "카드가 통째로 없어서" 참인 공허 통과 차단).
    expect(screen.getByTestId('itinerary-copick-concept-meal')).toBeTruthy();
  });
});

describe('🔴 AC-6 · 첫 카드 정적 primary 테두리', () => {
  it('첫 카드(meal)만 border-primary, 둘째(cafe)는 아니다', () => {
    renderParity();

    expect(
      classSet('itinerary-copick-concept-meal').has('border-primary')
    ).toBe(true);
    expect(
      classSet('itinerary-copick-concept-cafe').has('border-primary')
    ).toBe(false);
  });
});

describe('🔴 AC-7 · 건너뛰기 회색 full pill(한 줄)', () => {
  it('한 줄 문구 · 점선 제거 · testID 불변', () => {
    renderParity();

    // testID 불변(행위 계약).
    const skip = screen.getByTestId('itinerary-copick-concept-skip');
    expect(skip).toBeTruthy();

    // 한 줄 문구(구 2줄 SKIP_LABEL/SKIP_HINT → 한 Text 로 병합).
    expect(
      screen.getByText('테마 없이 건너뛰기 · AI가 알아서 추천')
    ).toBeTruthy();

    // 점선 테두리 제거(구 border-dashed) — 회색 채움 pill 로 교체(색 토큰은 6-b).
    expect(classSet('itinerary-copick-concept-skip').has('border-dashed')).toBe(
      false
    );
  });
});

describe('🔴 AC-2 · stepperSlot 배선', () => {
  it('내려준 stepper 노드를 그린다(위젯 본체는 CoPickStepper.test.tsx)', () => {
    renderParity();
    expect(screen.getByTestId('fake-stepper')).toBeTruthy();
  });
});

describe('AC-8 · 행위 계약 보존(새 표면 공존)', () => {
  it('카드 탭 → onPickConcept(label) · 스킵 → onSkip', () => {
    const { onPickConcept, onSkip } = renderParity();

    fireEvent.press(screen.getByTestId('itinerary-copick-concept-culture'));
    expect(onPickConcept).toHaveBeenCalledWith('전시·문화');

    fireEvent.press(screen.getByTestId('itinerary-copick-concept-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('INV-3 — 렌더 전 텍스트에 소요시간 0', () => {
    renderParity();
    expect(screen.queryByText(DURATION_TEXT)).toBeNull();
  });
});
