import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { SlotCandidateSheet } from './SlotCandidateSheet';

/**
 * h12 완전 AI [다른 후보 N] 시트 — 순수 화면(props+콜백만).
 *
 * 무엇을 보장하나:
 *  - 미확보 표기 카드: 이름 자리는 중립 플레이스홀더, poiId 원문은 안 보이고, rationale·
 *    distanceRange 는 실데이터로 뜬다(AC6).
 *  - 화면에 뜬 후보 카드 집합 = 응답 candidates poiId 집합(개수 아니라 목록으로 재기, INV-1).
 *  - 후보 카드에 소요시간 문자열 0(INV-3, 거리만).
 *  - 현 슬롯 행은 "현재" 이고 탭 불가, 후보 행은 "선택" 버튼으로 그 poiId 를 올린다(AC2).
 *  - 왕복 중(isPending)엔 선택 버튼이 접근성 disabled 이고 재탭해도 콜백이 안 나간다(AC4).
 *  - 후보 0건이면 인라인 안내만, 반경/컨셉 CTA 는 없다(AC5).
 *  - PUT 실패 문구(errorMessage)는 인라인으로 뜨고 시트는 안 닫힌다(AC7 렌더).
 *
 * 열림/딤은 이 시트가 아니라 배선이 조건부 마운트로 소유한다(gorhom 목이 개폐를 안 봄, 02a ★1).
 *
 * 3동작 뼈대: 준비=props → 실행=렌더/press → 단언=보이는 것·콜백.
 */

const CURRENT_POI = 'cur';

/** 후보 3개 — distanceRange·rationale 에 소요시간 문자열이 없다(거리·근거 산문만). */
const CANDIDATES: SlotCandidatesCandidatesItem[] = [
  { poiId: 'A', distanceRange: '560m', rationale: '실내 전시라 이동이 짧아요' },
  { poiId: 'B', distanceRange: '1.1km', rationale: '가까운 카페' },
  { poiId: 'C', distanceRange: '820m', rationale: '조용한 산책로' },
];

/** 후보 카드 **루트**만 잡는 셀렉터(하위·특수 testID 는 부정 룩어헤드로 제외). */
const CANDIDATE_ROOT =
  /^itinerary-candidate-(?!sheet|current|empty|error|name-|image-|distance-|rationale-|select-|radio-)/;

const renderedCandidatePoiIds = () =>
  screen
    .getAllByTestId(CANDIDATE_ROOT)
    .map((node) =>
      String(node.props.testID).replace('itinerary-candidate-', '')
    );

function renderSheet(
  overrides: Partial<Parameters<typeof SlotCandidateSheet>[0]> = {}
) {
  return render(
    <SlotCandidateSheet
      candidates={CANDIDATES}
      currentPoiId={CURRENT_POI}
      isPending={false}
      onSelectCandidate={jest.fn()}
      onClose={jest.fn()}
      {...overrides}
    />
  );
}

describe('🔴 SlotCandidateSheet (h12)', () => {
  it('C1 · AC6 — 이름 자리는 플레이스홀더, poiId 원문 비노출, rationale·distanceRange 는 실데이터', () => {
    renderSheet();

    for (const cand of CANDIDATES) {
      // 이름 자리 = 중립 플레이스홀더(leaf 완전일치).
      expect(
        screen.getByTestId(`itinerary-candidate-name-${cand.poiId}`)
      ).toHaveTextContent('이름 준비 중');
      // 사진 자리 회색 박스 존재.
      expect(
        screen.getByTestId(`itinerary-candidate-image-${cand.poiId}`)
      ).toBeOnTheScreen();
      // poiId 원문이 보이는 텍스트로는 안 나온다(testID 에 있는 건 무방).
      const card = within(
        screen.getByTestId(`itinerary-candidate-${cand.poiId}`)
      );
      expect(card.queryByText(cand.poiId)).toBeNull();
      // 실데이터는 leaf 완전일치로 그대로.
      expect(
        screen.getByTestId(`itinerary-candidate-distance-${cand.poiId}`)
      ).toHaveTextContent(cand.distanceRange);
      expect(
        screen.getByTestId(`itinerary-candidate-rationale-${cand.poiId}`)
      ).toHaveTextContent(cand.rationale);
    }
  });

  it('C2 · AC6·INV-1 — 렌더 카드 집합 = 응답 poiId 집합 (개수 아니라 목록)', () => {
    renderSheet();

    expect(renderedCandidatePoiIds().sort()).toEqual(['A', 'B', 'C'].sort());
    // 응답에 없는 카드는 섞이지 않는다(초과 0).
    expect(screen.queryByTestId('itinerary-candidate-Z')).toBeNull();
  });

  it('C3 · INV-3 — 후보 카드에 소요시간 문자열 0 (거리만)', () => {
    renderSheet();

    for (const cand of CANDIDATES) {
      const card = within(
        screen.getByTestId(`itinerary-candidate-${cand.poiId}`)
      );
      // 숫자+분/시간 패턴만 잡는다 — 산문 속 '시간' 은 오탐하지 않는다(02a §5 조합검증).
      expect(card.queryByText(/\d+\s*(분|시간)/)).toBeNull();
    }
  });

  it('C4 · AC2 — 현 슬롯 행은 "현재" 이고 선택 컨트롤이 없다(탭 불가)', () => {
    renderSheet();

    expect(screen.getByTestId('itinerary-candidate-current')).toHaveTextContent(
      /현재/
    );
    // 현 슬롯엔 "선택" 버튼이 없다.
    expect(
      screen.queryByTestId(`itinerary-candidate-select-${CURRENT_POI}`)
    ).toBeNull();
    // 현 슬롯 행은 후보 집합에 안 섞인다(BR-U3-24 — 서버가 현 slot 을 후보에서 제외).
    expect(renderedCandidatePoiIds()).not.toContain(CURRENT_POI);
  });

  it('C5 · AC2 — 후보 "선택" 탭이 그 poiId 로 onSelectCandidate 를 1회 부른다', () => {
    const onSelectCandidate = jest.fn();
    renderSheet({ onSelectCandidate });

    fireEvent.press(screen.getByTestId('itinerary-candidate-select-B'));

    expect(onSelectCandidate).toHaveBeenCalledTimes(1);
    expect(onSelectCandidate).toHaveBeenCalledWith('B');
  });

  it('C6 · AC4 — 왕복 중(isPending)엔 선택 버튼이 disabled 이고 재탭해도 콜백이 안 나간다', () => {
    const onSelectCandidate = jest.fn();
    renderSheet({ onSelectCandidate, isPending: true });

    const button = screen.getByTestId('itinerary-candidate-select-B');
    fireEvent.press(button);
    fireEvent.press(button);

    // 잠금은 색·fill 이 아니라 접근성 상태로 관찰가능해야 한다(02a ★2).
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(onSelectCandidate).toHaveBeenCalledTimes(0);
    // 펜딩이 가시화된다.
    expect(screen.queryByText(/바꾸는 중|교체 중/)).not.toBeNull();
  });

  it('C7 · AC5 — 후보 0건: 인라인 안내만, 반경/컨셉 CTA 는 없다', () => {
    renderSheet({ candidates: [] });

    expect(screen.getByTestId('itinerary-candidate-empty')).toHaveTextContent(
      /근처에서 바꿀 만한 후보를 찾지 못했어요/
    );
    expect(screen.queryAllByTestId(CANDIDATE_ROOT)).toEqual([]);
    // 슬라이스2 전용 CTA 가 없다(부정 단언).
    expect(screen.queryByText(/반경 넓히기|반경 확대|컨셉/)).toBeNull();
    expect(
      screen.queryByTestId('itinerary-candidate-radius-expand')
    ).toBeNull();
  });

  it('C8 · AC7 — errorMessage 는 인라인 오류로 뜨고 시트는 닫히지 않는다', () => {
    const onClose = jest.fn();
    renderSheet({
      errorMessage: '확정된 일정이라 지금은 바꿀 수 없어요',
      onClose,
    });

    expect(screen.getByTestId('itinerary-candidate-error')).toHaveTextContent(
      /확정된 일정/
    );
    // 오류에도 시트는 그대로(성공만 닫는다).
    expect(screen.getByTestId('itinerary-candidate-sheet')).toBeOnTheScreen();
    expect(onClose).toHaveBeenCalledTimes(0);
  });
});
