import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  HOME_DEFAULT_PROPS,
  HOME_EMPTY_PROPS,
  HOME_LOADING_PROPS,
  HOME_NO_TRIP_PROPS,
} from '../model/homeFixtures';
import { HomeScreen } from './HomeScreen';

/**
 * AC-1~AC-6(홈 4상태) · Q1 · Q3 · INV-3 — 홈 대시보드 프레젠테이션 화면.
 *
 * 무엇을 보장하나: `HomeScreen`은 props(트립/부가 카드/섹션)만 받아 4상태(default·no-trip·
 * empty·loading)를 그리는 순수 화면이다. 픽스처는 프로덕션 상수(`homeFixtures.ts`)를 그대로
 * import해 쓴다 — "Figma 값 → 상수 → 렌더" 파이프라인 전체가 한 번에 검증되도록.
 *
 * 텍스트 중복 함정(02a §6-10): '감천문화마을'은 default에서 다음 일정 요약과 인기 카드에
 * 2회 등장한다 — 각각 `within(...)`으로 스코프를 좁혀 전역 `getByText`의 다중 매칭 throw를
 * 피한다. '여행 만들기'(no-trip 단일 CTA)와 '새 여행 만들기'(빠른 액션)는 완전 일치라서
 * `getByText`가 서로 겹치지 않는다.
 *
 * 정정 이력(게이트①-2, 02d): `toHaveTextContent(문자열)`은 완전 일치라 정규식 6건으로 정정,
 * Figma 재확증(empty hero 오버레이 존재·더보기 3곳)에 따라 A-1a 스코프·A-1c 개수·A-3 계약 반전.
 */

describe('HomeScreen — 여행 있음: 크롬 + hero (AC-1)', () => {
  it('워드마크·벨과 hero 카드의 오버레이 3값·메타·진행률·CTA가 렌더된다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    expect(screen.getByText('TripPilot')).toBeOnTheScreen();
    expect(screen.getByTestId('home-dashboard-bell')).toBeOnTheScreen();

    // '2박 3일'은 커뮤니티 카드 메타칩(Figma 원문)에도 있어 전역 조회가 다중 매치로
    // throw한다 — within으로 hero 서브트리만 본다(게이트①-2). D-12·'부산 여행'은
    // 완전 일치 노드가 화면에 유일해 전역 유지.
    const hero = screen.getByTestId('home-dashboard-hero');
    expect(hero).toBeOnTheScreen();
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
    expect(screen.getByText('D-12')).toBeOnTheScreen();
    expect(within(hero).getByText('2박 3일')).toBeOnTheScreen();
    expect(screen.getByText('6.10~6.12 · 숙소 1곳 · 3명')).toBeOnTheScreen();

    expect(
      screen.getByTestId('home-dashboard-hero-progress')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('home-dashboard-hero-cta')).toHaveTextContent(
      '일정 보기'
    );
  });
});

describe('HomeScreen — 여행 있음: 여행 부가 카드 (AC-1)', () => {
  it('다음 일정·이어서 하기·취향 블록이 각자의 내용으로 렌더된다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 다음 일정 카드 — '감천문화마을' 1회차(요약 문구 안). within으로 스코프해
    // 인기 카드 쪽 2회차와 전역 매칭이 충돌하지 않게 한다.
    const nextPlan = screen.getByTestId('home-dashboard-next-plan');
    expect(within(nextPlan).getByText('6.11 (수)')).toBeOnTheScreen();
    expect(
      within(nextPlan).getByText('09:00 · 감천문화마을 · 도보 850m')
    ).toBeOnTheScreen();
    expect(within(nextPlan).getByText('여행 준비')).toBeOnTheScreen();

    // 이어서 하기 — 컨테이너에 정규식 toHaveTextContent로 부분 포함 확인. 문자열 인자는
    // 완전 일치라 한 컨테이너에 서로 다른 두 문구를 동시에 걸 수 없다(게이트①-2 정정).
    const resume = screen.getByTestId('home-dashboard-resume');
    expect(resume).toHaveTextContent(/짜던 일정 이어서 편집/);
    expect(resume).toHaveTextContent(/부산 여행 · 2일차 · 3분 전/);

    // 취향 블록 — 칩 3개 + featured 장소명.
    expect(screen.getByTestId('home-dashboard-taste')).toBeOnTheScreen();
    expect(screen.getByText('바다')).toBeOnTheScreen();
    expect(screen.getByText('미식')).toBeOnTheScreen();
    expect(screen.getByText('느긋')).toBeOnTheScreen();
    expect(screen.getByText('해동용궁사')).toBeOnTheScreen();
  });
});

describe('HomeScreen — 여행 있음: 섹션 + 빠른 액션 (AC-1)', () => {
  it('인기 장소 3장·새 여행 만들기·커뮤니티 카드·더보기 3군데가 렌더된다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 인기 카드 0번의 이름은 within으로 스코프한다 — '감천문화마을' 2회차(전역이면 throw).
    const card0 = screen.getByTestId('home-dashboard-popular-card-0');
    expect(within(card0).getByText('감천문화마을')).toBeOnTheScreen();
    expect(
      screen.getByTestId('home-dashboard-popular-card-1')
    ).toBeOnTheScreen();
    expect(screen.getByText('광안리 해변')).toBeOnTheScreen();
    expect(screen.getByText('급상승')).toBeOnTheScreen();
    expect(
      screen.getByTestId('home-dashboard-popular-card-2')
    ).toBeOnTheScreen();
    expect(screen.getByText('전포 카페거리')).toBeOnTheScreen();

    expect(screen.getByTestId('home-dashboard-new-trip')).toHaveTextContent(
      '새 여행 만들기'
    );

    // 커뮤니티 카드 — A-1b resume과 같은 이유로 정규식 부분 포함(게이트①-2 정정).
    const recordCard = screen.getByTestId('home-dashboard-record-card');
    expect(recordCard).toHaveTextContent(/여행자민/);
    expect(recordCard).toHaveTextContent(/부산 2박 3일 미식 코스/);
    expect(recordCard).toHaveTextContent(/방문 8곳 · 동선 12km/);

    // 더보기 ›는 인기·취향·커뮤니티 헤더 3군데(Figma 1632:1108 재확증 — 게이트①-2).
    expect(screen.getAllByText('더보기 ›')).toHaveLength(3);
  });
});

describe('HomeScreen — 첫 사용자 (AC-2 · Q1)', () => {
  it('대시 빈 카드 + 단일 CTA + 섹션 실데이터는 유지되고, hero·부가 카드·제2 진입 문구는 없다', () => {
    render(<HomeScreen {...HOME_NO_TRIP_PROPS} />);

    // 긍정 — 첫 사용자 안내(Q1: Figma 단일 CTA 채택).
    expect(screen.getByTestId('home-dashboard-empty-hero')).toBeOnTheScreen();
    expect(screen.getByText('아직 만든 여행이 없어요')).toBeOnTheScreen();
    expect(screen.getByText(/가고 싶은 곳을 저장해 두면/)).toBeOnTheScreen();
    expect(screen.getByTestId('home-dashboard-empty-cta')).toHaveTextContent(
      '여행 만들기'
    );

    // 긍정 — 섹션은 no-trip에서도 실데이터 그대로(§0 확정).
    expect(
      screen.getByTestId('home-dashboard-popular-card-0')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('home-dashboard-record-card')).toBeOnTheScreen();

    // 부정 — trip 부가 카드 4종 + Q1이 폐기한 스토리의 제2 진입 문구.
    expect(screen.queryByTestId('home-dashboard-hero')).toBeNull();
    expect(screen.queryByTestId('home-dashboard-next-plan')).toBeNull();
    expect(screen.queryByTestId('home-dashboard-resume')).toBeNull();
    expect(screen.queryByTestId('home-dashboard-taste')).toBeNull();
    expect(screen.queryByText('예약 없이 AI로 먼저 일정 받아보기')).toBeNull();
  });
});

describe('HomeScreen — 취향 부족 (AC-3)', () => {
  it('hero(오버레이 포함)는 유지되고 취향유도·빈 커뮤니티·헤더로 섹션이 채워지며 실카드·더보기는 없다', () => {
    render(<HomeScreen {...HOME_EMPTY_PROPS} />);

    // 긍정 — hero는 오버레이(D-12·부산 여행·2박 3일)까지 그대로 유지된다. Figma empty
    // 프레임(1258:1120) 재확증으로 게이트①-1의 "오버레이 없음" 전제(G-2)가 파기됐다
    // (게이트①-2 · 03 §6-2).
    const hero = screen.getByTestId('home-dashboard-hero');
    expect(hero).toBeOnTheScreen();
    expect(within(hero).getByText('D-12')).toBeOnTheScreen();
    expect(within(hero).getByText('부산 여행')).toBeOnTheScreen();
    expect(within(hero).getByText('2박 3일')).toBeOnTheScreen();
    expect(screen.getByText('일정 보기')).toBeOnTheScreen();

    // 긍정 — 인기 자리는 취향 설정 유도 카드로 채워진다(침묵 실패 아님).
    expect(screen.getByTestId('home-dashboard-taste-setup')).toHaveTextContent(
      /온보딩 취향을 설정하면/
    );
    expect(
      screen.getByTestId('home-dashboard-taste-setup-cta')
    ).toHaveTextContent('취향 설정');

    // 긍정 — 커뮤니티 자리는 빈 문구 2줄로 채워진다.
    const recordsEmpty = screen.getByTestId('home-dashboard-records-empty');
    expect(recordsEmpty).toHaveTextContent(/아직 공유된 여행 기록이 없어요/);
    expect(recordsEmpty).toHaveTextContent(/관심 장소를 저장하면/);

    // 긍정 — 섹션 헤더 2개는 그대로 유지된다.
    expect(screen.getByText('지금 인기 있는 장소')).toBeOnTheScreen();
    expect(screen.getByText('지금 뜨는 · 내 취향 여행 기록')).toBeOnTheScreen();

    // 부정 — 실카드·더보기 없음.
    expect(screen.queryByTestId('home-dashboard-popular-card-0')).toBeNull();
    expect(screen.queryByTestId('home-dashboard-record-card')).toBeNull();
    expect(screen.queryAllByText('더보기 ›')).toHaveLength(0);
  });
});

describe('HomeScreen — 로딩 (AC-4)', () => {
  it('스켈레톤 2종 + 가용 카드(hero·새 여행 만들기)는 정상, 실카드·취향유도·빈 문구는 없다', () => {
    render(<HomeScreen {...HOME_LOADING_PROPS} />);

    // 긍정 — 스켈레톤은 텍스트가 없어 testID가 유일한 관찰 수단이다.
    expect(
      screen.getByTestId('home-dashboard-skeleton-popular')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('home-dashboard-skeleton-record')
    ).toBeOnTheScreen();
    // 긍정 — 이미 가용한 카드는 로딩 중에도 침묵하지 않고 정상 표시(가용 카드 우선).
    expect(screen.getByTestId('home-dashboard-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('home-dashboard-new-trip')).toBeOnTheScreen();

    // 부정 — 실카드·취향유도·빈 문구는 로딩 중엔 없다.
    expect(screen.queryByTestId('home-dashboard-popular-card-0')).toBeNull();
    expect(screen.queryByTestId('home-dashboard-record-card')).toBeNull();
    expect(screen.queryByTestId('home-dashboard-taste-setup')).toBeNull();
    expect(screen.queryByTestId('home-dashboard-records-empty')).toBeNull();
  });
});

describe('HomeScreen — INV-3 거리표기 (AC-5)', () => {
  it('다음 일정 카드 안에는 거리(도보 850m)만 있고 분·시간 표기는 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // within으로 다음 일정 카드 서브트리만 본다 — 화면 전체를 훑으면 이어서하기 카드의
    // 정당한 '3분 전'(상대시각, Figma 고정 카피)에 오탐되기 때문이다(02a §6-6).
    const nextPlan = screen.getByTestId('home-dashboard-next-plan');
    expect(within(nextPlan).getByText(/도보 850m/)).toBeOnTheScreen();
    expect(within(nextPlan).queryByText(/분|시간/)).toBeNull();
  });
});

describe('HomeScreen — CTA no-op, default (Q3)', () => {
  it('hero CTA·새 여행 만들기·벨·인기 더보기를 눌러도 예외 없이 루트가 유지된다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 홈은 expo-router를 모르므로 이동 자체가 구조적으로 불가능하다 — press가 던지면
    // 이 시점에 테스트가 실패한다(no-op 증명 = 예외 없이 통과).
    fireEvent.press(screen.getByTestId('home-dashboard-hero-cta'));
    fireEvent.press(screen.getByTestId('home-dashboard-new-trip'));
    fireEvent.press(screen.getByTestId('home-dashboard-bell'));
    fireEvent.press(screen.getByTestId('home-dashboard-popular-more'));

    expect(screen.getByTestId('home-dashboard-root')).toBeOnTheScreen();
  });
});

describe('HomeScreen — CTA no-op, empty (Q3)', () => {
  it('취향 설정을 눌러도 예외 없이 루트가 유지된다', () => {
    render(<HomeScreen {...HOME_EMPTY_PROPS} />);

    fireEvent.press(screen.getByTestId('home-dashboard-taste-setup-cta'));

    expect(screen.getByTestId('home-dashboard-root')).toBeOnTheScreen();
  });
});
