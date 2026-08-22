import fs from 'fs';
import path from 'path';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { SlotCandidatePanel } from './SlotCandidatePanel';

/**
 * h12 완전 AI "다른 후보로 바꾸기" — **인라인 교체 패널**(순수, props+콜백만, TRIP-483).
 *
 * TRIP-335 의 순수 시트(`SlotCandidateSheet`)를 바텀시트에서 **일반 View 인라인 패널**로 이관한
 * 것이다(01b ✅1). 로직(선택·펜딩·오류·현재 행)은 그대로, 프레젠테이션만 바뀐다.
 *
 * 무엇을 보장하나:
 *  - 미확보 카드: 이름 자리 플레이스홀더·poiId 원문 비노출·rationale·distance 실데이터(AC6·INV-1).
 *  - 렌더 후보 집합 = 응답 poiId 집합, 소요시간 문자열 0(INV-3, 거리만).
 *  - 현 슬롯 행은 "현재"·탭 불가(집합 제외, BR-U3-24) + **헤더 = `{시간대} — 다른 후보로 바꾸기`**(신규).
 *  - 「선택」 press → 그 poiId · 펜딩 중 접근성 disabled + 재탭 무발화(AC3).
 *  - 0건 인라인 안내만 · PUT 실패 인라인 오류(패널은 안 닫힘, AC3).
 *  - 🔴 **degraded===true 면 강등 고지, false/미도착이면 미표시**(AC6 · ★E, 상단 fallbackNotice 와 별개).
 *  - 🔴 **바텀시트가 아니다** — 소스에 `@gorhom/bottom-sheet` import 0.
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

/** 후보 카드 **루트**만 잡는 셀렉터(하위·특수 testID 는 부정 룩어헤드로 제외 — 개명분 panel·degraded 반영). */
const CANDIDATE_ROOT =
  /^itinerary-candidate-(?!panel|current|empty|error|degraded|name-|image-|distance-|rationale-|select-|radio-)/;

const renderedCandidatePoiIds = () =>
  screen
    .getAllByTestId(CANDIDATE_ROOT)
    .map((node) =>
      String(node.props.testID).replace('itinerary-candidate-', '')
    );

function renderPanel(
  overrides: Partial<Parameters<typeof SlotCandidatePanel>[0]> = {}
) {
  return render(
    <SlotCandidatePanel
      candidates={CANDIDATES}
      currentPoiId={CURRENT_POI}
      isPending={false}
      onSelectCandidate={jest.fn()}
      onClose={jest.fn()}
      {...overrides}
    />
  );
}

describe('🔴 SlotCandidatePanel (h12 인라인)', () => {
  it('P1 · AC6 — 이름 자리는 플레이스홀더, poiId 원문 비노출, rationale·distanceRange 는 실데이터', () => {
    renderPanel();

    for (const cand of CANDIDATES) {
      expect(
        screen.getByTestId(`itinerary-candidate-name-${cand.poiId}`)
      ).toHaveTextContent('이름 준비 중');
      expect(
        screen.getByTestId(`itinerary-candidate-image-${cand.poiId}`)
      ).toBeOnTheScreen();
      const card = within(
        screen.getByTestId(`itinerary-candidate-${cand.poiId}`)
      );
      expect(card.queryByText(cand.poiId)).toBeNull();
      expect(
        screen.getByTestId(`itinerary-candidate-distance-${cand.poiId}`)
      ).toHaveTextContent(cand.distanceRange);
      expect(
        screen.getByTestId(`itinerary-candidate-rationale-${cand.poiId}`)
      ).toHaveTextContent(cand.rationale);
    }
  });

  it('P2 · AC6·INV-1 — 렌더 카드 집합 = 응답 poiId 집합 (개수 아니라 목록)', () => {
    renderPanel();

    expect(renderedCandidatePoiIds().sort()).toEqual(['A', 'B', 'C'].sort());
    expect(screen.queryByTestId('itinerary-candidate-Z')).toBeNull();
  });

  it('P3 · INV-3 — 후보 카드에 소요시간 문자열 0 (거리만)', () => {
    renderPanel();

    for (const cand of CANDIDATES) {
      const card = within(
        screen.getByTestId(`itinerary-candidate-${cand.poiId}`)
      );
      expect(card.queryByText(/\d+\s*(분|시간)/)).toBeNull();
    }
  });

  it('P4 · AC2 — 현 슬롯 행은 "현재" 이고 선택 컨트롤이 없다(탭 불가)', () => {
    renderPanel();

    expect(screen.getByTestId('itinerary-candidate-current')).toHaveTextContent(
      /현재/
    );
    expect(
      screen.queryByTestId(`itinerary-candidate-select-${CURRENT_POI}`)
    ).toBeNull();
    expect(renderedCandidatePoiIds()).not.toContain(CURRENT_POI);
  });

  it('P5 · AC2 — 헤더는 `{시간대} — 다른 후보로 바꾸기`, 시간대 미확보면 제목만', () => {
    renderPanel({ timeBand: '오후' });

    // leaf 가 조립문 전체라 문자열 완전일치(RNTL 기본 exact, 02a §1-B). em-dash `—`.
    expect(
      screen.getByTestId('itinerary-candidate-panel-title')
    ).toHaveTextContent('오후 — 다른 후보로 바꾸기');
  });

  it('P5b · AC2 — timeBand 미지정이면 헤더가 제목만(폴백)', () => {
    renderPanel({ timeBand: undefined });

    expect(
      screen.getByTestId('itinerary-candidate-panel-title')
    ).toHaveTextContent('다른 후보로 바꾸기');
  });

  it('P6 · AC3 — 후보 "선택" 탭이 그 poiId 로 onSelectCandidate 를 1회 부른다', () => {
    const onSelectCandidate = jest.fn();
    renderPanel({ onSelectCandidate });

    fireEvent.press(screen.getByTestId('itinerary-candidate-select-B'));

    expect(onSelectCandidate).toHaveBeenCalledTimes(1);
    expect(onSelectCandidate).toHaveBeenCalledWith('B');
  });

  it('P7 · AC3 — 왕복 중(isPending)엔 선택 버튼이 disabled 이고 재탭해도 콜백이 안 나간다', () => {
    const onSelectCandidate = jest.fn();
    renderPanel({ onSelectCandidate, isPending: true });

    const button = screen.getByTestId('itinerary-candidate-select-B');
    fireEvent.press(button);
    fireEvent.press(button);

    // 잠금은 색·fill 이 아니라 접근성 상태로 관찰가능해야 한다.
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(onSelectCandidate).toHaveBeenCalledTimes(0);
    expect(screen.queryByText(/바꾸는 중|교체 중/)).not.toBeNull();
  });

  it('P8 · AC1 — 후보 0건: 인라인 안내만, 반경/컨셉 CTA 는 없다', () => {
    renderPanel({ candidates: [] });

    expect(screen.getByTestId('itinerary-candidate-empty')).toHaveTextContent(
      /근처에서 바꿀 만한 후보를 찾지 못했어요/
    );
    expect(screen.queryAllByTestId(CANDIDATE_ROOT)).toEqual([]);
    expect(screen.queryByText(/반경 넓히기|반경 확대|컨셉/)).toBeNull();
    expect(
      screen.queryByTestId('itinerary-candidate-radius-expand')
    ).toBeNull();
  });

  it('P9 · AC3 — errorMessage 는 인라인 오류로 뜨고 패널은 닫히지 않는다', () => {
    const onClose = jest.fn();
    renderPanel({
      errorMessage: '확정된 일정이라 지금은 바꿀 수 없어요',
      onClose,
    });

    expect(screen.getByTestId('itinerary-candidate-error')).toHaveTextContent(
      /확정된 일정/
    );
    // 오류에도 패널은 그대로(성공만 닫는다).
    expect(screen.getByTestId('itinerary-candidate-panel')).toBeOnTheScreen();
    expect(onClose).toHaveBeenCalledTimes(0);
  });

  it('P10 · AC6·★E — degraded===true 면 강등 고지, false/미도착이면 미표시', () => {
    renderPanel({ degraded: true });
    expect(
      screen.getByTestId('itinerary-candidate-degraded')
    ).toHaveTextContent(/AI 추천 준비 중/);

    // 상단 폴백 배너(itinerary-draft-fallback-banner)와 다른 표면·다른 신호다(★E) —
    // 이 패널은 그 배너를 그리지 않는다.
    expect(screen.queryByTestId('itinerary-draft-fallback-banner')).toBeNull();

    screen.rerender(
      <SlotCandidatePanel
        candidates={CANDIDATES}
        currentPoiId={CURRENT_POI}
        isPending={false}
        degraded={false}
        onSelectCandidate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByTestId('itinerary-candidate-degraded')).toBeNull();
  });

  it('P11 · AC1 — 바텀시트가 아니다(소스에 @gorhom/bottom-sheet import 0)', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/itinerary/ui/SlotCandidatePanel.tsx'),
      'utf8'
    );
    // 부정 — 인라인 패널은 바텀시트를 안 문다.
    expect(source).not.toContain('@gorhom/bottom-sheet');
    // 긍정 짝 — 파일을 실제로 읽었고 패널 루트를 그린다(공허 통과 방지).
    expect(source).toContain('itinerary-candidate-panel');
  });
});
