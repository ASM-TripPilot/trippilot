import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { SlotCandidateSheet } from './SlotCandidateSheet';

/**
 * TRIP-440 · AC-5·6·6b — i14 슬롯 후보 시트(순수 인라인 패널, 배지 없음).
 *
 * 무엇을 보장하나:
 *  - 🔴 후보 4정보 = rationale · distanceRange · slackLabel(여유) 가 각 leaf 로 뜨고, poiId 는 안 샌다(AC-5·INV-1).
 *  - 🔴 소요시간(거리 외 시간 단위)이 distance·rationale 에 없다(INV-3, 거리만) — slack 은 두 고정 시각 차라 예외.
 *  - 🔴 렌더 카드 집합 = 응답 poiId 집합(개수 아니라 목록).
 *  - 🔴 배지("지금 제안"/"이걸로")는 **안 그린다**(D5·AC-10 막힘 — 채택 여부는 draft 계약 확장 후).
 *  - 🔴 degraded===true 면 강등 고지, false/미도착이면 미표시(AC-6·INV-4).
 *  - 🔴 candidates=[] 면 반경 확대·컨셉 변경 제안, 후보 카드 0(AC-6b·BR-U3-25).
 *  - 🔴 바텀시트가 아니다(소스에 @gorhom/bottom-sheet 0) — 통과형 목의 개폐 사각을 인라인으로 닫는다.
 *
 * ★ 여유 숫자 두 얼굴: slackLabel 은 slackTime.ts(model)가 만든 문자열을 **주입**받아 `{slackLabel}` 변수로만
 *   렌더한다 — ui 소스엔 N시간/N분 리터럴 0(executionDurationStructure=AC-8 green). 아래 "여유 1시간 20분"
 *   문자열은 **테스트 파일**에 있고 ui 소스엔 없다(가드는 ui 소스만 스캔, .test. 제외).
 * ★ slackLabel 은 시트 공통 1개(후보별 아님) — "다음 고정까지 여유"는 교체 슬롯 기준이라 후보 무관(BR-U4-24).
 * ★ RNTL 13.3.3 STRING 매처=완전일치(node_modules 실측): leaf 값은 자기 testID 로 떼 toHaveTextContent(값)
 *   EXACT 로, 안내 다중텍스트·감싼 라벨은 /…/ REGEX 부분포함으로 잰다.
 *
 * 3동작: 준비=props → 실행=렌더 → 단언=보이는 leaf·부재.
 */

/** 후보 3개 — distanceRange 는 거리만, rationale 은 시각·소요 없는 산문(BR-U2-09). */
const CANDIDATES: SlotCandidatesCandidatesItem[] = [
  {
    poiId: 'p1',
    distanceRange: '차량 6.4km',
    rationale: '비 예보에도 실내라 그대로 갈 수 있어요',
  },
  { poiId: 'p2', distanceRange: '도보 1.3km', rationale: '가까운 실내 전시' },
  { poiId: 'p3', distanceRange: '차량 3.1km', rationale: '조용한 카페' },
];

/** slackTime.ts(model) 산출 형태 — 두 확정 시각의 차. ui 소스가 아니라 여기(테스트)에만 산다. */
const SLACK = '여유 1시간 20분';

/** 후보 카드 **루트**만 잡는 셀렉터(하위·특수 testID 는 부정 룩어헤드로 제외). */
const CANDIDATE_ROOT =
  /^planb-candidate-(?!slack-|distance-|rationale-|empty|degraded)/;

const renderedCandidatePoiIds = () =>
  screen
    .getAllByTestId(CANDIDATE_ROOT)
    .map((node) => String(node.props.testID).replace('planb-candidate-', ''));

function renderSheet(
  overrides: Partial<Parameters<typeof SlotCandidateSheet>[0]> = {}
) {
  return render(
    <SlotCandidateSheet
      candidates={CANDIDATES}
      slackLabel={SLACK}
      degraded={false}
      {...overrides}
    />
  );
}

describe('🔴 SlotCandidateSheet — 후보 카드(AC-5)', () => {
  it('C1 · AC-5 — rationale·distance·slack 이 leaf 로 뜨고, 소요시간·poiId·배지는 없다', () => {
    renderSheet();

    for (const cand of CANDIDATES) {
      // 각 leaf 는 값 하나(STRING EXACT).
      expect(
        screen.getByTestId(`planb-candidate-rationale-${cand.poiId}`)
      ).toHaveTextContent(cand.rationale);
      expect(
        screen.getByTestId(`planb-candidate-distance-${cand.poiId}`)
      ).toHaveTextContent(cand.distanceRange);
      expect(
        screen.getByTestId(`planb-candidate-slack-${cand.poiId}`)
      ).toHaveTextContent(SLACK);

      // INV-3 — distance·rationale leaf 엔 시간 단위 0(slack leaf 는 두 고정 시각 차라 예외).
      expect(
        screen.getByTestId(`planb-candidate-distance-${cand.poiId}`)
      ).not.toHaveTextContent(/분|시간|소요/);
      expect(
        screen.getByTestId(`planb-candidate-rationale-${cand.poiId}`)
      ).not.toHaveTextContent(/분|시간|소요/);

      // INV-1 — poiId 원문 비노출(REGEX 로 부분포함까지 차단).
      const card = within(screen.getByTestId(`planb-candidate-${cand.poiId}`));
      expect(card.queryByText(new RegExp(cand.poiId))).toBeNull();
    }

    // 막힘(AC-10) — 채택 여부 배지는 이번에 안 그린다.
    expect(screen.queryByText(/지금 제안|이걸로/)).toBeNull();
  });

  it('C2 · AC-5 — 렌더 카드 집합 = 응답 poiId 집합(개수 아니라 목록)', () => {
    renderSheet();

    expect(renderedCandidatePoiIds().sort()).toEqual(['p1', 'p2', 'p3'].sort());
    expect(screen.queryByTestId('planb-candidate-zzz')).toBeNull();
  });
});

describe('🔴 SlotCandidateSheet — degraded 고지(AC-6)', () => {
  it('C3 · AC-6 — degraded===true 면 강등 고지, false 면 미표시(INV-4)', () => {
    renderSheet({ degraded: true });
    expect(screen.getByTestId('planb-candidate-degraded')).toHaveTextContent(
      /AI 추천 준비 중/
    );

    screen.rerender(
      <SlotCandidateSheet
        candidates={CANDIDATES}
        slackLabel={SLACK}
        degraded={false}
      />
    );
    expect(screen.queryByTestId('planb-candidate-degraded')).toBeNull();
  });
});

describe('🔴 SlotCandidateSheet — 빈 목록·인라인(AC-6b)', () => {
  it('C4 · AC-6b — candidates=[] 면 반경 확대·컨셉 변경 제안, 후보 카드 0', () => {
    renderSheet({ candidates: [] });

    expect(screen.getByTestId('planb-candidate-empty')).toHaveTextContent(
      /반경|컨셉/
    );
    expect(screen.queryAllByTestId(CANDIDATE_ROOT)).toEqual([]);
    expect(screen.queryByTestId('planb-candidate-degraded')).toBeNull();
  });

  it('C5 · AC-6b(★인라인) — 바텀시트가 아니다(소스에 @gorhom/bottom-sheet 0)', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/planb/ui/SlotCandidateSheet.tsx'),
      'utf8'
    );
    // 부정 — 통과형 바텀시트 목의 개폐 사각을 안 탄다(인라인 트리 존재/부재로 관찰).
    expect(source).not.toContain('@gorhom/bottom-sheet');
    // 긍정 짝 — 파일을 실제로 읽었고 후보 표면을 그린다(공허 통과 방지).
    expect(source).toContain('planb-candidate');
  });
});
