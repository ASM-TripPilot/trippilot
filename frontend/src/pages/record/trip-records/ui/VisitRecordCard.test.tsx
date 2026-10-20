import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { View } from 'react-native';

import { PlusGlyph } from '@/features/record';
import { VisitRecordCard } from './VisitRecordCard';

/**
 * TRIP-565 · AC-1(UI 반)·AC-3 — 방문 기록 카드(순수 프레젠테이션, VM 주입).
 *
 * 카드는 status 를 prop 으로 받지 않는다 — 세 timestamp 를 `deriveVisitStatus` 로 내부 파생한다(INV-U5-01).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1(UI) active(도착·미완료) 카드 → 완료 체크서클이 활성이고, 누르면 onPressComplete(id) 가 1회.
 *  - 🔴 AC-3(BR-U5-05) upcoming(3 timestamp null) 카드 → 완료 컨트롤 비활성 + 완료 발화 0회.
 *  - 🔴 ★fill 함정 — 상태별로 **서로 다른 testID** 의 체크서클을 렌더(fill 색 의존 금지, repo-traps 글리프).
 *  - skip [건너뛰기](TRIP-1069 — 동작 버튼) press → onPressSkip(id). 건너뛴 카드엔 [건너뜀] 상태 라벨.
 *
 * 왜 이렇게 테스트하나(02a §4-★1·★2):
 *  - **체크서클 fill 은 jest 사각** — 완료↔미완료를 fill 색만 바꾸면 심판이 전부 green 인 채 거짓말이 통과한다.
 *    → 상태별 distinct testID(done/active/upcoming/skipped)로 렌더해 present/absent 짝으로 구조를 잠근다.
 *  - **fireEvent.press 는 disabled 를 안 막는다**(pointerEvents 만 막음, 02a §5-B 실측) → "upcoming press → 완료 0회"를
 *    disabled 에 기대지 않고 **완료 발화 Pressable 을 IN_PROGRESS 에만 렌더**하는 구조로 성립시킨다.
 *
 * (개념) `getByTestId('문자열')`=testID 완전일치 · `queryByTestId(...)`=없으면 null(부재 단언) ·
 *   `toBeDisabled()`=accessibilityState.disabled 판독(02a §5-C) · `not.toHaveBeenCalled()`=콜백 미발화.
 */

type Card = React.ComponentProps<typeof VisitRecordCard>['card'];

const baseCard = (
  over: Partial<Card> & Pick<Card, 'visitCheckId' | 'poiId'>
): Card => ({
  nameKo: '광안리',
  slotKey: null,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  arrivedLabel: null,
  ...over,
});

const T = '2026-08-31T14:20:00';

describe('🔴 AC-1(UI) · active 카드 완료 발화', () => {
  it('IN_PROGRESS → 완료 체크서클 활성 + press 시 onPressComplete(id) 1회', () => {
    const onPressComplete = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
        onPressComplete={onPressComplete}
      />
    );

    const control = screen.getByTestId('record-visit-check-active-v1');
    expect(control).not.toBeDisabled();

    fireEvent.press(control);

    expect(onPressComplete).toHaveBeenCalledTimes(1);
    expect(onPressComplete).toHaveBeenCalledWith('v1');
  });
});

describe('🔴 AC-3 · BR-U5-05 — 도착 없는 슬롯은 완료 불가', () => {
  it('UPCOMING → 완료 컨트롤 비활성 + 발화 Pressable 부재 + 완료 0회', () => {
    const onPressComplete = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v3', poiId: 'p3' })}
        onPressComplete={onPressComplete}
      />
    );

    const upcoming = screen.getByTestId('record-visit-check-upcoming-v3');
    // 상태 표식은 비활성(accessibilityState.disabled).
    expect(upcoming).toBeDisabled();
    // 완료를 발화하는 active Pressable 은 아예 없다(구조로 0회를 보장).
    expect(screen.queryByTestId('record-visit-check-active-v3')).toBeNull();

    fireEvent.press(upcoming);
    expect(onPressComplete).not.toHaveBeenCalled();
  });
});

describe('🔴 ★fill 함정 — 상태별 distinct testID', () => {
  const cases: Array<{
    status: string;
    card: Card;
    present: string;
    absent: string;
  }> = [
    {
      status: 'COMPLETED',
      card: baseCard({
        visitCheckId: 'c1',
        poiId: 'p1',
        arrivedAt: T,
        completedAt: T,
      }),
      present: 'record-visit-check-done-c1',
      absent: 'record-visit-check-upcoming-c1',
    },
    {
      status: 'IN_PROGRESS',
      card: baseCard({ visitCheckId: 'c1', poiId: 'p1', arrivedAt: T }),
      present: 'record-visit-check-active-c1',
      absent: 'record-visit-check-done-c1',
    },
    {
      status: 'UPCOMING',
      card: baseCard({ visitCheckId: 'c1', poiId: 'p1' }),
      present: 'record-visit-check-upcoming-c1',
      absent: 'record-visit-check-done-c1',
    },
    {
      status: 'SKIPPED',
      card: baseCard({
        visitCheckId: 'c1',
        poiId: 'p1',
        arrivedAt: T,
        skippedAt: T,
      }),
      present: 'record-visit-check-skipped-c1',
      absent: 'record-visit-check-active-c1',
    },
  ];

  it.each(cases)(
    '$status → $present present · $absent absent (fill 색 아닌 testID 로 구분)',
    ({ card, present, absent }) => {
      render(<VisitRecordCard card={card} />);
      expect(screen.getByTestId(present)).toBeTruthy();
      expect(screen.queryByTestId(absent)).toBeNull();
    }
  );
});

/**
 * TRIP-1069 · AC-16 · AC-14 · D4 — "건너뛰기"(동작)와 "건너뜀"(상태)을 가른다.
 *
 * 옛 카드는 동작 버튼에 상태 낱말 `건너뜀`을 맨 글자로 달아, 눌러야 하는 것인지 이미 그렇다는 것인지
 * 구분이 안 됐다. 동작은 동사 `건너뛰기` + 버튼 역할, 상태는 건너뛴 카드에만 붙는 라벨이다.
 * 누르면 카드는 onPressSkip(id) 만 올린다 — 확인 다이얼로그는 페이지 몫(페이지 통합이 본다).
 * 상태 라벨은 `—` 와 `건너뜀` 두 글자 노드라 `toHaveTextContent`(완전 일치·이어붙임) 대신
 * `within(라벨).getByText('건너뜀')` 으로 본다.
 */
describe('AC-16 · 건너뛰기 = 동작 버튼', () => {
  it('IN_PROGRESS 카드 → 버튼 역할 + "건너뛰기" 글자, press 시 onPressSkip(id) 1회', () => {
    const onPressSkip = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
        onPressSkip={onPressSkip}
      />
    );

    const skip = screen.getByTestId('record-visit-skip-v1');
    expect(skip.props.accessibilityRole).toBe('button');
    expect(skip).toHaveTextContent('건너뛰기');

    fireEvent.press(skip);

    expect(onPressSkip).toHaveBeenCalledTimes(1);
    expect(onPressSkip).toHaveBeenCalledWith('v1');
  });
});

describe('TRIP-1435 Q-115 · 이름 줄과 동작 줄을 나눈다', () => {
  // 카드 루트의 직계 자식 줄들 — 첫 줄이 이름 줄, 둘째 줄이 동작 줄이다(렌더 트리 구조, 생김새 아님).
  const rows = (visitCheckId: string) =>
    screen
      .getByTestId(`record-trip-visit-card-${visitCheckId}`)
      .children.filter((child) => typeof child !== 'string');

  it('이름 줄 안에는 동작 버튼(시각 수정·건너뛰기)·도착 시각이 없고, 그 아래 줄에 있다', () => {
    render(
      <VisitRecordCard
        card={baseCard({
          visitCheckId: 'v1',
          poiId: 'p1',
          nameKo: '해운대해수욕장 즉석 방문',
          arrivedAt: T,
          arrivedLabel: '14:20 도착',
        })}
        onPressSkip={jest.fn()}
        onPressEditTime={jest.fn()}
      />
    );

    const [nameRow, actionRow] = rows('v1');
    expect(
      within(nameRow as never).getByText('해운대해수욕장 즉석 방문')
    ).toBeTruthy();
    for (const id of [
      'record-visit-skip-v1',
      'record-trip-visit-time-edit-v1',
    ]) {
      expect(within(nameRow as never).queryByTestId(id)).toBeNull();
      expect(within(actionRow as never).getByTestId(id)).toBeTruthy();
    }
    expect(within(nameRow as never).queryByText('14:20 도착')).toBeNull();
    expect(within(actionRow as never).getByText('14:20 도착')).toBeTruthy();
  });

  it('동작이 하나도 없는 카드(완료·도착 시각 없음)는 동작 줄 없이 이름 줄 하나뿐이다', () => {
    render(
      <VisitRecordCard
        card={baseCard({
          visitCheckId: 'v2',
          poiId: 'p2',
          arrivedAt: T,
          completedAt: T,
        })}
      />
    );

    expect(rows('v2')).toHaveLength(1);
  });
});

describe('AC-14 · D4 · 건너뜀 = 상태 라벨', () => {
  it('SKIPPED 카드 → 건너뜀 라벨이 있고, 건너뛰기 버튼은 없다', () => {
    render(
      <VisitRecordCard
        card={baseCard({
          visitCheckId: 'c1',
          poiId: 'p1',
          arrivedAt: T,
          skippedAt: T,
        })}
        onPressSkip={jest.fn()}
      />
    );

    const label = screen.getByTestId('record-visit-skipped-label-c1');
    expect(within(label).getByText('건너뜀')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-visit-skip-c1')).toBeNull();
  });

  it('IN_PROGRESS 카드엔 건너뜀 라벨이 없다(짝)', () => {
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
      />
    );

    expect(screen.queryByTestId('record-visit-skipped-label-v1')).toBeNull();
    expect(screen.queryByText('건너뜀')).toBeNull();
  });
});

/**
 * 🔴 TRIP-613 · AC-8 — [시각 수정] 진입(옵셔널 콜백, 무회귀).
 *
 * 카드에 `onPressEditTime?` 를 additive 로 더한다(565 `onPressComplete?`·`onPressSkip?` 동형 후방호환).
 * 위 565 describe 5블록이 **무변경 존치**하는 것이 "기존 계약 무회귀"의 증거다 — 여기선 진입만 잠근다.
 * 진입 testID 는 카드 다중이라 `-{visitCheckId}` 접미(recordsStructure G4식 "소스=접두 / 렌더=접미").
 */
describe('🔴 AC-8 · [시각 수정] 진입', () => {
  it('A8a · onPressEditTime 제공 → 진입 present + press 시 onPressEditTime(id) 1회', () => {
    const onPressEditTime = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
        onPressEditTime={onPressEditTime}
      />
    );

    const edit = screen.getByTestId('record-trip-visit-time-edit-v1');
    // TRIP-1069 AC-4 — 진입은 버튼 역할이다(스크린리더가 누를 수 있는 것으로 읽는다).
    expect(edit.props.accessibilityRole).toBe('button');

    fireEvent.press(edit);

    expect(onPressEditTime).toHaveBeenCalledTimes(1);
    expect(onPressEditTime).toHaveBeenCalledWith('v1');
  });

  it('A8b · onPressEditTime 미제공 → 진입 부재(기존 호출자·프리뷰 무영향)', () => {
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
      />
    );

    expect(screen.queryByTestId('record-trip-visit-time-edit-v1')).toBeNull();
  });

  it('A8c · additive 무간섭 — 진입과 완료 컨트롤이 독립으로 발화(기존 배선 안 깸)', () => {
    const onPressComplete = jest.fn();
    const onPressEditTime = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
        onPressComplete={onPressComplete}
        onPressEditTime={onPressEditTime}
      />
    );

    // 둘 다 존재 — 진입을 더해도 완료 발화 Pressable 이 그대로 있다.
    const edit = screen.getByTestId('record-trip-visit-time-edit-v1');
    const complete = screen.getByTestId('record-visit-check-active-v1');

    fireEvent.press(edit);
    expect(onPressEditTime).toHaveBeenCalledTimes(1);
    expect(onPressComplete).not.toHaveBeenCalled();

    fireEvent.press(complete);
    expect(onPressComplete).toHaveBeenCalledTimes(1);
  });
});

/**
 * 🔴 TRIP-760 · AC-3 — 업로드 실패 카드의 [↻ 다시 시도] 버튼 + 보조 안내(additive prop, 무회귀).
 *
 * 카드에 옵셔널 `uploadRetry?: { onPress }` 를 additive 로 더한다(565 `onPressComplete?`·613
 * `onPressEditTime?` 동형 후방호환). 주입 시에만 카드 하단(메모 슬롯 뒤)에 풀폭 재시도 버튼 +
 * "메모와 방문 체크는 저장되었어요"(사진은 실패했어도 메모·방문 체크는 저장됐다는 INV-4 안내)를 그린다.
 * 위 565/613 describe 가 **무변경 존치**하는 것이 "기존 계약 무회귀"의 증거 — 여기선 재시도만 잠근다.
 *
 * (개념) `getByText('다시 시도')` = 완전일치 텍스트 조회(↻ 는 SVG 글리프라 텍스트 아님, 02a §5-A) ·
 *   `queryByTestId(...)` = 없으면 null(미주입 부재 단언) · `toHaveBeenCalledTimes(1)` = 콜백 1회 발화.
 * 재시도 testID 는 카드 다중이라 `-{visitCheckId}` 접미(recordsStructure G4 "소스=접두 / 렌더=접미").
 */
describe('🔴 TRIP-760 · AC-3 · 업로드 재시도 버튼 + 보조 안내', () => {
  it('A3a · uploadRetry 주입 → 버튼·안내 present + press 시 onPress 1회', () => {
    const onPress = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
        uploadRetry={{ onPress }}
      />
    );

    expect(screen.getByTestId('record-trip-upload-retry-v1')).toBeTruthy();
    expect(screen.getByText('다시 시도')).toBeTruthy();
    expect(screen.getByText('메모와 방문 체크는 저장되었어요')).toBeTruthy();

    fireEvent.press(screen.getByTestId('record-trip-upload-retry-v1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('A3b · uploadRetry 미주입 → 버튼·안내 부재(기존 호출자·프리뷰 무영향, 무회귀 짝)', () => {
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
      />
    );

    expect(screen.queryByTestId('record-trip-upload-retry-v1')).toBeNull();
    expect(screen.queryByText('다시 시도')).toBeNull();
    expect(screen.queryByText('메모와 방문 체크는 저장되었어요')).toBeNull();
  });
});

/**
 * TRIP-566 · AC-6 — j01 카드 사진/메모 슬롯 배선(옵셔널 prop, 후방호환).
 *
 * 무엇을 보장하나:
 *  - 카드가 정적 스캐폴딩(L148-155) 자리에 `photoSlot`/`memoSlot`(ReactNode)를 렌더한다 — 주면 present,
 *    안 주면 부재(후방호환, 565 `onPressComplete?`·613 `onPressEditTime?` 동형).
 *  - 사진 상태가 나빠도(unavailable) 완료 체크서클·메모가 눌리지 않는다(메모·체크 독립, AC-3).
 *
 * ★ 왜 마커 노드인가: 카드의 책임은 "받은 슬롯을 그 자리에 렌더"뿐이다 — 슬롯이 나르는 실제 testID
 *   (record-trip-photo-add=PhotoThumbStrip · record-trip-memo-input=MemoInline)의 소유·거동은 각 컴포넌트
 *   테스트가 잠근다. 카드 테스트는 마커에 그 계약 testID 를 실어 "카드가 슬롯을 surface 하는지"만 본다
 *   (실 컴포넌트 의존 제거 → W2 선제 green 보존).
 *
 * (개념) `queryByTestId(...)`=없으면 null(부재 단언). 카드 VM 은 status 를 세 timestamp 로 내부 파생.
 */

const photoAddMarker = <View testID="record-trip-photo-add" />;
const memoMarker = <View testID="record-trip-memo-input" />;

const wiringCard = {
  visitCheckId: 'v1',
  poiId: 'p1',
  nameKo: '광안리',
  slotKey: null,
  arrivedAt: '2026-08-31T14:20:00',
  completedAt: null,
  skippedAt: null,
  arrivedLabel: '14:20',
};

describe('🔴 AC-6 · W1 — 슬롯 주입 시 사진/메모 자리가 배선된다', () => {
  it('photoSlot·memoSlot 주입 → record-trip-photo-add · record-trip-memo-input present', () => {
    render(
      <VisitRecordCard
        card={wiringCard}
        photoSlot={photoAddMarker}
        memoSlot={memoMarker}
      />
    );

    expect(screen.getByTestId('record-trip-photo-add')).toBeTruthy();
    expect(screen.getByTestId('record-trip-memo-input')).toBeTruthy();
  });
});

describe('AC-6 · W2 — 슬롯 미주입 시 부재(후방호환, 선제 green)', () => {
  it('slot prop 없이 렌더 → 두 자리 모두 부재(565 호출자·프리뷰 무영향)', () => {
    render(<VisitRecordCard card={wiringCard} />);

    expect(screen.queryByTestId('record-trip-photo-add')).toBeNull();
    expect(screen.queryByTestId('record-trip-memo-input')).toBeNull();
  });
});

/**
 * TRIP-1069 · AC-13 · D3 — 슬롯을 안 주면 **아무것도 그리지 않는다**.
 *
 * 옛 카드는 슬롯이 없으면 눌러도 반응 없는 '+' 타일과 '메모를 남겨보세요' 글자를 정적으로 그렸다(INV-4
 * 무반응 버튼). 그 폴백 자체를 지운다. '+' 타일엔 testID 가 없어 `PlusGlyph` 컴포넌트 개수로 센다.
 * `queryByText` 는 Text 노드만 보므로 MemoInline 의 placeholder(TextInput 속성)와 섞이지 않는다.
 */
describe('AC-13 · W4 — 슬롯 미주입이면 정적 +·메모 글자가 없다', () => {
  it.each([
    ['IN_PROGRESS', { arrivedAt: '2026-08-31T05:20:00Z' }],
    ['UPCOMING', { arrivedAt: null }],
  ])('%s 카드 → 메모 안내 글자 0 · + 글리프 0', (_status, over) => {
    render(<VisitRecordCard card={{ ...wiringCard, ...over }} />);

    // 앵커 — 카드는 그려졌다.
    expect(screen.getByText('광안리')).toBeOnTheScreen();
    expect(screen.queryByText('메모를 남겨보세요')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(PlusGlyph)).toHaveLength(0);
  });
});

describe('🔴 AC-6 · W3 — 사진 상태가 나빠도 체크·메모는 독립으로 산다', () => {
  it('unavailable 사진 슬롯 + 메모 슬롯 + active 카드 → 완료 체크서클·메모가 동시 present', () => {
    render(
      <VisitRecordCard
        card={wiringCard}
        photoSlot={<View testID="record-photo-unavailable-ph1" />}
        memoSlot={memoMarker}
      />
    );

    // 완료 발화 체크서클(IN_PROGRESS)은 사진 상태와 무관하게 존재한다.
    expect(screen.getByTestId('record-visit-check-active-v1')).toBeTruthy();
    // 메모·사진 슬롯도 함께 산다(사진이 unavailable 이어도 눌리지 않음).
    expect(screen.getByTestId('record-trip-memo-input')).toBeTruthy();
    expect(screen.getByTestId('record-photo-unavailable-ph1')).toBeTruthy();
  });
});

/**
 * 🔴 TRIP-761 · AC-4·AC-5·AC-6 — j01 manual-checkin 카드의 "방문 체크" 코랄 pill.
 *
 * 위치 권한이 없을 때(수동 체크인 모드) 미방문(UPCOMING) 카드에 "방문 체크" pill 이 붙어, press 하면
 * 도착을 **수동으로** 생성한다(`arrive({source:'MANUAL'})`). complete(완료)가 아니라 arrive(도착 생성)다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-4  `manualCheckin` && UPCOMING → pill(`record-visit-manual-check-{id}`) + "방문 체크" 텍스트가 뜬다.
 *            manualCheckin false 거나 UPCOMING 이 아니면 부재(무회귀 짝).
 *  - 🔴 AC-5  pill press → `onPressManualCheck(poiId)` 정확히 1회(seed §3-a).
 *  - 🔴 AC-6  ★manual 모드도 complete 아님 — pill press 는 `onPressComplete` 를 0회로 두고, UPCOMING 완료 발화
 *            Pressable(`record-visit-check-active-*`)은 여전히 부재다(완료 게이트 구조 유지).
 *
 * ★fill 함정(02a §4-★7): "방문 체크" pill 을 완료 마커(coral 채운 원)로 착각해 색만 바꾸면 심판이 green 인
 *   채 "도착했다는 거짓말"이 통과한다 → present/absent 짝 testID + complete 0회 로만 판정(색 의존 금지, repo 관례).
 *
 * (개념) `getByTestId('문자열')`=완전일치 · `queryByTestId(...)`=없으면 null(부재) · `getByText(문자열)`=단일
 *   Text leaf 완전일치 · `toHaveBeenCalledWith(값)`=콜백 인자 일치 · `not.toHaveBeenCalled()`=미발화.
 */

const PILL_TEXT = '방문 체크';

const manualUpcoming = baseCard({ visitCheckId: 'v3', poiId: 'p3' });

describe('🔴 TRIP-761 · AC-4 · "방문 체크" pill 존재', () => {
  it('B4a · manualCheckin true + UPCOMING → pill + "방문 체크" 텍스트가 뜬다', () => {
    render(
      <VisitRecordCard
        card={manualUpcoming}
        manualCheckin
        onPressManualCheck={jest.fn()}
      />
    );

    expect(screen.getByTestId('record-visit-manual-check-v3')).toBeTruthy();
    expect(screen.getByText(PILL_TEXT)).toBeTruthy();
  });
});

describe('🔴 TRIP-761 · AC-4 · pill 부재 행렬(무회귀 짝)', () => {
  // manualCheckin && UPCOMING 만 present — false 거나 UPCOMING 이 아니면 전부 absent.
  const cases: Array<{ name: string; card: Card; manualCheckin?: boolean }> = [
    {
      name: 'manualCheckin false + UPCOMING',
      card: manualUpcoming,
      manualCheckin: false,
    },
    {
      name: 'manualCheckin true + COMPLETED',
      card: baseCard({
        visitCheckId: 'v3',
        poiId: 'p3',
        arrivedAt: T,
        completedAt: T,
      }),
      manualCheckin: true,
    },
    {
      name: 'manualCheckin true + IN_PROGRESS',
      card: baseCard({ visitCheckId: 'v3', poiId: 'p3', arrivedAt: T }),
      manualCheckin: true,
    },
    {
      name: 'manualCheckin true + SKIPPED',
      card: baseCard({
        visitCheckId: 'v3',
        poiId: 'p3',
        arrivedAt: T,
        skippedAt: T,
      }),
      manualCheckin: true,
    },
    {
      name: 'manualCheckin 미주입 + UPCOMING',
      card: manualUpcoming,
      manualCheckin: undefined,
    },
  ];

  it.each(cases)('$name → pill 부재', ({ card, manualCheckin }) => {
    render(
      <VisitRecordCard
        card={card}
        manualCheckin={manualCheckin}
        onPressManualCheck={jest.fn()}
      />
    );

    expect(screen.queryByTestId('record-visit-manual-check-v3')).toBeNull();
  });
});

describe('🔴 TRIP-761 · AC-5 · 카드 레벨 arrive 발화', () => {
  it('B5 · pill press → onPressManualCheck(poiId) 정확히 1회', () => {
    const onPressManualCheck = jest.fn();
    render(
      <VisitRecordCard
        card={manualUpcoming}
        manualCheckin
        onPressManualCheck={onPressManualCheck}
      />
    );

    fireEvent.press(screen.getByTestId('record-visit-manual-check-v3'));

    expect(onPressManualCheck).toHaveBeenCalledTimes(1);
    // seed §3-a: onPressManualCheck(poiId). 페이지가 이 poiId 로 arrive({source:'MANUAL', poiId}) 를 쏜다.
    expect(onPressManualCheck).toHaveBeenCalledWith('p3');
  });
});

describe('🔴 TRIP-761 · AC-6 · ★manual 모드도 complete 아님(무회귀)', () => {
  it('B6 · manual-check press → onPressManualCheck 1회 / onPressComplete 0회 + 완료 발화 Pressable 여전히 부재', () => {
    const onPressManualCheck = jest.fn();
    const onPressComplete = jest.fn();
    render(
      <VisitRecordCard
        card={manualUpcoming}
        manualCheckin
        onPressManualCheck={onPressManualCheck}
        onPressComplete={onPressComplete}
      />
    );

    // UPCOMING 완료 게이트는 구조로 유지 — 도착 없는 슬롯엔 완료 발화 Pressable 이 없고, 상태 표식만 비활성.
    expect(screen.queryByTestId('record-visit-check-active-v3')).toBeNull();
    expect(screen.getByTestId('record-visit-check-upcoming-v3')).toBeTruthy();

    fireEvent.press(screen.getByTestId('record-visit-manual-check-v3'));

    // manual-check 는 arrive 로만 흐른다 — complete 는 절대 안 쏜다(두 콜백은 다른 물건).
    expect(onPressManualCheck).toHaveBeenCalledTimes(1);
    expect(onPressComplete).not.toHaveBeenCalled();
  });
});

describe('TRIP-1372 · 몇 번째 방문인지', () => {
  it('order 가 오면 "N번째 방문" 을 그리고, 없으면 그리지 않는다', () => {
    const { rerender } = render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', order: 2 })}
      />
    );
    expect(screen.getByText('2번째 방문')).toBeOnTheScreen();

    rerender(
      <VisitRecordCard card={baseCard({ visitCheckId: 'v1', poiId: 'p1' })} />
    );
    expect(screen.queryByText(/번째 방문/)).toBeNull();
  });
});
