import { Pressable, Text, View } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { DraftPin } from '@/features/itinerary/model/draftView';

import { GenerationFallbackScreen } from './GenerationFallbackScreen';

/**
 * h07 [완전AI] 일정 생성 · fallback — Figma `3831:2177` 전용 인터스티셜 화면의 렌더 계약.
 *
 * 무엇을 보장하나 — 화면은 완성된 값(`failed`·`mustVisitCount`·`pins`·콜백)만 받는다(props-only):
 *  - 🔴 성공(폴백) 변형: 앱바·진행표시·메시지 카피·체크리스트 4행·N·CTA 2개(AC-1~6). 메시지 본문은
 *    원인을 특정하지 않고 알림 약속 안내바는 없다(TRIP-1008 A1~A3 — 옛 AC-2 본문·AC-5 안내바 플립).
 *  - 🔴 실패(하드) 변형: 체크리스트 대신 실패 히어로 + CTA 갈림(AC-7). 성공/실패 상호배타(AC-8).
 *  - (TRIP-1150) 옛 AC-9 "소요시간 표기 0건" 렌더 스캔은 지웠다 — 이 화면엔 시간·거리 재료가 없다
 *    (README 판정 4 INV-3 하위 규칙). S0 의 소요시간 탐지기 자가검사도 짝이라 함께 걷었다.
 *  - 초록 체크·회색 대시 마커의 **색은 심판하지 않는다**(글리프 raw-hex 사각 · 02a ★4) — 마커
 *    testID 존재·개수·회색 행 텍스트까지만. 색 회귀는 6-b 프리뷰 육안 전용.
 *
 * 3동작 뼈대: 준비=props 로 렌더 → 실행=(CTA 만 press) → 단언=보이는 것·없는 것·불린 콜백.
 */

// 지도는 이 칸의 심판 대상이 아니다 — 실물 `MapView`(네이버 네이티브)가 뜨지 않게만 막는다.
// 인라인 팩토리는 NativeWind babel 호이스트 규칙에 걸리므로 모듈을 require 한다(리포 선례와 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/** 좌표 있는 핀 2개 — 성공 변형 지도 카드가 뜨는 조건(pins.length>0). */
const PINS: DraftPin[] = [
  { number: 1, lat: 33.4582, lng: 126.9423 },
  { number: 2, lat: 33.4501, lng: 126.9201 },
];

const onViewPlan = jest.fn();
const onManualPlan = jest.fn();
const onRetry = jest.fn();
const onBack = jest.fn();

type Overrides = {
  failed?: boolean;
  mustVisitCount?: number;
  pins?: DraftPin[];
};

function renderScreen(over: Overrides = {}) {
  return render(
    <GenerationFallbackScreen
      mustVisitCount={3}
      pins={PINS}
      onViewPlan={onViewPlan}
      onManualPlan={onManualPlan}
      onRetry={onRetry}
      onBack={onBack}
      {...over}
    />
  );
}

beforeEach(() => {
  onViewPlan.mockClear();
  onManualPlan.mockClear();
  onRetry.mockClear();
  onBack.mockClear();
});

describe('S0 · 자가검사 — 이게 통과해야 아래 카피 단언이 의미를 갖는다', () => {
  it('문자열 인자는 완전일치다', () => {
    render(
      <View>
        <View testID="probe-copy">
          <Text>AI 추천은 </Text>
          <Text>잠시 쉬어요</Text>
        </View>
      </View>
    );

    // ① ★ 완전일치 — `toHaveTextContent` 는 자손 텍스트를 구분자 없이 이어붙여 **전체가 정확히**
    //    같은지 본다(02a §5, node_modules `matches.js` 실측: string→exact `===`). 쪼개 그려도 잡힌다.
    expect(screen.getByTestId('probe-copy')).toHaveTextContent(
      'AI 추천은 잠시 쉬어요'
    );
    // 부분포함으로 오해하면 안 된다 — 짧은 조각은 완전일치가 아니라 통과하지 않는다.
    expect(screen.getByTestId('probe-copy')).not.toHaveTextContent('AI 추천은');
    // 부분포함이 필요하면 정규식이다(matcher.test = substring).
    expect(screen.getByTestId('probe-copy')).toHaveTextContent(/추천은/);
  });
});

describe('🔴 AC-1 · 성공 — 앱바 제목과 진행 표시가 뜬다', () => {
  it('"일정 만들기" 와 "4 / 4" 가 화면에 있다', () => {
    renderScreen();

    expect(screen.getByTestId('itinerary-fallback-root')).toBeOnTheScreen();
    // 완전일치 — 세그 4채움(픽셀)은 심판 안 함(6-b 육안), 카피만 잠근다.
    expect(screen.getByText('일정 만들기')).toBeOnTheScreen();
    expect(screen.getByText('4 / 4')).toBeOnTheScreen();
  });
});

describe('🔴 AC-2 · 성공 — 메시지 카드 카피가 원인을 특정하지 않는다 (TRIP-1008 A1·A2 플립)', () => {
  it('제목은 그대로, 본문은 원인 중립 문구와 완전일치하고 "연결이 불안정" 은 화면 어디에도 없다', () => {
    renderScreen();

    const message = screen.getByTestId('itinerary-fallback-message');
    // A4 무회귀 — 제목은 그대로다.
    expect(
      within(message).getByText('AI 추천은 잠시 쉬어요')
    ).toBeOnTheScreen();
    // A2 긍정 짝 — 본문을 통째로 지우는 구현을 막는다(Seed Q1 · US-SCHED-09 "기본 모드" 결).
    expect(
      within(message).getByText(
        '이번엔 취향 반영 없이 기본 일정을 먼저 만들었어요 · 나중에 다시 짤 수 있어요'
      )
    ).toBeOnTheScreen();
    // A1 금지 — 폴백 원인은 연결 말고도 조립 409·LLM 잘림이 있다. 한 원인을 박으면 나머지에 거짓말이다.
    expect(screen.queryAllByText(/연결이 불안정/).length).toBe(0);
  });
});

describe('🔴 AC-3 · 성공 — 체크리스트 4행이 순서대로, 3행만 대시·회색', () => {
  it('4행 라벨이 뜨고, 마커는 체크 3·대시 1, 3행은 "취향 반영 (건너뜀)" 이다', () => {
    renderScreen({ mustVisitCount: 3 });

    // 4행이 순서대로 존재(마크업 모양은 강요 안 함 — getByText 완전일치).
    expect(screen.getByText('꼭 갈 곳 3곳 배치')).toBeOnTheScreen();
    expect(screen.getByText('동선·거리 계산')).toBeOnTheScreen();
    expect(screen.getByText('취향 반영 (건너뜀)')).toBeOnTheScreen();
    expect(screen.getByText('기본 일정 완성')).toBeOnTheScreen();

    // 4행 컨테이너가 정확히 4개(체크리스트 개수·순서의 앵커).
    expect(
      screen.queryAllByTestId(/^itinerary-fallback-check-\d$/)
    ).toHaveLength(4);

    // ★ 마커 — 초록 체크 3개(1·2·4행) + 회색 대시 1개(3행). **색은 안 본다**(글리프 raw-hex 사각,
    //   02a ★4) — 다른 마커(대시)를 쓴 행이 정확히 3행 하나임을 testID 존재·개수로만 잠근다.
    expect(
      screen.queryAllByTestId(/^itinerary-fallback-mark-check-/)
    ).toHaveLength(3);
    expect(
      screen.getByTestId('itinerary-fallback-mark-dash')
    ).toBeOnTheScreen();
  });
});

describe('🔴 AC-4 · 성공 — N 이 주입값과 일치한다 (하드코딩/placeholder 아님)', () => {
  it.each([0, 3])(
    'mustVisitCount=%i → "꼭 갈 곳 N곳 배치" 의 N 이 그 값이다',
    (count) => {
      renderScreen({ mustVisitCount: count });
      expect(screen.getByText(`꼭 갈 곳 ${count}곳 배치`)).toBeOnTheScreen();
    }
  );

  it('mustVisitCount 미지정이면 그 행을 안 그린다 (0곳 오표기보다 미표기가 정직 · D4)', () => {
    renderScreen({ mustVisitCount: undefined });

    // 긍정 짝 — 나머지 체크리스트 행은 정상으로 뜬다(전부 안 그리는 구현을 죽인다).
    expect(screen.getByText('기본 일정 완성')).toBeOnTheScreen();
    // 부정 — "꼭 갈 곳 …곳 배치" 계열이 화면 어디에도 없다(정규식 부분포함).
    expect(screen.queryAllByText(/꼭 갈 곳/)).toEqual([]);
  });
});

describe('🔴 AC-5 · 성공 — 알림 약속 안내바가 없다 (TRIP-1008 A3 플립 · D6)', () => {
  it('안내바 testID 와 "알림으로 알려" 문구가 0건이다 — 재시도 알림이 실재하지 않는 약속이라서', () => {
    renderScreen();

    // 긍정 앵커 — 화면은 떠 있다(아무것도 안 그리는 구현이 아래 부정을 공짜로 통과하지 못하게).
    expect(screen.getByTestId('itinerary-fallback-root')).toBeOnTheScreen();
    expect(screen.getByText('기본 일정 완성')).toBeOnTheScreen();

    expect(screen.queryAllByTestId('itinerary-fallback-info').length).toBe(0);
    expect(screen.queryAllByText(/알림으로 알려/).length).toBe(0);
  });
});

describe('🔴 AC-6 · 성공 — 하단 CTA 2개가 각 콜백을 한 번씩 부른다', () => {
  it('"기본 일정 보기" press → onViewPlan 1회, "직접 짜기" press → onManualPlan 1회', () => {
    renderScreen();

    const viewPlan = screen.getByTestId('itinerary-fallback-view-plan');
    expect(viewPlan).toHaveTextContent('기본 일정 보기');
    fireEvent.press(viewPlan);
    expect(onViewPlan).toHaveBeenCalledTimes(1);
    // 주 CTA 는 manual 을 부르지 않는다(콜백 교차 배선 검출).
    expect(onManualPlan).not.toHaveBeenCalled();

    const manual = screen.getByTestId('itinerary-fallback-manual');
    expect(manual).toHaveTextContent('직접 짜기');
    fireEvent.press(manual);
    expect(onManualPlan).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 AC-7 · 실패 — 체크리스트 대신 실패 히어로 + CTA 가 갈린다', () => {
  it('failed 면 체크리스트가 없고 "일정을 만들지 못했어요" + 다시 시도/직접 짜기 가 뜬다', () => {
    renderScreen({ failed: true });

    // 실패 문구.
    expect(screen.getByTestId('itinerary-fallback-failed')).toHaveTextContent(
      '일정을 만들지 못했어요'
    );
    // 체크리스트는 없다(성공 표면 부재).
    expect(screen.queryAllByTestId(/^itinerary-fallback-check-\d$/)).toEqual(
      []
    );

    // CTA 갈림 — 다시 시도(onRetry) + 직접 짜기(onManualPlan).
    const retry = screen.getByTestId('itinerary-fallback-retry');
    expect(retry).toHaveTextContent('다시 시도');
    fireEvent.press(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('itinerary-fallback-manual'));
    expect(onManualPlan).toHaveBeenCalledTimes(1);
    // 실패 변형엔 "기본 일정 보기" 주 CTA 가 없다(다시 시도로 교체).
    expect(screen.queryAllByTestId('itinerary-fallback-view-plan')).toEqual([]);
  });
});

describe('🔴 AC-8 · 성공/실패 상호배타', () => {
  it('성공 변형엔 실패 문구가 0건이다', () => {
    renderScreen();
    expect(screen.queryAllByTestId('itinerary-fallback-failed')).toEqual([]);
    // 성공 표면(메시지·체크리스트)은 있다(긍정 짝). 안내바는 TRIP-1008 로 없어져 짝에서 뺐다.
    expect(screen.getByTestId('itinerary-fallback-message')).toBeOnTheScreen();
    expect(
      screen.queryAllByTestId(/^itinerary-fallback-check-\d$/).length
    ).toBe(4);
  });

  it('실패 변형엔 성공 표면(체크리스트·메시지·지도·안내바)이 모두 0건이다 (히어로만 · D5)', () => {
    renderScreen({ failed: true });
    [
      /^itinerary-fallback-check-\d$/,
      'itinerary-fallback-message',
      'itinerary-fallback-map',
      'itinerary-fallback-info',
    ].forEach((sel) =>
      expect(screen.queryAllByTestId(sel as string | RegExp)).toEqual([])
    );
    // 짝 — 실패 히어로는 있다(전부 안 그리는 구현을 죽인다).
    expect(screen.getByTestId('itinerary-fallback-failed')).toBeOnTheScreen();
  });
});

describe('🔴 지도 카드 — 성공(+pins)엔 뜨고 실패엔 없다 (D5 · census 짝)', () => {
  it('성공+pins 면 itinerary-fallback-map 이 뜨고, 실패면 0건이다', () => {
    renderScreen({ pins: PINS });
    expect(screen.getByTestId('itinerary-fallback-map')).toBeOnTheScreen();

    renderScreen({ failed: true });
    expect(screen.queryAllByTestId('itinerary-fallback-map')).toEqual([]);
  });
});
