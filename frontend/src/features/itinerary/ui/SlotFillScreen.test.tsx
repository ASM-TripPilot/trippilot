import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { SlotFillScreen } from './SlotFillScreen';

/**
 * h14/h15 슬롯 채우기 화면 — 순수(선택·반경단계는 controlled, 배선이 소유).
 *
 * 무엇을 보장하나:
 *  - AC-3: 반경 3단 세그먼트 렌더+선택 관찰(색 아님 · accessibilityState) · 후보 라디오 단일선택 ·
 *          "A로 선택" 2단계 CTA(선택 전/펜딩 disabled + onPress 미부여로 죽은 버튼 회피).
 *  - AC-4: 서버 radiusMUsed 포맷 문자열을 그대로 표시(radius-used leaf).
 *  - AC-5+E3: 후보 0건 → 반경확대·컨셉변경 CTA. max 단계(3단)면 확대 disabled + 문구 전환.
 *  - INV-1: 렌더된 후보 = 응답 poiId 집합(임의 POI 0).
 *  - 배지 A부터(슬라이스1 candidateBadge 는 B부터 — 재사용 함정).
 *  - AC-8: 실패 인라인 문구(빈 문자열 0).
 *
 * candidate poiId 는 'A1'/'B2' 로 둔다 — 카드 배지 문자('A'/'B')와 헷갈리지 않게(★1).
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

describe('🔴 SlotFillScreen (h14/h15)', () => {
  it('C1 · AC-3 반경 3단 세그먼트 + 선택 관찰(accessibilityState.selected)', () => {
    const { onSelectRadius } = renderScreen({ selectedRadiusKey: 'mid' });

    // 단언: 3개 세그먼트 present, 선택은 색이 아니라 accessibilityState 로 관찰.
    const mid = screen.getByTestId('itinerary-copick-radius-seg-mid');
    const near = screen.getByTestId('itinerary-copick-radius-seg-near');
    const max = screen.getByTestId('itinerary-copick-radius-seg-max');
    expect(mid.props.accessibilityState?.selected).toBe(true);
    expect(near.props.accessibilityState?.selected).toBe(false);
    expect(max.props.accessibilityState?.selected).toBe(false);

    // 실행: near 탭 → 콜백 1회.
    fireEvent.press(near);
    expect(onSelectRadius).toHaveBeenCalledWith('near');
  });

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

  it('C3 · AC-3 선택 후 CTA 활성 + "A로 선택" 라벨 · press → onConfirm', () => {
    const { onConfirm } = renderScreen({
      selectedPoiId: 'A1',
      isPending: false,
    });

    const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
    // 단언: 첫 후보 배지 A → 라벨 "A로 선택"(정규식 = 더 긴 문장 안 조각).
    expect(confirm.props.accessibilityState?.disabled).not.toBe(true);
    expect(confirm).toHaveTextContent(/A로 선택/);

    fireEvent.press(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('C4 · AC-3 펜딩 중 CTA disabled + press 무발화', () => {
    const { onConfirm } = renderScreen({
      selectedPoiId: 'A1',
      isPending: true,
    });

    const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
    expect(confirm.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(0);
  });

  it('C5 · 배지 A부터 — 첫 후보 A, 둘째 B(슬라이스1 B부터 재사용 함정)', () => {
    renderScreen();

    // 단언: 카드 안 배지 텍스트를 within 으로 스코프해 확인(getByText 완전일치).
    const cardA = within(screen.getByTestId('itinerary-candidate-A1'));
    const cardB = within(screen.getByTestId('itinerary-candidate-B2'));
    expect(cardA.getByText('A')).toBeTruthy();
    expect(cardB.getByText('B')).toBeTruthy();
  });

  it('C6 · AC-4 radiusMUsed 그대로 표시 · 응답 전엔 부재', () => {
    // 준비: 서버 파생 반경 표시.
    renderScreen({ radiusUsedLabel: '약 11.3km' });
    expect(
      screen.getByTestId('itinerary-copick-radius-used')
    ).toHaveTextContent('약 11.3km');

    // 응답 전(null) → 그 leaf 자체가 없다.
    screen.unmount();
    renderScreen({ radiusUsedLabel: null });
    expect(screen.queryByTestId('itinerary-copick-radius-used')).toBeNull();
  });

  it('C7 · INV-1 렌더 후보 집합 = 응답 poiId 집합(임의 POI 0)', () => {
    renderScreen();

    // 후보-집합 셀렉터: 하위/특수 testID 를 부정 룩어헤드로 제외 → 카드 루트만.
    const poiIds = screen
      .getAllByTestId(
        /^itinerary-candidate-(?!radio-|name-|image-|distance-|rationale-|current$|select-)/
      )
      .map((node) => node.props.testID.replace('itinerary-candidate-', ''))
      .sort();
    expect(poiIds).toEqual(['A1', 'B2']);
  });

  it('C8 · AC-5 후보 0건 완화 CTA(1·2단 = 확대 활성)', () => {
    const { onExpandRadius, onChangeConcept } = renderScreen({
      candidates: [],
      canExpandRadius: true,
    });

    expect(screen.getByTestId('itinerary-copick-zero')).toBeTruthy();
    const expand = screen.getByTestId('itinerary-copick-zero-radius');
    expect(expand.props.accessibilityState?.disabled).not.toBe(true);
    fireEvent.press(expand);
    expect(onExpandRadius).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('itinerary-copick-zero-concept'));
    expect(onChangeConcept).toHaveBeenCalledTimes(1);
  });

  it('C9 · AC-5+E3 3단(max) 0건 → 확대 disabled + 문구 전환 · 컨셉변경만 활성', () => {
    const { onExpandRadius, onChangeConcept } = renderScreen({
      candidates: [],
      canExpandRadius: false,
    });

    const expand = screen.getByTestId('itinerary-copick-zero-radius');
    // 단언: 더 넓힐 곳이 없으니 확대는 disabled + 눌러도 무발화.
    expect(expand.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(expand);
    expect(onExpandRadius).toHaveBeenCalledTimes(0);
    // 문구 전환(넓혀도 없음) present.
    expect(screen.getByText(/더 넓혀도|없어요/)).toBeTruthy();

    // 컨셉 변경은 여전히 활성.
    fireEvent.press(screen.getByTestId('itinerary-copick-zero-concept'));
    expect(onChangeConcept).toHaveBeenCalledTimes(1);
  });

  it('C10 · AC-8 조회/저장 실패 인라인 문구(빈 문자열 0)', () => {
    renderScreen({
      errorMessage: '지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요',
    });

    const err = screen.getByTestId('itinerary-copick-slotfill-error');
    expect(err).toHaveTextContent(/바꿀 수 없어요/);
  });
});
