import { act, fireEvent, screen } from '@testing-library/react-native';

import type { Trip } from '@/shared/api/index.schemas';
import { coverSourceForKey } from '@/entities/trip';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { openPressGuardWindow, resetPressGuard } from '@/shared/lib/pressGuard';
import { renderWithQueryClient } from '@/test-support/queryRender';
import {
  NO_ITINERARY,
  type ItineraryCols,
} from '@/test-support/tripItineraryCols';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-788 · TRIP-1677 — `TripCardContainer` 의 VM 조립(상태문·배지·resume·삭제 진입점·누름 목적지)을 심판한다.
 *
 * TRIP-1677 로 카드는 여행마다 일정을 따로 묻지 않는다. 일정 상태 네 칸(`itineraryStatus`·`itineraryGenerationState`·
 * `itineraryGenerationMode`·`itineraryGenerating`)이 `GET /trips` 목록의 `Trip` 에 실려 오고, 컨테이너는 그 칸만 읽는다.
 * 그래서 이 파일은 일정 조회 훅 목을 걷고 `trip` 에 네 칸을 실어 렌더한다.
 *
 * 무엇을 보장하나:
 *  - 🔴 얼굴 표: 네 칸 조합 → 상태문·배지·resume. 「일정 없음」(null 행)과 값 있는 행을 둘 다 둬서, 전부 null 로 읽어도
 *    우연히 통과하는 것(조용한 "일정 없음" 회귀)을 막는다. `generating=true` + `COMPLETE`(재생성 1차)는 옛 완료 얼굴 그대로.
 *  - 🔴 일정 조회를 걸지 않는다(`useGetTripsTripIdItinerary`·`…QueryOptions` 목 호출 0 — 훅 목 파일이라 요청 수 대신 호출 수로 본다).
 *  - 누름 목적지(copick 이 아닌 것): 일정 GET 없이 즉시 push 1회. `copick` 갈래(누를 때 일정 1회 조회·연타·실패 안내)는 실 `fetchQuery`
 *    가 필요해 `MyTripsListPage.integration.test.tsx` L3 가 맡는다.
 *  - 여행 중 배지 / ⋯ 삭제 진입점 / 연타 관통 / 커버 도시는 종전 규칙 그대로.
 *
 * 삭제한 것(사유): 일정이 "아직 안 옴"(pending)·"404 아닌 조회 실패"(500)일 때의 배지 없는 degrade 얼굴과 ⋯ 숨김 행 — 일정 상태가
 * 목록에 실려 한꺼번에 오므로 여행별 모름이 사라지고, 모름은 목록 자체의 로딩/오류 얼굴(`MyTripsListPage`)로 접혔다.
 *
 * 컨테이너가 `useQueryClient()` 를 쓸 수 있어(copick 누름의 `fetchQuery`) Provider 아래에서 그린다. testID 는 `my-trip-{part}-{tripId}`.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdItinerary: jest.fn(),
  getGetTripsTripIdItineraryQueryOptions: jest.fn(),
}));

beforeEach(() => {
  (useGetTripsTripIdItinerary as jest.Mock).mockReset();
  (getGetTripsTripIdItineraryQueryOptions as jest.Mock).mockReset();
  mockPush.mockClear();
});
// 연타 가드 창은 모듈 싱글턴 — 앞 테스트가 연 창이 다음 테스트의 카드 누름을 먹지 않게 닫는다(TRIP-1282).
afterEach(() => resetPressGuard());

/** 일정 상태 네 칸 한 벌. */
function cols(
  generationState: ItineraryCols['itineraryGenerationState'],
  status: ItineraryCols['itineraryStatus'],
  generationMode: ItineraryCols['itineraryGenerationMode'] = 'FULLY_AI',
  generating = false
): ItineraryCols {
  return {
    itineraryStatus: status,
    itineraryGenerationState: generationState,
    itineraryGenerationMode: generationMode,
    itineraryGenerating: generating,
  };
}

/** 여행 한 벌 — tripId 고정(카드 leaf testID 접미). 기본은 일정 없음. */
function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 't1',
    title: '제주 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...NO_ITINERARY,
    ...over,
  };
}

function renderCard(ui: Parameters<typeof renderWithQueryClient>[0]) {
  return renderWithQueryClient(ui);
}

/** 실시계 오늘을 항상 포함하는 여행 기간(fake timers 없이 "여행 중"을 만든다). */
const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' } as const;

describe('🔴 얼굴 표 — 목록 네 칸 → 상태문 · 배지 · resume (AC-2)', () => {
  it.each<[string, ItineraryCols, string, string, boolean]>([
    // [이름, 네 칸, 상태문, 배지, resume 있음]
    [
      '일정 없음(null) — 404 와 같은 뜻',
      NO_ITINERARY,
      '아직 일정이 없어요',
      '작성중',
      false,
    ],
    [
      '생성 중 PARTIAL + 완전 AI',
      cols('PARTIAL', 'PLANNED', 'FULLY_AI', true),
      'AI가 일정을 짜는 중',
      '작성중',
      false,
    ],
    [
      '생성 중 PARTIAL + 같이 짜기',
      cols('PARTIAL', 'PLANNED', 'CO_PLAN', true),
      '같이 짜는 중',
      '작성중',
      false,
    ],
    [
      '생성 중 PARTIAL + 직접 짜기',
      cols('PARTIAL', 'PLANNED', 'MANUAL', true),
      '직접 짜는 중',
      '작성중',
      false,
    ],
    [
      '세션 없는 PARTIAL(멈춘 생성)도 생성 중 얼굴',
      cols('PARTIAL', 'PLANNED', 'FULLY_AI', false),
      'AI가 일정을 짜는 중',
      '작성중',
      false,
    ],
    [
      '완료 초안 COMPLETE + PLANNED',
      cols('COMPLETE', 'PLANNED'),
      '추천안 준비 중',
      '작성중',
      true,
    ],
    [
      '실패 FAILED + PLANNED — 별도 실패 얼굴 없이 초안으로 접힌다',
      cols('FAILED', 'PLANNED'),
      '추천안 준비 중',
      '작성중',
      true,
    ],
    [
      '직접 짜기 빈 초안(COMPLETE + PLANNED + MANUAL)',
      cols('COMPLETE', 'PLANNED', 'MANUAL'),
      '직접 짜는 중',
      '작성중',
      true,
    ],
    [
      '재생성 1차(generating=true 인데 state 는 옛 COMPLETE) — 옛 완료 얼굴 그대로',
      cols('COMPLETE', 'PLANNED', 'FULLY_AI', true),
      '추천안 준비 중',
      '작성중',
      true,
    ],
    [
      '확정 CONFIRMED + COMPLETE',
      cols('COMPLETE', 'CONFIRMED'),
      '일정 확정',
      '확정',
      false,
    ],
  ])('%s', (_label, itineraryCols, statusLine, badge, resume) => {
    // 준비 — 네 칸을 실은 여행 하나.
    const t = trip(itineraryCols);

    // 실행
    renderCard(<TripCardContainer trip={t} />);

    // 단언 — 상태문·배지는 완전 일치(toHaveTextContent(문자열) = 전체 일치), resume 은 있음/없음.
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      statusLine
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent(badge);
    if (resume) {
      expect(screen.getByTestId('my-trip-resume-t1')).toHaveTextContent(
        '일정 이어서 짜기'
      );
    } else {
      expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
    }
    // 일정 조회 훅은 한 번도 안 불렸다(AC-1).
    expect(useGetTripsTripIdItinerary).not.toHaveBeenCalled();
    expect(getGetTripsTripIdItineraryQueryOptions).not.toHaveBeenCalled();
  });

  it('끝난 여행(Trip.status ENDED)도 카드 얼굴은 일정 상태만 본다 — 확정 일정이면 "확정"·"일정 확정"', () => {
    renderCard(
      <TripCardContainer
        trip={trip({ status: 'ENDED', ...cols('COMPLETE', 'CONFIRMED') })}
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('확정');
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '일정 확정'
    );
  });

  it('"추천안이 준비됐어요"(구 문구)는 없다 · 생성 방식이 직접/같이면 "AI가…" 문구도 없다', () => {
    renderCard(
      <TripCardContainer trip={trip(cols('COMPLETE', 'PLANNED', 'MANUAL'))} />
    );

    expect(screen.queryByText('추천안이 준비됐어요')).toBeNull();
    expect(screen.queryByText('추천안 준비 중')).toBeNull();
    expect(screen.queryByText(/^AI가/)).toBeNull();
  });
});

describe('🔴 카드 누름 목적지 — copick 이 아니면 일정 조회 없이 즉시 1회 (AC-3)', () => {
  it.each<[string, Partial<Trip>, string]>([
    ['일정 없음(null)', {}, '/trips/t1/itinerary/method'],
    [
      '생성 중 + 완전 AI → 관찰 모드(mode 꼬리 없음)',
      cols('PARTIAL', 'PLANNED', 'FULLY_AI', true),
      '/trips/t1/itinerary/generating',
    ],
    [
      '생성 중 + 직접 짜기 → 생성 중 화면',
      cols('PARTIAL', 'PLANNED', 'MANUAL', true),
      '/trips/t1/itinerary/generating',
    ],
    [
      '실패 FAILED → 초안',
      cols('FAILED', 'PLANNED'),
      '/trips/t1/itinerary/draft',
    ],
    [
      '오늘이 여행 기간 안이어도 미확정 초안이면 draft — live 아님(986 D3)',
      { ...DURING, ...cols('COMPLETE', 'PLANNED') },
      '/trips/t1/itinerary/draft',
    ],
    [
      '같은 기간 확정 일정 → live',
      { ...DURING, ...cols('COMPLETE', 'CONFIRMED') },
      '/trips/t1/live',
    ],
    [
      '같이 짜기 완성(COMPLETE + CO_PLAN + 미확정) → 완성 확인(copick/complete) — 일정 조회 없음',
      cols('COMPLETE', 'PLANNED', 'CO_PLAN'),
      '/trips/t1/itinerary/copick/complete',
    ],
  ])('%s', (_label, over, href) => {
    // 준비·실행
    renderCard(<TripCardContainer trip={trip(over)} />);
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    // 단언 — 완전 일치 한 번. 일정 조회 훅은 불리지 않았다.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(href);
    expect(useGetTripsTripIdItinerary).not.toHaveBeenCalled();
  });
});

describe('여행 중 배지 — 오늘이 기간 안인가 (TRIP-1121)', () => {
  /**
   * 컨테이너가 페이지에서 받은 `today` 로 "여행 중" 배지를 낸다. 컨테이너는 시계를 읽지 않는다.
   *  - K1 확정 + 기간 안 → '여행 중' · 상태문 '일정 확정' · resume 없음 · ⋯ 는 있다(TRIP-1786 — 열면 삭제 없이 설정·고정만).
   *  - K2 같은 기간 초안 → '작성중' · ⋯ 있음(US-TRIP-10).
   *  - K3 확정이어도 기간 밖이면 '확정'.
   *  - K4 today 를 안 주면 기간 안 확정이어도 '확정'.
   */
  const TODAY = '2026-09-29';
  const IN = { startDate: '2026-09-28', endDate: '2026-10-01' } as const;
  const base = (over: Partial<Trip> = {}) =>
    trip({ title: '부산 여행', ...IN, status: 'ACTIVE', ...over });

  it('K1 확정 + 오늘이 기간 안 → 배지 "여행 중" · 상태문 "일정 확정" · resume 없음 · ⋯ 는 있고 삭제 항목은 없다 (TRIP-1786 이 뒤집음)', () => {
    renderCard(
      <TripCardContainer
        trip={base(cols('COMPLETE', 'CONFIRMED'))}
        today={TODAY}
        onPressDelete={jest.fn()}
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('여행 중');
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '일정 확정'
    );
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
    // 앵커 → 실행 → 단언: 닫혀 있을 땐 항목이 없고, ⋯ 를 누르면 설정이 뜨되 삭제는 끝까지 없다.
    expect(screen.queryByTestId('my-trip-menu-settings-t1')).toBeNull();
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    expect(screen.getByTestId('my-trip-menu-settings-t1')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();
  });

  it('K2 같은 기간 PLANNED 초안 → 배지 "작성중" · ⋯ 있음 · resume 있음', () => {
    renderCard(
      <TripCardContainer
        trip={base(cols('COMPLETE', 'PLANNED'))}
        today={TODAY}
        onPressDelete={jest.fn()}
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-menu-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-resume-t1')).toBeOnTheScreen();
  });

  it.each([
    ['끝난 뒤', '2026-10-05'],
    ['시작 전', '2026-09-20'],
  ])('K3 확정이어도 오늘이 %s(%s) → 배지 "확정"', (_label, today) => {
    renderCard(
      <TripCardContainer
        trip={base(cols('COMPLETE', 'CONFIRMED'))}
        today={today}
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('확정');
  });

  it('K4 today 가 없으면 항상 참인 기간(2020~2099) 확정 여행이어도 "확정" — 컨테이너가 시계를 읽지 않는다', () => {
    renderCard(
      <TripCardContainer
        trip={trip({ ...DURING, ...cols('COMPLETE', 'CONFIRMED') })}
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('확정');
  });
});

describe('⋯ 삭제 진입점 (TRIP-1055 · TRIP-1271 · TRIP-1441)', () => {
  /**
   * 삭제 가능 = 카드 배지가 '작성중'(draft)이다(날짜가 지나 ACTIVE/ENDED 여도, 생성 중·세션 있음도 포함 — 1271 결정 1=A).
   * 확정이어도 서울 오늘 < 시작일('upcoming')이면 연다(1441). 여행 첫날·여행 중·끝난 뒤, 그리고 today 를 못 받은 컨테이너는 닫힌 쪽.
   * 메뉴 열림은 컨테이너가 쥔다 — ⋯ 로 토글, '삭제' 항목은 닫고 `onPressDelete` 를 올린다.
   */
  it.each<[string, Partial<Trip>]>([
    ['일정 없음(null)', {}],
    ['초안(COMPLETE + PLANNED)', cols('COMPLETE', 'PLANNED')],
    ['초안(FAILED + PLANNED)', cols('FAILED', 'PLANNED')],
    [
      '생성을 취소해 남은 부분 결과(PARTIAL · 세션 없음)',
      cols('PARTIAL', 'PLANNED', 'FULLY_AI', false),
    ],
    [
      '생성 중(PARTIAL · 진행 중 세션 있음)',
      cols('PARTIAL', 'PLANNED', 'FULLY_AI', true),
    ],
    [
      '재생성 직후(COMPLETE + PLANNED · 세션 있음)',
      cols('COMPLETE', 'PLANNED', 'FULLY_AI', true),
    ],
    [
      '재생성 직후(FAILED + PLANNED · 세션 있음)',
      cols('FAILED', 'PLANNED', 'FULLY_AI', true),
    ],
    [
      '날짜가 되어 ACTIVE 인 미확정 초안',
      { status: 'ACTIVE', ...cols('COMPLETE', 'PLANNED') },
    ],
    [
      '날짜가 지나 ENDED 인 미확정 초안',
      { status: 'ENDED', ...cols('COMPLETE', 'PLANNED') },
    ],
  ])('🔴 삭제 가능: %s → ⋯ 가 있다', (_label, over) => {
    renderCard(
      <TripCardContainer trip={trip(over)} onPressDelete={jest.fn()} />
    );

    expect(screen.getByTestId('my-trip-menu-t1')).toBeOnTheScreen();
  });

  it('확정 + 서울 오늘 < 시작일이면 ⋯ 가 있고, 메뉴의 "삭제"가 삭제 요청을 1번 올린다', () => {
    // 준비 — 확정 일정(기간 06-10~06-13), 오늘은 시작 하루 전.
    const onPressDelete = jest.fn();
    renderCard(
      <TripCardContainer
        trip={trip(cols('COMPLETE', 'CONFIRMED'))}
        today="2026-06-09"
        onPressDelete={onPressDelete}
      />
    );
    // 앵커 — 얼굴은 확정 그대로. 배지를 '작성중'으로 바꿔 여는 우회가 아니다.
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('확정');

    // 실행 — ⋯ → '삭제'.
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    fireEvent.press(screen.getByTestId('my-trip-menu-delete-t1'));

    // 단언 — 삭제 요청 1번, 화면 이동은 없다.
    expect(onPressDelete).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<Trip>, string | undefined]>([
    [
      '확정 · 오늘 == 시작일(여행 첫날, 경계)',
      cols('COMPLETE', 'CONFIRMED'),
      '2026-06-10',
    ],
    [
      '확정 · 오늘이 기간 안(ACTIVE)',
      { status: 'ACTIVE', ...cols('COMPLETE', 'CONFIRMED') },
      '2026-06-11',
    ],
    [
      '확정 · 오늘 == 종료일(마지막 날, 경계)',
      { status: 'ACTIVE', ...cols('COMPLETE', 'CONFIRMED') },
      '2026-06-13',
    ],
    [
      '확정 · 오늘 > 종료일(ENDED)',
      { status: 'ENDED', ...cols('COMPLETE', 'CONFIRMED') },
      '2026-06-14',
    ],
    [
      '확정 · today 를 못 받음 — 먼 미래 여행이어도 닫힌 쪽',
      {
        startDate: '2099-06-10',
        endDate: '2099-06-13',
        ...cols('COMPLETE', 'CONFIRMED'),
      },
      undefined,
    ],
  ])(
    '삭제 불가: %s → ⋯ 는 있고 열어도 「삭제」·구분선이 없다 (TRIP-1786 이 뒤집음)',
    (_label, over, today) => {
      renderCard(
        <TripCardContainer
          trip={trip(over)}
          today={today}
          onPressDelete={jest.fn()}
          onTogglePin={jest.fn()}
        />
      );

      expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
      expect(screen.getByTestId('my-trip-menu-settings-t1')).toBeOnTheScreen();
      expect(screen.getByTestId('my-trip-menu-pin-t1')).toBeOnTheScreen();
      expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();
      expect(screen.queryByTestId('my-trip-menu-divider-t1')).toBeNull();
    }
  );

  it('삭제 콜백을 안 주면 삭제 가능한 카드여도 ⋯ 는 있고 「삭제」만 없다 (TRIP-1786 이 뒤집음)', () => {
    renderCard(<TripCardContainer trip={trip()} onTogglePin={jest.fn()} />);

    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    expect(screen.getByTestId('my-trip-menu-settings-t1')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();
  });

  it('⋯ → 열림 → ⋯ → 닫힘 → ⋯ → 삭제 항목 → 콜백 1번·메뉴 닫힘, 화면 이동 0번', () => {
    // 준비 — 삭제 가능한 카드(일정 없음).
    const onPressDelete = jest.fn();
    renderCard(
      <TripCardContainer trip={trip()} onPressDelete={onPressDelete} />
    );
    expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();

    // 실행 ① — 열림.
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    expect(screen.getByTestId('my-trip-menu-delete-t1')).toBeOnTheScreen();
    expect(onPressDelete).not.toHaveBeenCalled();

    // 실행 ② — 토글로 닫힘.
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();

    // 실행 ③ — 다시 열고 '삭제'.
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    fireEvent.press(screen.getByTestId('my-trip-menu-delete-t1'));

    // 단언
    expect(onPressDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// TRIP-1282 ④ — 마이 "예정" 연타의 둘째 탭이 이 카드에 떨어져 라이브로 갔다(QA A-02). 트리거 반쪽(숫자 칸이 창을
// 연다)은 MyPage.test.tsx 에 있다 — 두 화면을 잇는 것은 모듈 전역 창 하나뿐이다.
// resume CTA 는 카드와 같은 함수로 폴백한다(TripCard `onResume ?? onPress`) — 둘 다 막혀야 한다.
describe('연타 관통 표적 — 창 안의 카드·resume 누름은 무시된다', () => {
  const FROZEN_NOW = 1_790_000_000_000;
  let clock: jest.SpyInstance;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  it.each([
    [
      '카드 본문(여행 중 확정)',
      'my-trip-card-t1',
      { ...DURING, ...cols('COMPLETE', 'CONFIRMED') },
      '/trips/t1/live',
    ],
    [
      '"일정 이어서 짜기"(초안)',
      'my-trip-resume-t1',
      cols('COMPLETE', 'PLANNED'),
      '/trips/t1/itinerary/draft',
    ],
  ] as const)(
    '%s — 창이 열려 있으면 눌러도 이동하지 않고, 창이 닫힌 뒤 한 번 누르면 그 목적지로 정확히 1회 간다',
    (_, testID, over, href) => {
      renderCard(<TripCardContainer trip={trip(over)} />);
      // 준비 — 마이 숫자 칸이 방금 눌렸다(창이 열려 있다).
      openPressGuardWindow();

      fireEvent.press(screen.getByTestId(testID));

      expect(mockPush).not.toHaveBeenCalled();

      // 무회귀 — 창이 닫힌 뒤의 한 번.
      resetPressGuard();
      fireEvent.press(screen.getByTestId(testID));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe(href);
    }
  );
});

// TRIP-1208 · 컨테이너가 커버 도시를 VM 에 싣는다 — 첫 목적지(seq 최소) region. 그라데이션·톤 색(생김새)은 실화면 QA 몫.
describe('컨테이너 → 커버 도시', () => {
  it('첫 목적지(seq 최소) 도시 이름이 커버에 뜬다', () => {
    renderCard(
      <TripCardContainer
        trip={trip({
          ...cols('COMPLETE', 'CONFIRMED'),
          destinations: [
            { seq: 2, region: '서귀포', nights: 1 },
            { seq: 1, region: '제주', nights: 2 },
          ],
        })}
      />
    );
    expect(screen.getByTestId('my-trip-city-t1')).toHaveTextContent('제주');
  });

  it('목적지가 비면 도시 글자가 없다', () => {
    renderCard(
      <TripCardContainer
        trip={trip({ ...cols('COMPLETE', 'CONFIRMED'), destinations: [] })}
      />
    );
    expect(screen.queryByTestId('my-trip-city-t1')).toBeNull();
  });
});

// TRIP-1785 · 지난 카드의 「기록 보기 ›」 — 링크 유무는 세그가 아니라 컨테이너의 `phase === 'ended'` 판정이 정한다(01c).
describe('🔴 TRIP-1785 · 「기록 보기 ›」 — 끝난 확정 여행에만, 기록 요약으로 (AC-4)', () => {
  const ENDED = { startDate: '2026-06-10', endDate: '2026-06-13' } as const;
  const TODAY = '2026-11-05';
  const LINK = 'my-trip-records-link-t1';
  const ended = (over: Partial<Trip> = {}) =>
    trip({ ...ENDED, ...cols('COMPLETE', 'CONFIRMED'), ...over });

  it('끝난 확정 여행: 링크가 뜨고 상태문 자리를 대신한다', () => {
    renderCard(<TripCardContainer trip={ended()} today={TODAY} />);

    expect(screen.getByTestId(LINK)).toHaveTextContent(/^기록 보기/);
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
  });

  it.each<[string, Partial<Trip>, string | undefined]>([
    ['시작 전 확정', cols('COMPLETE', 'CONFIRMED'), '2026-06-01'],
    [
      '여행 중 확정',
      { startDate: '2026-06-10', endDate: '2026-06-13' },
      '2026-06-11',
    ],
    [
      '날짜가 지난 작성중(확정 전) — 예정에 남는다',
      cols('COMPLETE', 'PLANNED'),
      TODAY,
    ],
    ['일정 없음', NO_ITINERARY, TODAY],
    [
      'today 를 안 주면(컨테이너는 시계를 안 읽는다)',
      cols('COMPLETE', 'CONFIRMED'),
      undefined,
    ],
  ])('%s 이면 링크가 없다 (상태문은 그대로)', (_label, over, today) => {
    renderCard(
      <TripCardContainer
        trip={trip({ ...ENDED, ...cols('COMPLETE', 'CONFIRMED'), ...over })}
        today={today}
      />
    );

    expect(screen.queryByTestId(LINK)).toBeNull();
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-extra-t1')).toBeOnTheScreen();
  });

  it('링크를 누르면 기록 요약으로 정확히 1번 — 카드 본문 이동(허브)은 불리지 않는다', () => {
    renderCard(<TripCardContainer trip={ended()} today={TODAY} />);

    fireEvent.press(screen.getByTestId(LINK));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/t1/records/summary');
    expect(useGetTripsTripIdItinerary).not.toHaveBeenCalled();
  });

  it('링크를 연타해도 이동은 1번 (guardPress)', () => {
    renderCard(<TripCardContainer trip={ended()} today={TODAY} />);

    fireEvent.press(screen.getByTestId(LINK));
    fireEvent.press(screen.getByTestId(LINK));
    fireEvent.press(screen.getByTestId(LINK));

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('카드 본문 탭의 목적지는 현행 그대로 — 끝난 확정 여행도 /live (D9)', () => {
    renderCard(<TripCardContainer trip={ended()} today={TODAY} />);

    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/t1/live');
  });
});

// TRIP-1786 · ⋯ 메뉴 — 「여행 설정」 · 「맨 위에 고정」 · 구분선 · 「삭제」. 새 props: `onTogglePin` · `pinned` · `pinDisabled`(고정 상태·저장은 페이지가 쥔다).
describe('🔴 TRIP-1786 · ⋯ 메뉴 항목 — 노출 조건 · 설정 이동 · 고정 토글 · 닫힘', () => {
  const TODAY = '2026-11-05';
  const SOON = { startDate: '2026-12-01', endDate: '2026-12-03' } as const;
  const ENDED = { startDate: '2026-06-10', endDate: '2026-06-13' } as const;
  const confirmed = (over: Partial<Trip> = {}) =>
    trip({ ...cols('COMPLETE', 'CONFIRMED'), ...over });
  const open = (): void => {
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
  };
  const item = (part: string) => screen.getByTestId(`my-trip-menu-${part}-t1`);
  const has = (part: string): boolean =>
    screen.queryByTestId(`my-trip-menu-${part}-t1`) !== null;

  it.each<[string, Partial<Trip>]>([
    ['확정 · 시작 전', confirmed(SOON)],
    ['작성중(일정 없음)', {}],
  ])(
    '삭제 가능한 카드(%s): 설정 · 고정 · 구분선 · 삭제 네 가지가 뜬다',
    (_l, over) => {
      renderCard(
        <TripCardContainer
          trip={trip(over)}
          today={TODAY}
          onPressDelete={jest.fn()}
          onTogglePin={jest.fn()}
        />
      );

      open();

      expect(
        screen
          .getAllByTestId(/^my-trip-menu-(settings|pin|divider|delete)-t1$/)
          .map((el) => el.props.testID)
      ).toEqual([
        'my-trip-menu-settings-t1',
        'my-trip-menu-pin-t1',
        'my-trip-menu-divider-t1',
        'my-trip-menu-delete-t1',
      ]);
      expect(item('settings')).toHaveTextContent('여행 설정');
      expect(item('pin')).toHaveTextContent('맨 위에 고정');
      expect(item('delete')).toHaveTextContent('삭제');
    }
  );

  it.each<[string, Partial<Trip>]>([
    ['여행 중', confirmed({ startDate: '2026-11-04', endDate: '2026-11-07' })],
    ['지난(끝난 확정)', confirmed(ENDED)],
  ])('%s 카드: ⋯ 가 있고 설정 · 고정만 — 삭제와 구분선은 없다', (_l, over) => {
    renderCard(
      <TripCardContainer
        trip={trip(over)}
        today={TODAY}
        onPressDelete={jest.fn()}
        onTogglePin={jest.fn()}
      />
    );

    open();

    expect(has('settings')).toBe(true);
    expect(has('pin')).toBe(true);
    expect(has('delete')).toBe(false);
    expect(has('divider')).toBe(false);
  });

  it('「여행 설정」: 메뉴가 닫히고 /trips/t1/settings 로 정확히 1번 — 카드 본문 이동(/live 등)은 없다', () => {
    const onPressDelete = jest.fn();
    const onTogglePin = jest.fn();
    renderCard(
      <TripCardContainer
        trip={confirmed(SOON)}
        today={TODAY}
        onPressDelete={onPressDelete}
        onTogglePin={onTogglePin}
      />
    );
    open();

    fireEvent.press(item('settings'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/t1/settings');
    expect(has('settings')).toBe(false);
    expect(onPressDelete).not.toHaveBeenCalled();
    expect(onTogglePin).not.toHaveBeenCalled();
  });

  it('「여행 설정」을 연타해도 이동은 1번 (guardPress) — 닫힌 메뉴의 같은 항목을 다시 눌러도', () => {
    renderCard(<TripCardContainer trip={confirmed(SOON)} today={TODAY} />);
    open();
    const settings = item('settings');

    // 같은 프레임 연타: act 하나 안에서 누르면 메뉴가 닫히기(리렌더) 전에 세 번 다 핸들러에 닿는다
    // — 리렌더 사이에 누르면 닫힌 항목이라 가드 없이도 1번이 돼 심판이 헛돈다(03b 경고-1).
    act(() => {
      fireEvent.press(settings);
      fireEvent.press(settings);
      fireEvent.press(settings);
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it.each<[string, boolean, string]>([
    ['고정 안 한 카드: 「맨 위에 고정」', false, '맨 위에 고정'],
    ['고정한 카드: 「고정 해제」', true, '고정 해제'],
  ])(
    '%s — 누르면 토글 콜백 1번 · 메뉴 닫힘 · 이동 0번',
    (_l, pinned, label) => {
      const onTogglePin = jest.fn();
      renderCard(
        <TripCardContainer
          trip={confirmed(SOON)}
          today={TODAY}
          pinned={pinned}
          onTogglePin={onTogglePin}
        />
      );
      open();
      expect(item('pin')).toHaveTextContent(label);

      fireEvent.press(item('pin'));

      expect(onTogglePin).toHaveBeenCalledTimes(1);
      expect(has('pin')).toBe(false);
      expect(mockPush).not.toHaveBeenCalled();
    }
  );

  // 통합 QA D1(11-06) — 고정하면 메뉴가 닫히고 목록 순서가 바뀐다. 연타의 둘째 탭은 그 자리에 온 카드 본문에 떨어져
  // 다른 여행이 열렸다. 고정 누름이 연타 창(guardPress 와 같은 400ms)을 열어야 한다.
  it('「맨 위에 고정」 직후 같은 자리 카드 본문 탭은 창 안이라 이동 0번 — 창이 닫힌 뒤 한 번은 간다 (D1)', () => {
    const onTogglePin = jest.fn();
    renderCard(
      <TripCardContainer
        trip={confirmed(SOON)}
        today={TODAY}
        onTogglePin={onTogglePin}
      />
    );
    open();

    // 실행 — 첫 탭은 고정(메뉴가 닫힌다), 둘째 탭은 그 자리의 카드 본문.
    fireEvent.press(item('pin'));
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();

    // 무회귀 — 창이 닫힌 뒤의 한 번은 그대로 이동.
    resetPressGuard();
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('pinDisabled(저장값을 아직 못 읽음): 고정 항목은 막힘 표시 · 눌러도 토글 0번 · 메뉴는 열려 있고 설정은 눌린다', () => {
    const onTogglePin = jest.fn();
    renderCard(
      <TripCardContainer
        trip={confirmed(SOON)}
        today={TODAY}
        pinDisabled
        onTogglePin={onTogglePin}
      />
    );
    open();

    expect(item('pin')).toBeDisabled();
    fireEvent.press(item('pin'));

    expect(onTogglePin).not.toHaveBeenCalled();
    expect(has('pin')).toBe(true);
    expect(item('settings')).not.toBeDisabled();
  });

  it.each<[string, Partial<Trip>]>([
    ['예정', confirmed(SOON)],
    ['여행 중', confirmed({ startDate: '2026-11-04', endDate: '2026-11-07' })],
  ])(
    'pinned 이면 %s 카드에도 「고정」 표식이 뜨고, 아니면 없다',
    (_l, over) => {
      const view = renderCard(
        <TripCardContainer trip={trip(over)} today={TODAY} pinned />
      );
      expect(screen.getByTestId('my-trip-pinned-t1')).toHaveTextContent('고정');
      view.unmount();

      renderCard(<TripCardContainer trip={trip(over)} today={TODAY} />);
      expect(screen.queryByTestId('my-trip-pinned-t1')).toBeNull();
    }
  );
});

/**
 * TRIP-1788 · 커버 소비처 ① — 내 여행 목록 카드가 사용자가 고른 `coverKey` 그림을 쓴다.
 * 고른 키(서울 종로구)와 첫 목적지(부산 해운대구)를 **다른 지역**으로 둬서, 첫 목적지 그림이 나오면 red 가 되게 한다.
 * 그림 비교는 `coverSourceForKey` 값으로(jest 의 번들 이미지는 `require` 한 파일 기준 경로라 직접 `require` 하면 어긋난다).
 */
describe('TRIP-1788 · 카드 커버 = 고른 그림', () => {
  const FIRST = [
    { seq: 1, region: '해운대구', nights: 2, regionCode: '26350' },
  ];
  const cover = () => screen.getByTestId('my-trip-cover-t1').props.source;

  it('coverKey 가 있으면 첫 목적지가 달라도 그 그림이다', () => {
    renderCard(
      <TripCardContainer
        trip={trip({ coverKey: '11110', destinations: FIRST })}
      />
    );

    expect(coverSourceForKey('11110')).not.toBe(coverSourceForKey('26350'));
    expect(cover()).toEqual([coverSourceForKey('11110')]);
  });

  it.each<[string, Partial<Trip>]>([
    ['null(자동)', { coverKey: null }],
    ['칸 없음(옛 서버)', {}],
    ['앱이 모르는 키', { coverKey: 'zz9' }],
  ])('coverKey 가 %s 면 첫 목적지 그림 — 지금까지와 같다', (_label, over) => {
    renderCard(
      <TripCardContainer trip={trip({ destinations: FIRST, ...over })} />
    );

    expect(cover()).toEqual([coverSourceForKey('26350')]);
  });
});
