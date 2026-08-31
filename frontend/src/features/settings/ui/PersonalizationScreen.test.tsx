import { fireEvent, render, screen } from '@testing-library/react-native';

import { PersonalizationInfoReason } from '@/shared/api/generated/schemas';
import type { PersonalizationItem } from '@/shared/api/generated/schemas';

import { PersonalizationScreen } from './PersonalizationScreen';

/**
 * TRIP-612 · l05 개인화 화면(무상태 프레젠테이션).
 *
 * 무엇을 보장하나:
 *  - AC-1: reason='APPLIED' → 토글 ON + sharedItems 를 **개수만큼** 목록 렌더(item·purpose 둘 다).
 *  - AC-2: reason='CONSENT_MISSING' → 토글 OFF + "동의하면 지난 기록을 반영해요" + 목록 빔.
 *  - AC-3(★함정): reason='NOT_ENOUGH_RECORDS' → 토글 **ON 유지**(이미 동의) + "기록이 더 쌓이면
 *    반영돼요" + **"동의하면…" 문구 부재**(BR-U5-44). applied 와 reason 은 다른 축.
 *  - AC-4: 목록 개수 = sharedItems.length — 하드코딩/placeholder 목록이면 red.
 *
 * 왜 화면 층인가: reason→얼굴(토글·문구·목록)은 프레젠테이션의 성질이라 props 주입 + 콜백 jest.fn()
 *  으로 잰다. 서버 호출·재조회 배선은 `PersonalizationPage.integration.test.tsx`(T3) 가 잠근다.
 *
 * (개념) 매처:
 *  - `toBeChecked()` — role="switch" 요소의 accessibilityState.checked 를 읽는다(ON/OFF).
 *  - `getByText('완전문자열')` 있음(완전일치, 없으면 throw) / `queryByText(...)` 없으면 null.
 *  - `queryByText(/정규식/)` 부분포함 — "동의하면" 조각이 어디에도 없으면 null(AC-3 급소).
 *  - `queryAllByTestId(id)` 매칭 전부를 배열로(0개면 []) → `.toHaveLength(n)` 으로 개수를 잰다.
 */

const COPY_CONSENT_MISSING = '동의하면 지난 기록을 반영해요';
const COPY_NOT_ENOUGH = '기록이 더 쌓이면 반영돼요';

const TWO_ITEMS: PersonalizationItem[] = [
  { item: '맛집 방문 기록', purpose: '다음 여행 맛집 추천' },
  { item: '야경 스팟 저장', purpose: '저녁 일정 배치' },
];

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof PersonalizationScreen>> = {}
) {
  const props = {
    consentOn: true,
    reason: PersonalizationInfoReason.APPLIED,
    sharedItems: [] as PersonalizationItem[],
    onToggle: jest.fn(),
    onPressBack: jest.fn(),
    ...overrides,
  };
  render(<PersonalizationScreen {...props} />);
  return props;
}

describe('TRIP-612 · PersonalizationScreen — APPLIED(AC-1)', () => {
  it('토글 ON + sharedItems 를 개수만큼(item·purpose 둘 다) 렌더, 헤드라인 문구는 없다', () => {
    renderScreen({
      consentOn: true,
      reason: PersonalizationInfoReason.APPLIED,
      sharedItems: TWO_ITEMS,
    });

    // 토글은 켜져 있다.
    expect(screen.getByTestId('settings-personalization-toggle')).toBeChecked();

    // 목록 개수 = sharedItems.length(=2), 각 항목의 item·purpose 가 함께 뜬다.
    expect(
      screen.queryAllByTestId('settings-personalization-item')
    ).toHaveLength(2);
    expect(screen.getByText('맛집 방문 기록')).toBeOnTheScreen();
    expect(screen.getByText('다음 여행 맛집 추천')).toBeOnTheScreen();

    // 부정 짝: APPLIED 는 안내 문구를 발명하지 않는다(01b Q4) — 목록이 대신 말한다.
    expect(screen.queryByText(COPY_CONSENT_MISSING)).toBeNull();
    expect(screen.queryByText(COPY_NOT_ENOUGH)).toBeNull();
  });
});

describe('TRIP-612 · PersonalizationScreen — CONSENT_MISSING(AC-2)', () => {
  it('토글 OFF + "동의하면 지난 기록을 반영해요" + 목록 빔', () => {
    renderScreen({
      consentOn: false,
      reason: PersonalizationInfoReason.CONSENT_MISSING,
      sharedItems: [],
    });

    expect(
      screen.getByTestId('settings-personalization-toggle')
    ).not.toBeChecked();
    expect(screen.getByText(COPY_CONSENT_MISSING)).toBeOnTheScreen();
    expect(
      screen.queryAllByTestId('settings-personalization-item')
    ).toHaveLength(0);
  });
});

describe('TRIP-612 · PersonalizationScreen — ★NOT_ENOUGH_RECORDS(AC-3)', () => {
  it('토글 ON 유지 + "기록이 더 쌓이면 반영돼요" + "동의하면…" 문구 부재', () => {
    renderScreen({
      consentOn: true,
      reason: PersonalizationInfoReason.NOT_ENOUGH_RECORDS,
      sharedItems: [],
    });

    // 이미 동의한 사용자다 — 토글은 켜진 채로 남는다.
    expect(screen.getByTestId('settings-personalization-toggle')).toBeChecked();
    expect(screen.getByText(COPY_NOT_ENOUGH)).toBeOnTheScreen();

    // 급소(BR-U5-44): "동의하면" 조각이 화면 어디에도 없다(부분포함 정규식 + null).
    expect(screen.queryByText(/동의하면/)).toBeNull();

    // applied=false 이므로 목록도 비어 있다.
    expect(
      screen.queryAllByTestId('settings-personalization-item')
    ).toHaveLength(0);
  });
});

describe('TRIP-612 · PersonalizationScreen — 목록 개수 = sharedItems.length(AC-4)', () => {
  const THREE_ITEMS: PersonalizationItem[] = [
    { item: 'a', purpose: 'A' },
    { item: 'b', purpose: 'B' },
    { item: 'c', purpose: 'C' },
  ];

  // 화면이 sharedItems 만 map 함을 못박는다 — 하드코딩 목록이면 개수가 어긋나 red.
  it.each([
    [PersonalizationInfoReason.APPLIED, [] as PersonalizationItem[], 0],
    [PersonalizationInfoReason.APPLIED, THREE_ITEMS, 3],
    [PersonalizationInfoReason.CONSENT_MISSING, [] as PersonalizationItem[], 0],
  ])(
    'reason=%s, sharedItems=%d건 → item testID %d개',
    (reason, items, count) => {
      renderScreen({
        consentOn: reason === PersonalizationInfoReason.APPLIED,
        reason,
        sharedItems: items,
      });
      expect(
        screen.queryAllByTestId('settings-personalization-item')
      ).toHaveLength(count);
    }
  );
});

describe('TRIP-612 · PersonalizationScreen — 토글·뒤로 배선', () => {
  it('토글 press → onToggle 1회 · 뒤로 press → onPressBack 1회', () => {
    const props = renderScreen({
      consentOn: true,
      reason: PersonalizationInfoReason.APPLIED,
    });

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    expect(props.onToggle).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('settings-personalization-back'));
    expect(props.onPressBack).toHaveBeenCalledTimes(1);
  });
});
