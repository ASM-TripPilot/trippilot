import { Pressable, Text, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import type { DraftDayTab, DraftPin, DraftView } from '../model/draftView';
// 미존재 타입 참조 — implementer 가 `draftView.ts` 에 더할 계약이다. `import type` 은 babel 가
// 런타임에 지우므로 이 타입이 아직 없어도 red 실행에 지장이 없다(02a ★2 · §5-D).
import type { FallbackNotice } from '../model/draftView';
import { buildSlotKey } from '../model/slotKey';
import { DraftScreen } from './DraftScreen';

/**
 * h11 초안 화면에 **TRIP-304 가 얹는 폴백·강등 배너**의 렌더 계약(그림층).
 *
 * 무엇을 보장하나 — 화면은 완성된 배너 값(`fallbackNotice`)만 받는다(판정은 model 몫):
 *  - 🔴 DETERMINISTIC 배너에 "기본 모드" 안내가 뜨고 카드 목록은 그대로다(AC-1 · 곁에 붙는 한 줄).
 *  - 🔴 MINIMAL 배너에는 **배너 안 [다시 시도]** 버튼이 있고 눌린다(AC-2). 확정 방어도 재사용한다.
 *  - 🔴 배너는 언제나 **정확히 1건**, retry 는 **MINIMAL 에서만**(AC-3 그림축 · 결정 4).
 *  - 🔴 배너 서브트리에 숫자가 0자, 화면 전체에 소요시간 표기가 0건(AC-5 · INV-3).
 *  - 신호가 없으면 배너가 0건이다(AC-4 짝 — "항상 배너" 죽이기).
 *
 * ⚠️ **왜 동결 297 `DraftScreen.test.tsx` 가 아니라 새 파일인가**: 그 파일은 게이트①로 바이트
 * 동결됐고 그 안 C2·C7 이 이 표면의 경계선이다(02a ★1). 같은 파일을 열어 섞으면 "안 깼다"를
 * 바이트 동일성으로 보일 수 없다.
 *
 * 3동작 뼈대: 준비=`view`·`fallbackNotice` 를 만들어 렌더 → 실행=(retry 만 press) → 단언=보이는 것·없는 것.
 */

// 지도는 이 칸의 심판 대상이 아니다 — 실물 `KakaoMapView` 가 뜨지 않게만 막는다(동결 화면 테스트와
// 같은 목킹 규약: 인라인 팩토리는 NativeWind babel 호이스트 규칙에 걸린다).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

const DAY1 = '2026-06-10';

function slot(
  over: Partial<ItineraryDaysItemSlotsItem> & { poiId: string }
): ItineraryDaysItemSlotsItem {
  return {
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

const SLOTS = [
  slot({ poiId: 'poi-a', nameKo: '성산일출봉', tags: ['바다'] }),
  slot({ poiId: 'poi-b', startAt: '12:30:00', nameKo: '카페 그레이' }),
  slot({ poiId: 'poi-c', startAt: '15:00:00', nameKo: '올레시장' }),
];

const DAYS: ItineraryDaysItem[] = [{ date: DAY1, slots: SLOTS }];
const TABS: DraftDayTab[] = [{ date: DAY1, dayNumber: 1, hasData: true }];
/** 핀을 비워 둔다 — 지도는 이 칸의 관심사가 아니고, 빈 배열이면 화면이 지도 블록을 통째로 뺀다. */
const NO_PINS: DraftPin[] = [];

const BANNER = 'itinerary-draft-fallback-banner';
/** MINIMAL 배너 안 전용 [다시 시도] 버튼(신규 testID · 01b 결정 4). */
const RETRY = 'itinerary-draft-fallback-retry';

/** 소요시간 표기 탐지기(297 C7 과 같은 것). 자손을 이어붙여 비교하므로 쪼개 그려도 잡힌다. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 카드 루트만 세는 셀렉터(동결 `DraftScreen.test.tsx` 규약과 같은 형태 — 하위 접두 제외). */
const CARD_SUB_PREFIXES = [
  'no-',
  'band-',
  'badge-',
  'fixed-',
  'image-',
  'tags-',
  'name-',
];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-draft-slot-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-draft-slot-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

function cardId(poiId: string): string {
  return `itinerary-draft-slot-${buildSlotKey(DAY1, poiId)}`;
}

/** 렌더된 텍스트 전부. 부정 스캔(INV-3)의 모집단이다 — 소스가 아니라 **보이는 글자**를 훑는다. */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

function listed(days: ItineraryDaysItem[] = DAYS): DraftView {
  return { kind: 'listed', days, staleFailed: false };
}

type Overrides = {
  view?: DraftView;
  fallbackNotice?: FallbackNotice | null;
  canRetry?: boolean;
};

const onRetry = jest.fn();

function renderScreen(over: Overrides = {}) {
  return render(
    <DraftScreen
      view={listed()}
      tabs={TABS}
      selectedDate={DAY1}
      pins={NO_PINS}
      dayHeader="6월 10일 · 수"
      canRetry
      onSelectDay={jest.fn()}
      onRetry={onRetry}
      onBack={jest.fn()}
      {...over}
    />
  );
}

beforeEach(() => {
  onRetry.mockClear();
});

describe('S0 · 자가검사 — 이게 통과해야 아래 "배너 숫자 0건"·"문구" 단언이 의미를 갖는다', () => {
  it('배너 서브트리 숫자 탐지는 쪼개 그려도 잡고, 부정 단언에는 정규식을 써야 한다', () => {
    render(
      <View>
        <View testID="probe-banner-clean">
          <Text>일부 추천이 기본 모드로 생성됐어요</Text>
        </View>
        <View testID="probe-banner-dirty">
          <Text>후보 </Text>
          <Text>0</Text>
          <Text>곳</Text>
        </View>
        <Pressable testID="probe-retry" accessibilityRole="button">
          <Text>다시 시도</Text>
        </Pressable>
      </View>
    );

    // ① ★ 조합 검증 — `toHaveTextContent` 는 자손 텍스트를 **구분자 없이 이어 붙여** 비교한다
    //    (02a §5-A·§5-B). 배너 서브트리에 숫자가 쪼개져 있어도 `/\d/` 가 잡는다.
    expect(screen.getByTestId('probe-banner-dirty')).toHaveTextContent(/\d/);
    expect(screen.getByTestId('probe-banner-clean')).not.toHaveTextContent(
      /\d/
    );

    // ② ★ 함정 — **문자열 인자는 완전 일치다**(02a §5-A). 넓은 서브트리에 문자열로 부정 단언을
    //    걸면 **보이는데도 "없다"로 통과한다.** 첫 줄이 그 가짜 통과, 둘째 줄(정규식)이 진짜 탐지다.
    expect(screen.getByTestId('probe-banner-clean')).not.toHaveTextContent(
      '기본 모드'
    );
    expect(screen.getByTestId('probe-banner-clean')).toHaveTextContent(
      /기본 모드/
    );

    // ③ retry 프로브 — 버튼이 testID·역할로 잡히고 텍스트가 비어 있지 않다(S2·S3 근거).
    expect(screen.getByTestId('probe-retry')).toHaveTextContent(/\S/);
  });
});

describe('🔴 S1 · AC-1 — DETERMINISTIC 배너가 "기본 모드"로 뜨고 목록을 갈아 끼우지 않는다', () => {
  it('배너에 "기본 모드"가 있고 카드 3장이 그대로 남으며 retry 버튼은 없다', () => {
    renderScreen({ fallbackNotice: { kind: 'deterministic' } });

    // ① 안내가 삼켜지지 않았다(INV-4). 핵심어만 정규식으로 — 정확 문안은 01b 가 열어 뒀다.
    const banner = screen.getByTestId(BANNER);
    expect(banner).toBeOnTheScreen();
    expect(banner).toHaveTextContent(/기본 모드/);

    // ② 목록이 그대로다 — 안내는 곁에 붙는 한 줄이지 얼굴이 아니다.
    expect(cardTestIds()).toHaveLength(3);
    expect(screen.getByTestId(cardId('poi-a'))).toHaveTextContent(/성산일출봉/);

    // ③ 다른 얼굴로 갈아 끼우지 않았다.
    [
      'itinerary-draft-loading',
      'itinerary-draft-failed',
      'itinerary-draft-empty',
      'itinerary-draft-zero',
    ].forEach((testID) => expect(screen.queryAllByTestId(testID)).toEqual([]));

    // ④ DETERMINISTIC 배너에는 [다시 시도] 버튼이 없다 — retry 는 MINIMAL 전용이다(결정 4 · S3).
    expect(screen.queryAllByTestId(RETRY)).toEqual([]);
  });
});

describe('🔴 S2 · AC-2 — MINIMAL 배너 안 [다시 시도] 버튼이 뜨고 눌린다 (확정 방어 재사용)', () => {
  it('배너와 배너 내 retry 버튼이 뜨고 누르면 onRetry 가 1회 불린다', () => {
    renderScreen({ fallbackNotice: { kind: 'minimal' }, canRetry: true });

    const banner = screen.getByTestId(BANNER);
    expect(banner).toBeOnTheScreen();
    expect(banner).toHaveTextContent(/\S/); // 비어 있지 않음(정확 문안은 안 잠금)

    const retry = screen.getByTestId(RETRY);
    expect(retry).toBeOnTheScreen();
    expect(retry).toHaveTextContent(/\S/);

    fireEvent.press(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('🔴 canRetry=false 면 배너 retry 도 비활성이고 눌러도 콜백이 0회다 (298 C13 계열)', () => {
    /**
     * ⚠️ 확정 일정에 재생성 POST 가 나가면 확정이 풀리고 동결 스냅숏이 사라진다 — 되돌리는 API 가
     * 없다. `toBeDisabled()` 단독은 "회색인데 눌리는" 구현을 통과시키므로(02a ★8) press 0회를 짝으로.
     */
    renderScreen({ fallbackNotice: { kind: 'minimal' }, canRetry: false });

    const retry = screen.getByTestId(RETRY);
    expect(retry).toBeDisabled();
    fireEvent.press(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('🔴 S3 · AC-3 그림축 — 배너는 정확히 1건, retry 는 MINIMAL 에서만', () => {
  it('세 kind 각각 배너 1건이고, retry 는 minimal 만 1·나머지는 0이다', () => {
    (
      [
        { kind: 'minimal', retry: 1 },
        { kind: 'deterministic', retry: 0 },
        { kind: 'demoted', retry: 0 },
      ] as const
    ).forEach(({ kind, retry }) => {
      renderScreen({ fallbackNotice: { kind } });

      // 배너는 어느 kind 든 정확히 하나 — 두 겹으로 쌓으면 위반(AC-3).
      expect(screen.queryAllByTestId(BANNER)).toHaveLength(1);
      // retry 는 minimal 에서만 있다(결정 4).
      expect(screen.queryAllByTestId(RETRY)).toHaveLength(retry);

      screen.unmount();
    });
  });
});

describe('🔴 S4 · AC-5 — 배너에 숫자가 0자, 화면 어디에도 소요시간 표기가 없다 (INV-3)', () => {
  it.each(['deterministic', 'minimal'] as const)(
    '%s 배너 서브트리에 숫자 0자 · 화면 전체 소요시간 0건',
    (kind) => {
      renderScreen({ fallbackNotice: { kind } });

      // 긍정 앵커 먼저 — 없으면 아무것도 안 그리는 화면이 아래 부정 단언을 공짜로 통과한다.
      expect(screen.getByTestId(cardId('poi-a'))).toHaveTextContent(
        /성산일출봉/
      );

      // ⚠️ 모집단을 **배너로 잘랐다** — 화면 전체로 재면 `6월 10일 · 수`·`1일차`·`3곳` 이 걸려
      //    어떤 올바른 구현도 통과할 수 없는 심판이 된다(02a ★4). 숫자 0자면 개수·시각·소요가 전부 없다.
      expect(screen.getByTestId(BANNER)).not.toHaveTextContent(/\d/);

      // 소요시간(`소요`·`N분`·`N시간`)은 화면 어디에도 없다 — 297 C7 과 같은 렌더 스캔.
      expect(
        renderedTexts().filter((text) => DURATION_TEXT.test(text))
      ).toEqual([]);
    }
  );
});

describe('S5 · AC-4 짝 — 신호를 안 넘기면 배너가 0건이다', () => {
  it('fallbackNotice 를 안 주면 배너가 없고 목록은 평소대로다', () => {
    // "항상 배너"인 구현을 죽이는 짝. 서버가 신호를 안 주는 것이 당분간의 정상 경로다.
    renderScreen();

    expect(screen.queryAllByTestId(BANNER)).toEqual([]);
    expect(cardTestIds()).toHaveLength(3);
  });
});
