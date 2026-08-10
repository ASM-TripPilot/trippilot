import { Text, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import type { DraftDayTab, DraftPin, DraftView } from '../model/draftView';
import { buildSlotKey } from '../model/slotKey';
import { DraftScreen } from './DraftScreen';

/**
 * h11 초안 화면에 **TRIP-298 이 더하는 표면 하나**(후보 강등 안내)의 렌더 계약.
 *
 * 무엇을 보장하나:
 *  - 🔴 강등 안내가 **곁에 붙는 한 줄**이지 얼굴이 아니다 — 안내가 떠도 카드 3장은 그대로
 *    남는다(01b AC-1 · BR-U3-11 · 기존 `stale-failed` 배너와 같은 성격).
 *  - 안 켜면 안 뜬다(AC-1 의 짝) — "항상 안내"인 구현을 죽인다.
 *  - 배너에 **개수 표기가 아예 없다**(AC-4) — `poolSize` 가 없을 때 0 으로 채우면 사용자는
 *    "후보가 0건"이라는 **다른 사건**을 읽는다(openapi 원문이 직접 경고하는 함정).
 *  - `placementReason` 이 실려 와도 화면이 조용하다(01b D1 — 이번 사이클이 **일부러 뺀**
 *    표면이 구현 중 슬그머니 되살아나는 것을 막는 잠금).
 *
 * ⚠️ **왜 `DraftScreen.test.tsx` 가 아니라 새 파일인가**: 그 파일은 TRIP-297 게이트①로 동결된
 * 심판이고, 그 안의 C2(비고정 카드 서브트리에 `HH:mm` 0건) · C7(화면 전체 렌더 텍스트에
 * 소요시간 표기 0건)이 **이번 표면의 경계선**이다. 배너를 카드 안에 넣거나 문구에 `30분`을
 * 쓰면 새 테스트가 아니라 그 동결 심판이 먼저 red 가 된다(02a ★1). 같은 파일을 열어 섞으면
 * "안 깼다"를 바이트 동일성으로 보일 수 없다.
 *
 * 3동작 뼈대: 준비=`view`·`demoted` 를 만들어 렌더 → 실행=(없음, 표시 계약이다) → 단언=보이는 것·없는 것.
 */

// 지도는 이 칸의 심판 대상이 아니다 — 실물 `KakaoMapView` 가 뜨지 않게만 막는다(동결 화면
// 테스트와 같은 목킹 규약: 인라인 팩토리는 NativeWind babel 호이스트 규칙에 걸린다).
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

/** 카드 루트만 세는 셀렉터. 번호·라벨·배지·사진이 같은 접두를 공유하므로 제외한다
 * (동결 `DraftScreen.test.tsx` 가 세운 규약과 같은 형태 — `devPreviewDraft.test.tsx` 도 같다). */
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

function listed(days: ItineraryDaysItem[] = DAYS): DraftView {
  return { kind: 'listed', days, staleFailed: false };
}

type Overrides = { view?: DraftView; demoted?: boolean };

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
      onRetry={jest.fn()}
      onBack={jest.fn()}
      {...over}
    />
  );
}

describe('S0 · 자가검사 — 이게 통과해야 아래 "숫자 0건"·"문구 0건"이 의미를 갖는다', () => {
  it('숫자 탐지기는 쪼개 그려도 잡고, 부정 단언에는 정규식을 써야 한다', () => {
    render(
      <View>
        <View testID="probe-split">
          <Text>후보 </Text>
          <Text>0</Text>
          <Text>곳</Text>
        </View>
        <View testID="probe-clean">
          <Text>일부 추천이 빠졌어요</Text>
        </View>
      </View>
    );

    // ① ★ 조합 검증 — `toHaveTextContent` 는 자손 텍스트를 **구분자 없이 이어 붙여** 비교한다
    //    (02a §5-B 소스·실행 확인). 이 사실이 없으면 아래 S3 는 "한 Text 안에 통으로 적지만
    //    마라"는 약한 심판이 된다.
    expect(screen.getByTestId('probe-split')).toHaveTextContent(/\d/);
    expect(screen.getByTestId('probe-clean')).not.toHaveTextContent(/\d/);

    // ② ★ 함정 — **문자열 인자는 완전 일치다**(02a §5-A: 기본 `exact=true`). 그래서 넓은
    //    서브트리에 문자열로 부정 단언을 걸면 **있는데도 "없다"로 통과한다.** 아래 첫 줄이
    //    바로 그 가짜 통과이고, 둘째 줄(정규식)이 실제로 잡는다 — S4 가 정규식을 쓰는 이유다.
    expect(screen.getByTestId('probe-clean')).not.toHaveTextContent(
      '일부 추천'
    );
    expect(screen.getByTestId('probe-clean')).toHaveTextContent(/일부 추천/);
  });
});

describe('🔴 S1 · AC-1 — 강등 안내가 뜨고 얼굴을 갈아 끼우지 않는다 (BR-U3-11 · 01b D5 4행)', () => {
  it('배너 한 줄이 뜨고 카드 3장이 그대로 남는다', () => {
    renderScreen({ demoted: true });

    // ① 안내가 삼켜지지 않았다(INV-4). **문구는 잠그지 않는다** — 01b §5 가 "정확한 문구
    //    미정"으로 열어 둔 자리라 존재와 "비어 있지 않음"만 잰다(동결 C12 의 stale-failed
    //    배너와 같은 처리). 빈 배너를 그리는 구현은 둘째 줄에서 죽는다.
    const banner = screen.getByTestId(BANNER);
    expect(banner).toBeOnTheScreen();
    expect(banner).toHaveTextContent(/\S/);

    // ② 목록이 그대로다 — 안내는 곁에 붙는 한 줄이지 얼굴이 아니다.
    expect(cardTestIds()).toHaveLength(3);
    expect(screen.getByTestId(cardId('poi-a'))).toHaveTextContent(/성산일출봉/);

    // ③ 다른 얼굴로 **갈아 끼우지** 않았다. 이 계열 화면에서 반복 재발한 사고의 축이다.
    [
      'itinerary-draft-loading',
      'itinerary-draft-failed',
      'itinerary-draft-empty',
      'itinerary-draft-zero',
    ].forEach((testID) => {
      expect(screen.queryAllByTestId(testID)).toEqual([]);
    });
  });
});

describe('S2 · AC-1 짝 · AC-3 화면 축 — 안 켜면 안 뜬다', () => {
  it('demoted 를 안 넘기면 배너가 0건이고 목록은 평소대로다', () => {
    // 요약이 안 온 평상시(01b D4)의 화면이 이것이다. 이 짝이 없으면 "항상 배너"인 구현이
    // S1 을 그대로 통과한다 — 그리고 실기에서는 서버가 요약을 안 주므로(TRIP-306 미착수)
    // **이 경로가 당분간의 정상 경로**다.
    renderScreen();

    expect(screen.queryAllByTestId(BANNER)).toEqual([]);
    expect(cardTestIds()).toHaveLength(3);
  });
});

describe('🔴 S3 · AC-4 — 개수 표기가 아예 없다 (poolSize 를 0 으로 채우지 않는다)', () => {
  it('배너 서브트리에 숫자가 한 글자도 없다', () => {
    renderScreen({ demoted: true });

    /**
     * ⚠️ 모집단을 **배너로 잘랐다.** 화면 전체로 재면 `6월 10일 · 수` · `1일차` · `3곳` 이
     * 걸려 **어떤 올바른 구현도 통과할 수 없는 심판**이 된다(02a ★4 — 동결 C2 가 시각 부재
     * 단언의 사정거리를 카드 서브트리로 자른 것과 같은 이유).
     *
     * 왜 이 심판이 필요한가: openapi 원문이 `poolSize` 에 대해 *"AI 가 주지 않으면 없다
     * (0 으로 채우지 않는다 — 0 은 '후보 0건'이라는 판정이다)"* 라고 직접 경고한다. `?? 0` 한
     * 글자가 "모른다"를 "0건"으로 바꿔 사용자에게 **다른 사건**을 말하게 된다.
     */
    expect(screen.getByTestId(BANNER)).not.toHaveTextContent(/\d/);
  });
});

describe('S4 · 01b D1 — h11 슬롯 카드에 배치 이유가 되살아나지 않는다', () => {
  it('placementReason 이 실려 와도 화면 어디에도 그 문장이 없다', () => {
    /**
     * 01b D1(사용자 결정)로 표면 1은 이번 범위 밖이다 — **렌더도 배선도 넣지 않는다.** 근거:
     * Figma h11 슬롯 카드에 자유 문장 줄이 없고(밴드 h 42프레임 전수), 완전AI 계열(h10·h11·
     * h12)이 일관되게 후보별 이유를 안 붙이며, 서버가 값을 줄 보장도 없다(TRIP-306 미착수).
     *
     * 계약에는 필드가 실재하므로(`placementReason?: string | null`) **값이 와도 화면이 조용해야**
     * 결정이 지켜진 것이다. 판정 방식으로 소스 스캔이 아니라 렌더 트리를 고른 근거는 02a ★10.
     */
    renderScreen({
      view: listed([
        {
          date: DAY1,
          slots: [
            slot({
              poiId: 'poi-a',
              nameKo: '성산일출봉',
              tags: ['바다'],
              placementReason: '바다 전망을 좋아하셔서 골랐어요',
            }),
          ],
        },
      ]),
    });

    // 짝 먼저 — 같은 슬롯의 다른 표면은 정상적으로 보인다. 없으면 "아무것도 안 그리는 화면"이
    // 아래 부정 단언을 공짜로 통과한다.
    expect(screen.getByTestId(cardId('poi-a'))).toHaveTextContent(/성산일출봉/);

    // 부정 ① 화면 **전체** 텍스트에 그 문장이 없다. ⚠️ 반드시 **정규식**이다 — 문자열 인자는
    //   완전 일치라 넓은 서브트리에서는 언제나 "없음"으로 통과한다(S0 ②가 그 함정을 못 박는다).
    expect(screen.root).not.toHaveTextContent(/바다 전망을 좋아하셔서/);
    // 부정 ② 이유 표면 testID 계열도 0건이다(값이 비어 요소만 남은 경우까지 잡는다).
    expect(screen.queryAllByTestId(/^itinerary-draft-slot-reason/)).toEqual([]);
  });
});
