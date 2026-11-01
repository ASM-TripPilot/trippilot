import { fireEvent, render, screen } from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/index.schemas';

import { SlotFillScreen } from './SlotFillScreen';

/**
 * h14/h15 슬롯 채우기 — **페이지 통합으로 못 만드는 것만** 남긴 뷰 단위 파일(B안 (c), 2026-11-01).
 *
 * 나머지(반경 세그·배지·캡션·0건 사유 얼굴·잠금·조회 실패·스켈레톤·지도·카드 이름/태그·제목·진행줄)는
 * `SlotFillPage.integration.test.tsx` 가 실 react-query + MSW 로 본다. 남긴 이유: 페이지는 후보가 오면 A 를
 * 자동 선택해(TRIP-1073) "후보는 있는데 선택이 없는" 상태를 만들 수 없다 — 그 상태의 확정 잠금(죽은 버튼
 * 회피)은 화면 props 로만 세운다.
 */

const CANDIDATES: SlotCandidatesCandidatesItem[] = [
  { poiId: 'A1', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
  { poiId: 'B2', distanceRange: '770m', rationale: '전시+카페 한 번에' },
];

const RADIUS_STEPS = [
  { key: 'near', label: '700m' },
  { key: 'mid', label: '1.1km' },
  { key: 'max', label: '최대' },
] as const;

function renderScreen(overrides: Record<string, unknown> = {}) {
  const spies = {
    onSelectRadius: jest.fn(),
    onSelectRadio: jest.fn(),
    onConfirm: jest.fn(),
    onExpandRadius: jest.fn(),
    onShrinkRadius: jest.fn(),
    onChangeConcept: jest.fn(),
    onBack: jest.fn(),
  };
  render(
    <SlotFillScreen
      candidates={CANDIDATES}
      radiusSteps={RADIUS_STEPS}
      selectedRadiusKey="mid"
      radiusUsedLabel={null}
      candidateCountLabel="후보 2곳"
      selectedPoiId={null}
      canExpandRadius
      isPending={false}
      errorMessage={null}
      {...spies}
      {...overrides}
    />
  );
  return spies;
}

describe('🔴 SlotFillScreen — 선택 전 확정 잠금 (페이지가 못 만드는 상태)', () => {
  it('C2 · AC-3 선택 전 CTA disabled + onPress 미부여(press 무발화) → 라디오 선택', () => {
    const { onConfirm, onSelectRadio } = renderScreen({ selectedPoiId: null });

    // 단언: 선택 전 CTA 는 disabled 이고, 눌러도 확정 콜백 0회(죽은 버튼 회피).
    const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
    expect(confirm.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(0);

    // 실행: 라디오 선택 → 선택 콜백만.
    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-A1'));
    expect(onSelectRadio).toHaveBeenCalledWith('A1');
  });
});
