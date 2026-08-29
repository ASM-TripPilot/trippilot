import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { TriggerWatchlistRow } from '@/features/planb/model/triggerWatchlist';
import type { Trigger } from '@/shared/api/generated/schemas';

import { TriggerWatchlistScreen } from './TriggerWatchlistScreen';

/**
 * TRIP-562 · i09 감시 항목 열람 화면 — 순수 프레젠테이션(사영 결과를 props 로 받아 그리기만).
 *
 * 무엇을 보장하나:
 *  - 🔴 감시 3행이 각각 **Figma 카테고리명**(날씨·이동 지연·영업·휴무) + 상태 배지(활성/정상)로 뜨고,
 *    MANUAL 행은 없다(AC-1). 이름은 사영 `row.label`(상시 카테고리), i08 칩의 활성 제목과 다르다(★1).
 *  - 🔴 발화 트리거가 있으면 활성 배너에 그 `reason` 이 제목으로, 활성 행 부제도 `reason`, CTA press →
 *    콜백(AC-2). 없으면 배너 부재 + 3행 전부 정상(AC-2 부재).
 *  - 🔴 하단 수동 CTA press → 콜백(AC-5).
 *  - 🔴 정상 행 부제는 정적 '정상'만 — 계약 밖 값(840m·poi명·시각) 미표시(honest rendering, ★2).
 *
 * ★ AC-3 가드 실효 링크는 **아이콘 경로**로 옮겼다(오케 교정): 화면이 kind→아이콘을 하드코딩하지 말고
 *   `triggerLabel(kind).iconKey` 경유임을 소스 스캔(labelSource)이 잠근다 — 이름은 카테고리 상수라 그
 *   축이 아니다. 이 화면 테스트는 렌더 계약(이름·상태·부제·콜백)을 behavior 로 잠근다.
 *
 * 개념: `within(node)` = 그 서브트리 안에서만 쿼리. `toHaveTextContent('정상')` = **완전일치**(RNTL
 * 13.3.3, 02a §4 근거) → '정상 · 840m' 이 한 노드에 섞이면 못 찾아 red. 부제·배지가 둘 다 '정상'
 * 이라 leaf testID(`-sub-`·`-badge-`)로 값 하나씩 담아 완전일치로 읽는다(리포 관례).
 *
 * 사영은 페이지가 1회 수행(★3) — 화면은 재판정 없이 rows 를 그대로 받는다.
 */

const CATEGORY = {
  WEATHER: '날씨',
  DELAY: '이동 지연',
  CLOSURE: '영업·휴무',
} as const;

/** 활성 kind→사유 맵을 받아 3행을 만든다(사영 결과 흉내). 미지정 kind 는 normal·null. */
function rowsOf(
  activeReason: Partial<Record<TriggerWatchlistRow['kind'], string>>
): TriggerWatchlistRow[] {
  return (['WEATHER', 'DELAY', 'CLOSURE'] as const).map((kind) => {
    const reason = activeReason[kind];
    return {
      kind,
      label: CATEGORY[kind],
      status: reason ? 'active' : 'normal',
      reason: reason ?? null,
    };
  });
}

const banner: Trigger = {
  triggerId: 'trg-1',
  kind: 'WEATHER',
  affectedDate: '2026-08-20',
  slotKey: null,
  reason: '비 예보 70%',
  scope: 'PARTIAL_SLOTS',
  detectedAt: '2026-08-20T09:00:00Z',
};

describe('TriggerWatchlistScreen (i09)', () => {
  it('🔴 S1 감시 3행 · 카테고리명 · 상태 배지 · MANUAL 부재 (AC-1)', () => {
    render(
      <TriggerWatchlistScreen
        activeBanner={banner}
        rows={rowsOf({ WEATHER: '비 예보 70%' })}
        onPressAlternative={jest.fn()}
        onPressManual={jest.fn()}
      />
    );

    expect(screen.getByTestId('planb-triggers-screen')).toBeTruthy();

    const weatherRow = screen.getByTestId('planb-triggers-item-weather');
    const delayRow = screen.getByTestId('planb-triggers-item-delay');
    const closureRow = screen.getByTestId('planb-triggers-item-closure');

    // 이름 = Figma 카테고리명(상시 카테고리, ★1). 카테고리명은 행 안에서 유일해 within+getByText.
    expect(within(weatherRow).getByText('날씨')).toBeTruthy();
    expect(within(delayRow).getByText('이동 지연')).toBeTruthy();
    expect(within(closureRow).getByText('영업·휴무')).toBeTruthy();

    // 상태 배지 — 발화 kind(WEATHER)='활성', 나머지='정상'(leaf 완전일치).
    expect(
      screen.getByTestId('planb-triggers-badge-weather')
    ).toHaveTextContent('활성');
    expect(screen.getByTestId('planb-triggers-badge-delay')).toHaveTextContent(
      '정상'
    );
    expect(
      screen.getByTestId('planb-triggers-badge-closure')
    ).toHaveTextContent('정상');

    // MANUAL 은 목록에 없다(★8).
    expect(screen.queryByTestId('planb-triggers-item-manual')).toBeNull();
    expect(screen.queryByText('변경 요청')).toBeNull();
  });

  it('🔴 S2 활성 배너 reason 제목 + 활성 행 부제 reason + CTA press → 콜백 (AC-2)', () => {
    const onPressAlternative = jest.fn();
    render(
      <TriggerWatchlistScreen
        activeBanner={banner}
        rows={rowsOf({ WEATHER: '비 예보 70%' })}
        onPressAlternative={onPressAlternative}
        onPressManual={jest.fn()}
      />
    );

    // 배너 제목 = 서버 reason(동적). 활성 행 부제도 같은 reason 이라 leaf testID 로 각각 완전일치.
    expect(screen.getByTestId('planb-triggers-active-title')).toHaveTextContent(
      '비 예보 70%'
    );
    expect(screen.getByTestId('planb-triggers-sub-weather')).toHaveTextContent(
      '비 예보 70%'
    );

    expect(screen.getByTestId('planb-triggers-active-cta')).toBeTruthy();
    fireEvent.press(screen.getByTestId('planb-triggers-active-cta'));
    expect(onPressAlternative).toHaveBeenCalledTimes(1);
  });

  it('🔴 S3 발화 없음 → 활성 배너 부재 + 3행 전부 정상 (AC-2 부재 · INV-U4-01)', () => {
    render(
      <TriggerWatchlistScreen
        activeBanner={null}
        rows={rowsOf({})}
        onPressAlternative={jest.fn()}
        onPressManual={jest.fn()}
      />
    );

    expect(screen.queryByTestId('planb-triggers-active-cta')).toBeNull();
    expect(screen.queryByTestId('planb-triggers-active-title')).toBeNull();

    for (const kind of ['weather', 'delay', 'closure']) {
      expect(screen.getByTestId(`planb-triggers-item-${kind}`)).toBeTruthy();
      expect(
        screen.getByTestId(`planb-triggers-badge-${kind}`)
      ).toHaveTextContent('정상');
    }
  });

  it('🔴 S4 하단 수동 CTA press → onPressManual (AC-5)', () => {
    const onPressManual = jest.fn();
    render(
      <TriggerWatchlistScreen
        activeBanner={null}
        rows={rowsOf({})}
        onPressAlternative={jest.fn()}
        onPressManual={onPressManual}
      />
    );

    expect(screen.getByTestId('planb-triggers-manual-cta')).toBeTruthy();
    fireEvent.press(screen.getByTestId('planb-triggers-manual-cta'));
    expect(onPressManual).toHaveBeenCalledTimes(1);
  });

  it('🔴 S5 정상 행 부제는 정적 정상만 — 계약 밖 값(840m·poi명) 미표시 (honest rendering, ★2)', () => {
    render(
      <TriggerWatchlistScreen
        activeBanner={null}
        rows={rowsOf({})}
        onPressAlternative={jest.fn()}
        onPressManual={jest.fn()}
      />
    );

    // 부제 leaf = 정적 '정상'만(완전일치라 '정상 · 840m' 이면 red).
    expect(screen.getByTestId('planb-triggers-sub-delay')).toHaveTextContent(
      '정상'
    );
    // 거리·poi명은 계약에 없어 그릴 소스가 없다 → 미표시.
    const delayRow = screen.getByTestId('planb-triggers-item-delay');
    expect(within(delayRow).queryByText(/840/)).toBeNull();
    expect(within(delayRow).queryByText(/광안리/)).toBeNull();
  });
});
