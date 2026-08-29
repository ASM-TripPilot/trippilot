import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ReplanSlotVM } from './ReplanSlotRow';
import { ReplanDraftScreen } from './ReplanDraftScreen';

/**
 * TRIP-563 · AC-2·AC-3(컴포넌트, i13) — 재계획안 화면(순수 props+콜백).
 *
 * 무엇을 보장하나:
 *  - 🔴 채운 VM 주입 시 헤더 근거·슬롯 N행·두 CTA·지도가 뜨고, **단일 안 하나**만이다(2~3안 UI 없음, AC-2·BR-U4-20).
 *  - 🔴 [직접 수정]/[이대로 적용] 탭이 각 콜백을 1회 위임한다.
 *  - 🔴 슬롯 배열이 **빈 배열**이면 헤더 근거+이월 안내만으로 정직하게 degrade(빈 화면·결함 아님, AC-3).
 *
 * ★ 실 ReplanSlotRow 는 목 안 함(같은 feature, 지도 없음) — 슬롯 행 존재까지 실물로 태운다. 행 내부
 *   배지/후보 로직은 ReplanSlotRow.test 가 따로 잼(컨테이너/부품 분리).
 * ★ 지도는 `@/shared/map` 스텁 — map 영역 존재만(실 지도는 6-b). 슬롯 루트 셀렉터는 meta leaf 를
 *   부정 룩어헤드로 제외(SlotCandidateSheet.test 선례 동형).
 * ★ toHaveTextContent: 헤더·이월은 감싼 컨테이너라 정규식 부분, leaf 는 다른 파일에서 STRING.
 */

jest.mock('@/shared/map', () => ({ KakaoMapView: () => null }));

/** 슬롯 3개 — badgeKind 를 changed/visited/fixed 로 섞어 렌더 다양성을 준다(INV-3: metaText 는 거리·시각범위). */
const SLOTS: ReplanSlotVM[] = [
  {
    slotKey: 's1',
    badgeKind: 'changed',
    placeName: '감천문화마을',
    metaText: '#실내 · 도보 1.3km',
    candidateCount: 4,
    isFixed: false,
  },
  {
    slotKey: 's2',
    badgeKind: 'visited',
    placeName: '자갈치시장',
    metaText: '09:30–10:50 · 사진 2장',
    candidateCount: 0,
    isFixed: false,
  },
  {
    slotKey: 's3',
    badgeKind: 'fixed',
    placeName: '해운대 호텔',
    metaText: '20:00 도착 · 변경 불가',
    candidateCount: 0,
    isFixed: true,
  },
];

/** 슬롯 **루트**만 잡는 셀렉터(meta leaf `planb-draft-slot-meta-*` 는 부정 룩어헤드로 제외). */
const SLOT_ROOT = /^planb-draft-slot-(?!meta-)/;

function filledProps() {
  return {
    reasons: ['비 예보를 반영해 오후 일정을 다시 짰어요'],
    excludedPoiIds: ['x1', 'x2'],
    slots: SLOTS,
    onManualEdit: jest.fn(),
    onApply: jest.fn(),
    onPressCandidates: jest.fn(),
  };
}

describe('🔴 ReplanDraftScreen — i13 채운 재계획안(AC-2)', () => {
  it('D1 · AC-2 — 헤더 근거·슬롯 N행·두 CTA·지도가 뜨고, 단일 안 하나다', () => {
    render(<ReplanDraftScreen {...filledProps()} />);

    // 헤더 근거(서버 reasons 통과) — 감싼 컨테이너라 정규식 부분.
    expect(screen.getByTestId('planb-draft-reason')).toHaveTextContent(
      /비 예보를 반영/
    );

    // 슬롯 3행이 각 slotKey testID 로 뜬다.
    for (const slot of SLOTS) {
      expect(
        screen.getByTestId(`planb-draft-slot-${slot.slotKey}`)
      ).toBeOnTheScreen();
    }
    expect(screen.getAllByTestId(SLOT_ROOT)).toHaveLength(3);

    // 두 CTA + 지도 영역.
    expect(screen.getByTestId('planb-draft-manual')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-draft-apply')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-draft-map')).toBeOnTheScreen();

    // 단일 안 하나(BR-U4-20) — 2~3안 선택 UI 없음 + 적용 버튼 정확히 1개.
    expect(screen.queryByText(/2안|3안|다른 재계획안|안 선택/)).toBeNull();
    expect(screen.getAllByTestId('planb-draft-apply')).toHaveLength(1);
  });

  it('D2 · AC-2 — [직접 수정] 탭은 onManualEdit 만 1회', () => {
    const props = filledProps();
    render(<ReplanDraftScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-draft-manual'));

    expect(props.onManualEdit).toHaveBeenCalledTimes(1);
    expect(props.onApply).toHaveBeenCalledTimes(0);
  });

  it('D2 · AC-2 — [이대로 적용] 탭은 onApply 만 1회', () => {
    const props = filledProps();
    render(<ReplanDraftScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-draft-apply'));

    expect(props.onApply).toHaveBeenCalledTimes(1);
    expect(props.onManualEdit).toHaveBeenCalledTimes(0);
  });
});

describe('🔴 ReplanDraftScreen — 빈 슬롯 degrade(AC-3)', () => {
  it('D3 · AC-3 — 슬롯 [] 이면 헤더·이월만으로 정직하게 degrade(빈 화면 아님)', () => {
    render(<ReplanDraftScreen {...filledProps()} slots={[]} />);

    // 헤더 근거는 여전히 뜬다(화면 루트 살아있음의 긍정 짝).
    expect(screen.getByTestId('planb-draft-reason')).toBeOnTheScreen();

    // 이월 안내가 제외 개수를 알린다(계약 존재 필드 excludedPoiIds → degrade).
    expect(screen.getByTestId('planb-draft-carryover')).toHaveTextContent(/2/);

    // 슬롯 행은 0개(주입 slots 가 비었으므로 — 페이지가 지어내지 않는 것과 짝).
    expect(screen.queryAllByTestId(SLOT_ROOT)).toEqual([]);

    // INV-1 — 이월 안내가 poiId 원문(x1)을 노출하지 않는다(개수만).
    expect(screen.getByTestId('planb-draft-carryover')).not.toHaveTextContent(
      /x1/
    );
  });
});
