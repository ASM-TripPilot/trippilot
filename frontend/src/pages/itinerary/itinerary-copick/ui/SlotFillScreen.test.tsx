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

/**
 * TRIP-1669 · 찾는 중심 영역(순수 뷰) — 페이지가 못 만드는 것만 남겼다(B안 (c)).
 *
 *  - `centerChoice` 를 안 주면 영역이 없다 — 프리뷰(`app/_dev/preview.tsx`)가 이 prop 없이 뷰를 격리 렌더하는 계약.
 *    페이지는 늘 prop 을 주므로 통합으로는 만들 수 없다.
 *  - 후보 목록·조회 중(스켈레톤)·0건·조회 실패 네 얼굴 모두에 영역이 붙는다 — 페이지로는 얼굴을 하나씩 만들기 어렵다.
 *
 * 나머지(제목·글자·선택 표시·펼침/접기·숙소 근처 유무·안내·눌림·시간 표현 0)는 `SlotFillPage.integration.test.tsx`
 * 「찾는 중심 고르기」가 실 요청으로 본다(02a §8).
 */
describe('🔴 SlotFillScreen — 찾는 중심 영역 (TRIP-1669)', () => {
  const OPT = (key: string) => `itinerary-copick-center-opt-${key}`;

  function choice() {
    return {
      selected: 'auto',
      expanded: false,
      stayAvailable: true,
      notice: null,
      onToggleExpanded: jest.fn(),
      onSelect: jest.fn(),
    };
  }

  it('SC0 · centerChoice 를 안 주면 영역이 없다(선제 green — 기존 호출·프리뷰 무회귀)', () => {
    renderScreen();

    expect(screen.queryByTestId('itinerary-copick-center-root')).toBeNull();
    expect(screen.queryByTestId(OPT('auto'))).toBeNull();
  });

  it.each([
    ['후보 목록', {}],
    ['후보 조회 중(스켈레톤)', { candidates: [], candidatesPending: true }],
    ['0건 얼굴', { candidates: [] }],
    [
      '조회 실패 얼굴',
      { candidates: [], candidatesErrorMessage: '불러오지 못했어요' },
    ],
  ] as const)(
    'SC7 · %s 에서도 영역이 있다(중심을 거기서 바꿀 수 있다)',
    (_face, overrides) => {
      renderScreen({ centerChoice: choice(), ...overrides });

      expect(screen.getByTestId('itinerary-copick-center-root')).toBeTruthy();
      expect(screen.getByTestId(OPT('auto'))).toBeTruthy();
    }
  );
});

/**
 * TRIP-1780 범위 그물 — 추천 이유 "문장" 모드(`rationaleSentence`)는 h08 시트만 켠다. 같이 짜기 후보 카드는
 * 지금 모양 그대로다(이름 아래·제한 없음·muted 는 생김새라 6-b 몫).
 *
 * 비시각 판별 신호: 문장 모드는 빈 문장의 요소를 그리지 않는다. copick 이 모드를 받았다면 빈 rationale 후보의 leaf
 * 가 사라지므로, **rationale 이 빈 후보의 빈 leaf 가 그대로 있다**는 것이 "무변경"의 신호다.
 * (값이 있는 후보 문장도 같이 단언해 leaf 자체가 안 그려지는 경우와 구별한다.)
 */
describe('🔴 SlotFillScreen — TRIP-1780 copick 후보 카드는 무변경', () => {
  it('CP-1780 · 문장이 있는 후보는 그대로, 문장이 빈 후보도 빈 leaf 로 그려진다(문장 모드 미적용)', () => {
    renderScreen({
      candidates: [
        ...CANDIDATES,
        { poiId: 'C3', distanceRange: '1.2km', rationale: '' },
      ],
    });

    expect(
      screen.getByTestId('itinerary-candidate-rationale-A1')
    ).toHaveTextContent('가장 가까운 실내 전시');
    expect(
      screen.getByTestId('itinerary-candidate-rationale-B2')
    ).toHaveTextContent('전시+카페 한 번에');
    expect(
      screen.getByTestId('itinerary-candidate-rationale-C3')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-candidate-rationale-C3')
    ).toHaveTextContent('');
  });
});
