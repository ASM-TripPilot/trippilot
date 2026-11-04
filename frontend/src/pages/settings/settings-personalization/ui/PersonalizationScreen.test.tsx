import { fireEvent, render, screen } from '@testing-library/react-native';

import { PersonalizationInfoReason } from '@/shared/api/index.schemas';
import type { PersonalizationItem } from '@/shared/api/index.schemas';

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

describe('🔴 TRIP-991 · 개인화 스위치 이름 (AC-3)', () => {
  it('토글은 "지난 기록으로 추천 맞춤" 스위치로 읽힌다', () => {
    renderScreen({ consentOn: true });

    expect(
      screen.getByRole('switch', { name: '지난 기록으로 추천 맞춤' })
    ).toHaveProp('testID', 'settings-personalization-toggle');
  });
});

/**
 * TRIP-1755 · 개인화 조회가 안 끝났거나 실패했으면 토글을 그리지 않는다(INV-4 · BR-U0-12).
 *
 * 왜: 토글은 "동의했나"를 보여주는 면인데, 조회가 실패해도 기본값(동의 없음)으로 OFF 를 그리면 실제 동의자가
 * 철회하지 못하고 누르면 GRANT 가 나가 법적 증적이 한 줄 더 쌓인다. 그래서 `loadState` 가 'ready' 가 아니면
 * 토글·안내 문구·목록을 모두 빼고 로딩/오류 카드로 바꾼다(위치 l06 `settings-location-consent-loading/-error/-retry` 동형).
 *
 * 무엇을 보장하나(prop `loadState?: 'loading'|'error'|'ready'` 기본 'ready', `onRetry?`):
 *  - PS1 'error' → 오류 카드·다시 시도, 토글·목록·"동의하면…" 문구·"사용 안 함" 부제 없음. 헤더 뒤로는 남는다.
 *  - PS2 'loading' → 로딩 카드, 토글·목록·오류 카드 없음.
 *  - PS3 'ready'(명시) → 토글 있고 새 testID 3종 없음.
 * 3동작 뼈대: 준비=props(reason 기본 CONSENT_MISSING + 목록 2개 — 거짓 표면이 새면 보이도록) → 실행=render → 단언=testID.
 */
describe('TRIP-1755 · PersonalizationScreen — 로딩·오류 얼굴', () => {
  const LOADING = 'settings-personalization-load-loading';
  const ERROR = 'settings-personalization-load-error';
  const RETRY = 'settings-personalization-load-retry';
  const TOGGLE = 'settings-personalization-toggle';

  it('PS1 error → 오류 카드·다시 시도가 있고, 토글·목록·안내 문구·부제는 없으며, 뒤로·다시 시도가 콜백으로 나간다', () => {
    const onRetry = jest.fn();
    const props = renderScreen({
      loadState: 'error',
      onRetry,
      consentOn: false,
      reason: PersonalizationInfoReason.CONSENT_MISSING,
      sharedItems: TWO_ITEMS,
    });

    expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
    expect(screen.getByTestId(RETRY)).toBeOnTheScreen();
    expect(screen.queryByTestId(TOGGLE)).toBeNull();
    expect(
      screen.queryAllByTestId('settings-personalization-item')
    ).toHaveLength(0);
    expect(screen.queryByText(/동의하면/)).toBeNull();
    expect(screen.queryByText(/사용 안 함/)).toBeNull();
    expect(screen.queryByTestId(LOADING)).toBeNull();

    fireEvent.press(screen.getByTestId(RETRY));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('settings-personalization-back'));
    expect(props.onPressBack).toHaveBeenCalledTimes(1);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('PS2 loading → 로딩 카드만 있고 토글·목록·오류 카드는 없다', () => {
    renderScreen({
      loadState: 'loading',
      consentOn: false,
      reason: PersonalizationInfoReason.CONSENT_MISSING,
      sharedItems: TWO_ITEMS,
    });

    expect(screen.getByTestId(LOADING)).toBeOnTheScreen();
    expect(screen.queryByTestId(TOGGLE)).toBeNull();
    expect(
      screen.queryAllByTestId('settings-personalization-item')
    ).toHaveLength(0);
    expect(screen.queryByText(/동의하면/)).toBeNull();
    expect(screen.queryByTestId(ERROR)).toBeNull();
    expect(screen.queryByTestId(RETRY)).toBeNull();
  });

  it("PS3 loadState='ready' 를 명시하면 토글이 있고 로딩·오류 카드는 없다(기본값과 같다)", () => {
    renderScreen({ loadState: 'ready', consentOn: true });

    expect(screen.getByTestId(TOGGLE)).toBeChecked();
    expect(screen.queryByTestId(LOADING)).toBeNull();
    expect(screen.queryByTestId(ERROR)).toBeNull();
    expect(screen.queryByTestId(RETRY)).toBeNull();
  });
});
