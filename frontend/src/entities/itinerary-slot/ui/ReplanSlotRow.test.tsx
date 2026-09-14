import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ReplanSlotVM } from './ReplanSlotRow';
import { ReplanSlotRow } from './ReplanSlotRow';

/**
 * TRIP-563 · AC-4(컴포넌트, 슬롯 행) — 슬롯 1행(순수 props+콜백).
 *
 * 무엇을 보장하나:
 *  - 🔴 배지(방문함/진행 중/변경됨/고정)·장소명·거리 메타가 렌더된다.
 *  - 🔴 `candidateCount>0 && !isFixed` 면 "다른 후보 N >"(testID planb-draft-candidates-{slotKey}),
 *    `isFixed` 면 고정 pill — 두 어포던스가 상호배타.
 *  - 🔴 후보 어포던스 탭 → onPressCandidates(slotKey) 1회(시트 열기 배선 — 실제 열림은 6-b, ★).
 *  - 🔴 메타에 소요시간 단위(분·시간·소요) 없음(INV-3, 거리·시각범위는 허용).
 *
 * ★ 후보 시트(i14)는 통과형 바텀시트 목이라 실제 열림을 jest 가 못 본다 — onPress 발화/인자로만 잠근다.
 * ★ toHaveTextContent: 값 하나짜리 leaf(메타)는 STRING **완전일치**로 서버값 통과를 정확히 잠그고,
 *   글리프 공존(배지·"다른 후보 N >"·고정 pill)은 **정규식 부분**으로 잰다(node_modules 실측).
 *
 * 3동작 뼈대: 준비=vm → 실행=렌더/press → 단언=배지·메타·어포던스 존재/부재·불린 콜백.
 */

function renderRow(vm: ReplanSlotVM) {
  const onPressCandidates = jest.fn();
  render(<ReplanSlotRow vm={vm} onPressCandidates={onPressCandidates} />);
  return { onPressCandidates };
}

describe('🔴 ReplanSlotRow — 변경됨 + 후보 어포던스(AC-4)', () => {
  it('R1 · AC-4 — 배지·장소명·거리메타·"다른 후보 4 >" 렌더 + 탭이 slotKey 를 실어 1회 위임', () => {
    const { onPressCandidates } = renderRow({
      slotKey: 's1',
      badgeKind: 'changed',
      placeName: '감천문화마을',
      metaText: '#실내 · 도보 1.3km',
      candidateCount: 4,
      isFixed: false,
    });

    // 배지 leaf — 값 하나(STRING 완전일치).
    expect(screen.getByTestId('planb-draft-badge-s1')).toHaveTextContent(
      '변경됨'
    );
    // 장소명.
    expect(screen.getByText('감천문화마을')).toBeOnTheScreen();
    // 거리 메타 leaf — 서버값 통과(STRING 완전일치) + 소요시간 단위 0(INV-3).
    expect(screen.getByTestId('planb-draft-slot-meta-s1')).toHaveTextContent(
      '#실내 · 도보 1.3km'
    );
    expect(
      screen.getByTestId('planb-draft-slot-meta-s1')
    ).not.toHaveTextContent(/분|시간|소요/);

    // 후보 어포던스 존재(체브론 글리프 공존 → 정규식 부분) + 고정 pill 부재.
    expect(screen.getByTestId('planb-draft-candidates-s1')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-draft-candidates-s1')).toHaveTextContent(
      /다른 후보\s*4/
    );
    expect(screen.queryByTestId('planb-draft-fixed-s1')).toBeNull();

    // 탭 → 시트 열기 배선(핸들러 호출·인자로만 관찰, 실제 열림은 6-b).
    fireEvent.press(screen.getByTestId('planb-draft-candidates-s1'));
    expect(onPressCandidates).toHaveBeenCalledTimes(1);
    expect(onPressCandidates).toHaveBeenCalledWith('s1');
  });
});

describe('🔴 ReplanSlotRow — 고정 슬롯(AC-4)', () => {
  it('R2 · AC-4 — isFixed 면 고정 pill, 후보 어포던스 없음, 메타는 통과·소요시간 0', () => {
    renderRow({
      slotKey: 's2',
      badgeKind: 'fixed',
      placeName: '해운대 호텔',
      metaText: '20:00 도착 · 변경 불가',
      candidateCount: 0,
      isFixed: true,
    });

    // 고정 pill(자물쇠 글리프 공존 → 정규식 부분).
    expect(screen.getByTestId('planb-draft-fixed-s2')).toHaveTextContent(
      /고정/
    );
    // isFixed=true 라 후보 어포던스는 안 뜬다(상호배타).
    expect(screen.queryByTestId('planb-draft-candidates-s2')).toBeNull();
    // 메타 통과 + 소요시간 0.
    expect(screen.getByTestId('planb-draft-slot-meta-s2')).toHaveTextContent(
      '20:00 도착 · 변경 불가'
    );
    expect(
      screen.getByTestId('planb-draft-slot-meta-s2')
    ).not.toHaveTextContent(/분|시간|소요/);
  });
});

describe('🔴 ReplanSlotRow — 방문함·진행중·배지없음(AC-4)', () => {
  it('R3a · AC-4 — 방문함 배지 + 후보 0 이면 어포던스·pill 둘 다 없음', () => {
    renderRow({
      slotKey: 's3',
      badgeKind: 'visited',
      placeName: '자갈치시장',
      metaText: '09:30–10:50 · 사진 2장',
      candidateCount: 0,
      isFixed: false,
    });

    expect(screen.getByTestId('planb-draft-badge-s3')).toHaveTextContent(
      '방문함'
    );
    // candidateCount 0 이라 어포던스 없음(count>0 조건 미충족), 고정도 아님.
    expect(screen.queryByTestId('planb-draft-candidates-s3')).toBeNull();
    expect(screen.queryByTestId('planb-draft-fixed-s3')).toBeNull();
  });

  it('R3b · AC-4 — 진행 중 배지', () => {
    renderRow({
      slotKey: 's4',
      badgeKind: 'inProgress',
      placeName: '광안리',
      metaText: '13:00 도착 · 관람 중',
      candidateCount: 0,
      isFixed: false,
    });

    expect(screen.getByTestId('planb-draft-badge-s4')).toHaveTextContent(
      '진행 중'
    );
  });

  it('R3c · AC-4 — badgeKind null 이면 배지 미렌더(행 루트·장소명은 존재 — 공허 통과 방지)', () => {
    renderRow({
      slotKey: 's5',
      badgeKind: null,
      placeName: '보수동 책방골목',
      metaText: '도보 0.6km',
      candidateCount: 0,
      isFixed: false,
    });

    // 부재 단언은 존재 긍정 짝과 함께(행 자체가 안 떠서 공짜 통과 차단).
    expect(screen.queryByTestId('planb-draft-badge-s5')).toBeNull();
    expect(screen.getByTestId('planb-draft-slot-s5')).toBeOnTheScreen();
    expect(screen.getByText('보수동 책방골목')).toBeOnTheScreen();
  });
});
