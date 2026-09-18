import { fireEvent, render, screen } from '@testing-library/react-native';

import { ConceptPickerScreen } from './ConceptPickerScreen';

/**
 * AC-2 (h13 컨셉) — 컨셉 카드를 탭하면 그 라벨이 그대로 배선으로 넘어가고("concept" 문자열),
 * "테마 없이 건너뛰기"는 컨셉 아닌 별도 경로(onSkip)임을 보장한다.
 *
 * 화면은 순수 — 컨셉 목록은 props 로 받고, 탭은 콜백으로만 알린다(선택 상태를 스스로 안 든다).
 * 3동작: 준비=컨셉 목록·스파이 → 실행=카드/스킵 탭 → 단언=콜백 인자.
 */

const CONCEPTS = [
  { key: 'meal', label: '식사' },
  { key: 'cafe', label: '카페' },
  { key: 'culture', label: '전시·문화' },
  { key: 'outdoor', label: '야외·산책' },
  { key: 'shopping', label: '쇼핑' },
] as const;

function renderScreen(overrides: Record<string, unknown> = {}) {
  const onPickConcept = jest.fn();
  const onSkip = jest.fn();
  render(
    <ConceptPickerScreen
      concepts={CONCEPTS}
      slotContextLabel="오후 슬롯 · △△ 미술관 다음"
      onPickConcept={onPickConcept}
      onSkip={onSkip}
      onBack={jest.fn()}
      {...overrides}
    />
  );
  return { onPickConcept, onSkip };
}

describe('🔴 ConceptPickerScreen (h13 · AC-2)', () => {
  it('C1 · 5개 컨셉 카드가 렌더된다', () => {
    renderScreen();

    // 준비/실행: 렌더. 단언: 5개 key 카드 모두 존재.
    expect(screen.getByTestId('itinerary-copick-concept-root')).toBeTruthy();
    for (const { key } of CONCEPTS) {
      expect(
        screen.getByTestId(`itinerary-copick-concept-${key}`)
      ).toBeTruthy();
    }
  });

  it('C2 · 컨셉 카드 탭 → 그 라벨이 onPickConcept 인자로 그대로 전달', () => {
    const { onPickConcept } = renderScreen();

    // 실행: "전시·문화" 카드 탭.
    fireEvent.press(screen.getByTestId('itinerary-copick-concept-culture'));

    // 단언: 정확한 라벨 fidelity(라벨 = concept 문자열).
    expect(onPickConcept).toHaveBeenCalledWith('전시·문화');
    expect(onPickConcept).toHaveBeenCalledTimes(1);
  });

  it('C3 · "테마 없이 건너뛰기" 탭 → onSkip(컨셉 미전송 경로)', () => {
    const { onPickConcept, onSkip } = renderScreen();

    // 실행: 스킵 탭.
    fireEvent.press(screen.getByTestId('itinerary-copick-concept-skip'));

    // 단언: 스킵은 컨셉이 아니다 — onSkip 만, onPickConcept 는 0회.
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onPickConcept).toHaveBeenCalledTimes(0);
  });
});
