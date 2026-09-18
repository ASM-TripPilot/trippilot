import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { OptionSwapScreen } from './OptionSwapScreen';

/**
 * h18 옵션 교체 화면 — 순수 화면(props+콜백만). h12 시트와 **같은 오퍼레이션**이지만 확정 UX 가
 * 다르다: 라디오 단일선택 후 "B로 교체" CTA 를 눌러야 확정한다(2단계).
 *
 * 무엇을 보장하나:
 *  - 후보 카드 집합 = 응답 집합, 이름 플레이스홀더, poiId 원문 비노출(AC6·INV-1).
 *  - 라디오 탭이 그 poiId 를 올린다(AC3).
 *  - 선택 전엔 CTA disabled 로 무발화, 선택 후엔 활성 → 한 번 눌러 확정(AC3 2단계).
 *  - 왕복 중엔 CTA disabled(AC4).
 *  - 후보 0건 인라인·CTA 부재(AC5), errorMessage 인라인·back 미호출(AC7).
 *
 * 선택 상태는 controlled 다 — 화면이 스스로 안 든다(selectedPoiId 는 prop, 배선이 소유).
 *
 * 3동작 뼈대: 준비=props → 실행=렌더/press → 단언=보이는 것·콜백.
 */

const CURRENT_POI = 'cur';

const CANDIDATES: SlotCandidatesCandidatesItem[] = [
  { poiId: 'A', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
  { poiId: 'B', distanceRange: '1.1km', rationale: '조용한 카페' },
];

const CANDIDATE_ROOT =
  /^itinerary-candidate-(?!sheet|current|empty|error|name-|image-|distance-|rationale-|select-|radio-)/;

const renderedCandidatePoiIds = () =>
  screen
    .getAllByTestId(CANDIDATE_ROOT)
    .map((node) =>
      String(node.props.testID).replace('itinerary-candidate-', '')
    );

function renderScreen(
  overrides: Partial<Parameters<typeof OptionSwapScreen>[0]> = {}
) {
  return render(
    <OptionSwapScreen
      candidates={CANDIDATES}
      currentPoiId={CURRENT_POI}
      selectedPoiId={null}
      onSelectRadio={jest.fn()}
      onConfirm={jest.fn()}
      isPending={false}
      onBack={jest.fn()}
      {...overrides}
    />
  );
}

describe('🔴 OptionSwapScreen (h18)', () => {
  it('C1 · AC6·INV-1 — 렌더 카드 집합 = 응답 집합, 이름 플레이스홀더, poiId 원문 비노출', () => {
    renderScreen();

    expect(renderedCandidatePoiIds().sort()).toEqual(['A', 'B'].sort());
    for (const cand of CANDIDATES) {
      expect(
        screen.getByTestId(`itinerary-candidate-name-${cand.poiId}`)
      ).toHaveTextContent('이름 준비 중');
      const card = within(
        screen.getByTestId(`itinerary-candidate-${cand.poiId}`)
      );
      expect(card.queryByText(cand.poiId)).toBeNull();
    }
  });

  it('C2 · AC3 — 라디오 탭이 그 poiId 로 onSelectRadio 를 1회 부른다', () => {
    const onSelectRadio = jest.fn();
    renderScreen({ onSelectRadio });

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-B'));

    expect(onSelectRadio).toHaveBeenCalledTimes(1);
    expect(onSelectRadio).toHaveBeenCalledWith('B');
  });

  it('C3 · AC3 2단계 — 선택 전 CTA 는 disabled 이고 눌러도 확정이 안 나간다', () => {
    const onConfirm = jest.fn();
    renderScreen({ selectedPoiId: null, onConfirm });

    const cta = screen.getByTestId('itinerary-option-swap-confirm');
    fireEvent.press(cta);

    expect(cta.props.accessibilityState.disabled).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(0);
  });

  it('C4 · AC3 2단계 — 선택 후 CTA 활성, 한 번 누르면 onConfirm 1회', () => {
    const onConfirm = jest.fn();
    renderScreen({ selectedPoiId: 'B', isPending: false, onConfirm });

    const cta = screen.getByTestId('itinerary-option-swap-confirm');

    expect(cta.props.accessibilityState.disabled).not.toBe(true);
    expect(cta).toHaveTextContent(/교체/);

    fireEvent.press(cta);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('C5 · AC4 — 왕복 중엔 선택돼 있어도 CTA disabled·무발화', () => {
    const onConfirm = jest.fn();
    renderScreen({ selectedPoiId: 'B', isPending: true, onConfirm });

    const cta = screen.getByTestId('itinerary-option-swap-confirm');
    fireEvent.press(cta);
    fireEvent.press(cta);

    expect(cta.props.accessibilityState.disabled).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(0);
    expect(screen.queryByText(/바꾸는 중|교체 중/)).not.toBeNull();
  });

  it('C6 · AC5 — 후보 0건: 인라인 안내, 반경/컨셉 CTA 없음', () => {
    renderScreen({ candidates: [] });

    expect(screen.getByTestId('itinerary-option-swap-empty')).toHaveTextContent(
      /찾지 못했어요/
    );
    expect(screen.queryAllByTestId(CANDIDATE_ROOT)).toEqual([]);
    expect(screen.queryByText(/반경 넓히기|반경 확대|컨셉/)).toBeNull();
  });

  it('C7 · AC7 — errorMessage 는 인라인으로 뜨고 back 은 안 나간다', () => {
    const onBack = jest.fn();
    renderScreen({ errorMessage: '잠시 후 다시 시도해 주세요', onBack });

    expect(screen.getByTestId('itinerary-option-swap-error')).toHaveTextContent(
      /다시 시도/
    );
    expect(onBack).toHaveBeenCalledTimes(0);
  });
});
