import { Text } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { SlotFillScreen } from './SlotFillScreen';

// 지도 카드는 실 MapView(네이버 네이티브) 대신 관찰 목으로 태운다(리포 관례 —
// GenerationFallbackScreen.test 선례). 목이 props 를 host 로 노출해 viewOnly·connectPins·
// radiusCircle 전달을 관측한다. mapView 미전달 얼굴은 목을 안 쓴다(map-root 미렌더).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

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

/**
 * TRIP-795 · h10 후보 선택 — Figma 2프레임(3849 default·3850 wide) 정합. 5표면 변경(01b D1~D13).
 *
 * 무엇을 보장하나:
 *  - AC-1 앱바 동적 `{concept} 후보 고르기` · concept 없으면 정적 폴백(D2·D11).
 *  - AC-2 헤드라인 제거 + 진행줄(신규 namespace) + 스텝퍼 슬롯(D3·D9).
 *  - AC-3 지도 카드 additive(mapView 주면 렌더, 미주입 degrade)(D6·D7).
 *  - AC-4 후보 카드 픽스처(이름·태그) + 반경 밖 톤다운(dimmed 관통)(D1·D8).
 *  - AC-5 반경 넓히기/좁히기 **상시**(결과 얼굴 하단바, onShrinkRadius 신규)(D10).
 *  - AC-6 셋째 반경 세그 라벨 = maxRadiusLabel ?? '최대'(D4 → TRIP-978 에서 캡션값과 분리).
 *
 * ★ toHaveTextContent/getByText 는 **완전일치**(node_modules 실측, 02a §5) — 부분포함은 regex.
 *   그래서 앱바 폴백 구분에 exact 를 쓰고(getByText('후보 고르기')가 '전시 후보 고르기'를 안 잡음),
 *   태그 원문(첫태그만 #·중점 U+00B7)은 앵커 regex 로 잠근다.
 */
describe('🔴 SlotFillScreen (h10) — 동적 제목·헤드라인 제거', () => {
  it('T-TITLE-1 · concept 주면 앱바가 "{concept} 후보 고르기"(정적 아님)', () => {
    renderScreen({ concept: '전시' });

    // 단언: 동적 제목이 뜨고, 정적 '후보 고르기'(exact)는 없다.
    expect(screen.getByText('전시 후보 고르기')).toBeTruthy();
    expect(screen.queryByText('후보 고르기')).toBeNull();
  });

  it('T-TITLE-2 · concept 없으면 정적 폴백 "후보 고르기"(D2, 선제 green)', () => {
    renderScreen({ concept: undefined });

    expect(screen.getByText('후보 고르기')).toBeTruthy();
  });

  it('T-HEADLINE · 옛 헤드라인 문구가 사라진다(D11)', () => {
    renderScreen();

    // 옛 TITLE 은 제거 대상 — 렌더 트리에 없어야 한다.
    expect(screen.queryByText('근처에서 어디로 갈까요?')).toBeNull();
  });
});

describe('🔴 SlotFillScreen (h10) — 진행줄·스텝퍼 슬롯(재사용)', () => {
  const PROGRESS = {
    dayLabel: '1일차 / 4 · 6월 10일(수)',
    slotCurrent: 2,
    slotTotal: 4,
    barFilled: 1,
    barTotal: 4,
  };

  it('T-PROG-1 · progress 주면 신규 namespace 진행줄(-slotfill-progress*)을 그린다', () => {
    renderScreen({ progress: PROGRESS });

    // 단언: slotfill 접두 진행줄이 뜨고 슬롯 카운트가 보인다.
    expect(
      screen.getByTestId('itinerary-copick-slotfill-progress')
    ).toBeTruthy();
    expect(
      screen.getByTestId('itinerary-copick-slotfill-progress-count')
    ).toHaveTextContent('2 / 4');

    // ★ 신규 namespace 다 — h09 의 `-concept-progress*` 를 공유·오염하지 않는다(D3).
    expect(
      screen.queryByTestId('itinerary-copick-concept-progress')
    ).toBeNull();
  });

  it('T-PROG-2 · progress 미주입이면 진행줄 미렌더(선제 green — 동결 무회귀)', () => {
    renderScreen({ progress: undefined });

    expect(
      screen.queryByTestId('itinerary-copick-slotfill-progress')
    ).toBeNull();
  });

  it('T-STEP · stepperSlot 노드를 그대로 렌더(미주입이면 미렌더)', () => {
    // 화면은 위젯을 import 하지 않는다(features→widgets 금지) — 완성된 노드만 받는다. 스텁으로 검증.
    renderScreen({ stepperSlot: <Text testID="stub-stepper">stepper</Text> });
    expect(screen.getByTestId('stub-stepper')).toBeTruthy();

    screen.unmount();
    renderScreen({ stepperSlot: undefined });
    expect(screen.queryByTestId('stub-stepper')).toBeNull();
  });
});

describe('🔴 SlotFillScreen (h10) — 후보 카드 픽스처 + 반경 밖 톤다운', () => {
  const CARDS: SlotCandidatesCandidatesItem[] = [
    { poiId: 'A1', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'D4', distanceRange: '약 9.9km', rationale: '반경 밖' },
  ];
  const VIEWS = {
    A1: { nameKo: '부산시립미술관', tags: ['미술', '실내', '취향매칭'] },
    D4: { nameKo: '감천문화마을', tags: ['전시', '포토'], dimmed: true },
  };

  it('T-CARD · 이름·태그 픽스처가 카드에 뜨고, 반경 밖(D4)만 톤다운(글자 muted)이다', () => {
    renderScreen({ candidates: CARDS, candidateViews: VIEWS });

    // 이름 픽스처 — placeholder 가 아니라 실이름(래퍼가 nameKo 를 관통).
    expect(screen.getByTestId('itinerary-candidate-name-A1')).toHaveTextContent(
      '부산시립미술관'
    );
    // 태그줄 — 첫 태그만 `#`, 나머지는 ` · `(U+00B7). exact 앵커 regex(02a §5 실측).
    expect(screen.getByTestId('itinerary-candidate-tags-A1')).toHaveTextContent(
      /^#미술 · 실내 · 취향매칭$/
    );

    // 톤다운 관통(★5) — A1(비톤다운)은 잉크, D4(톤다운)는 muted 로 갈린다.
    expect(
      screen.getByTestId('itinerary-candidate-name-A1').props.className
    ).toContain('text-ink');
    const dimmed = screen.getByTestId('itinerary-candidate-name-D4');
    expect(dimmed.props.className).not.toContain('text-ink');
    expect(dimmed.props.className).toContain('text-muted');
  });
});

describe('🔴 SlotFillScreen (h10) — 반경 넓히기/좁히기 상시(결과 얼굴)', () => {
  it('T-RADIUS-EXPAND · canExpandRadius 면 "반경 넓히기" 상시 + press → onExpandRadius(onShrink 0)', () => {
    const { onExpandRadius, onShrinkRadius } = renderScreen({
      canExpandRadius: true,
    });

    const btn = screen.getByTestId('itinerary-copick-slotfill-radius');
    expect(btn).toHaveTextContent('반경 넓히기');
    fireEvent.press(btn);
    expect(onExpandRadius).toHaveBeenCalledTimes(1);
    expect(onShrinkRadius).toHaveBeenCalledTimes(0);
  });

  it('T-RADIUS-SHRINK · 마지막 단계(canExpandRadius=false)면 "반경 좁히기" + press → onShrinkRadius(onExpand 0)', () => {
    // 결과 얼굴(candidates 비어있지 않음)에서 마지막 단계 — 0건 얼굴과 다른 자리다.
    const { onExpandRadius, onShrinkRadius } = renderScreen({
      canExpandRadius: false,
    });

    const btn = screen.getByTestId('itinerary-copick-slotfill-radius');
    expect(btn).toHaveTextContent('반경 좁히기');
    fireEvent.press(btn);
    expect(onShrinkRadius).toHaveBeenCalledTimes(1);
    expect(onExpandRadius).toHaveBeenCalledTimes(0);
  });
});

/**
 * TRIP-978 — 셋째 반경 칸은 `maxRadiusLabel` 만 덮는다. 옛 T-SEG3 는 "radiusUsedLabel 이 있으면
 * 선택과 무관하게 셋째 칸"을 굳혀 가운데 "1.1km" 옆에 "약 1.1km" 가 뜨는 버그의 계약이었다(교체).
 * 캡션(radiusUsedLabel)과 셋째 칸(maxRadiusLabel)을 무엇으로 채울지는 페이지가 정한다.
 */
describe('🔴 SlotFillScreen (h10) — 셋째 반경 세그 라벨(maxRadiusLabel ?? 최대)', () => {
  it('T-SEG3 · maxRadiusLabel 만 셋째 칸을 덮고, 캡션값(radiusUsedLabel)만 오면 셋째 칸은 "최대"', () => {
    // 최대로 조회한 결과 — 셋째 칸이 서버값(Figma 3850:2227 '약 11.3km').
    renderScreen({
      selectedRadiusKey: 'max',
      maxRadiusLabel: '약 11.3km',
      radiusUsedLabel: null,
    });
    expect(
      screen.getByTestId('itinerary-copick-radius-seg-max')
    ).toHaveTextContent('약 11.3km');

    // 캡션값만 있음 — 캡션에만 뜨고 셋째 칸은 '최대' 그대로(가운데 '1.1km' 와 중복 금지).
    screen.unmount();
    renderScreen({ maxRadiusLabel: null, radiusUsedLabel: '약 1.1km' });
    expect(
      screen.getByTestId('itinerary-copick-radius-seg-max')
    ).toHaveTextContent('최대');
    expect(
      screen.getByTestId('itinerary-copick-radius-used')
    ).toHaveTextContent('약 1.1km');

    // 둘 다 없음(조회 전) — 정적 '최대'(INV-2 지어내지 않음).
    screen.unmount();
    renderScreen({ maxRadiusLabel: null, radiusUsedLabel: null });
    expect(
      screen.getByTestId('itinerary-copick-radius-seg-max')
    ).toHaveTextContent('최대');
  });
});

/**
 * TRIP-978 — 생성 중(PARTIAL) 잠금 표시 · 후보 조회 실패 얼굴.
 *
 * 무엇을 보장하나:
 *  - AC-3: `confirmLocked` 면 골랐어도 확정 버튼이 비활성이고 이유 문구가 곁에 뜬다(INV-4 — 활성으로
 *    보이는데 눌러도 무반응 금지).
 *  - AC-7: `candidatesErrorMessage` 가 오면 0건 얼굴 대신 그 문구를 보인다(실패를 "못 찾았어요"로 속이지 않음).
 *  - AC-11: 두 표면 어디에도 소요시간 문자열이 없다(INV-3).
 */
const LOCKED_TEXT = '나머지 일정을 만드는 중이에요';
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

describe('🔴 SlotFillScreen (h10) — 생성 중 잠금 · 후보 조회 실패 (TRIP-978)', () => {
  it('T-LOCK-1 · confirmLocked 면 골랐어도 확정 버튼이 비활성이고 잠금 사유 문구가 보인다', () => {
    const { onConfirm } = renderScreen({
      selectedPoiId: 'A1',
      confirmLocked: true,
    });

    const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
    fireEvent.press(confirm);

    expect(confirm.props.accessibilityState?.disabled).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(0);
    expect(
      screen.getByTestId('itinerary-copick-confirm-locked')
    ).toHaveTextContent(LOCKED_TEXT);
  });

  it('T-LOCK-2 · 잠금이 아니면 잠금 문구가 없고 확정 버튼은 살아 있다(부정 짝)', () => {
    renderScreen({ selectedPoiId: 'A1', confirmLocked: false });

    const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
    expect(confirm.props.accessibilityState?.disabled).not.toBe(true);
    expect(screen.queryByTestId('itinerary-copick-confirm-locked')).toBeNull();
  });

  it('T-CERR-1 · 후보 조회 실패 문구가 오면 0건 얼굴 대신 그 사유를 보인다', () => {
    renderScreen({ candidates: [], candidatesErrorMessage: LOCKED_TEXT });

    expect(
      screen.getByTestId('itinerary-copick-candidates-error')
    ).toHaveTextContent(LOCKED_TEXT);
    expect(screen.queryByTestId('itinerary-copick-zero')).toBeNull();

    // 실패가 아니면(진짜 0건) 오류 얼굴은 없고 0건 얼굴이 그대로 뜬다.
    screen.unmount();
    renderScreen({ candidates: [], candidatesErrorMessage: null });
    expect(
      screen.queryByTestId('itinerary-copick-candidates-error')
    ).toBeNull();
    expect(screen.getByTestId('itinerary-copick-zero')).toBeTruthy();
  });

  it('T-INV3 · 잠금 문구·후보 오류 얼굴 어디에도 소요시간 문자열이 없다', () => {
    // 표면이 실제로 떠 있어야 "없다"가 의미를 갖는다(긍정 짝 먼저).
    renderScreen({ selectedPoiId: 'A1', confirmLocked: true });
    expect(screen.getByTestId('itinerary-copick-confirm-locked')).toBeTruthy();
    expect(screen.queryAllByText(DURATION_TEXT)).toEqual([]);

    screen.unmount();
    renderScreen({ candidates: [], candidatesErrorMessage: LOCKED_TEXT });
    expect(
      screen.getByTestId('itinerary-copick-candidates-error')
    ).toBeTruthy();
    expect(screen.queryAllByText(DURATION_TEXT)).toEqual([]);
  });
});

describe('🔴 SlotFillScreen (h10) — 지도 카드 additive(prop 전달·degrade)', () => {
  const MAP_VIEW = {
    center: { lat: 35.1587, lng: 129.1604 },
    radiusCircle: { center: { lat: 35.1587, lng: 129.1604 }, radiusM: 1100 },
    pins: [{ number: 1, lat: 35.16, lng: 129.16, label: 'A' }],
  };

  it('T-MAP · mapView 주면 지도 카드(map-root)를 viewOnly+connectPins=false 로 소비한다', () => {
    renderScreen({ mapView: MAP_VIEW });

    // 목이 props 를 host 로 노출한다 — 보여주기 전용(viewOnly) + 검증된 동선 아님(connectPins=false).
    const map = screen.getByTestId('map-root');
    expect(map.props.viewOnly).toBe(true);
    expect(map.props.connectPins).toBe(false);
    // 반경 원 prop 이 지도까지 흘러간다(전달 잠금 — 실 원은 6-b).
    expect(map.props.radiusCircle).toBeDefined();
  });

  it('T-MAP-DEGRADE · mapView 미주입이면 지도 카드가 없다(좌표 도착 전 정직 degrade)', () => {
    renderScreen({ mapView: undefined });

    expect(screen.queryByTestId('map-root')).toBeNull();
  });
});
