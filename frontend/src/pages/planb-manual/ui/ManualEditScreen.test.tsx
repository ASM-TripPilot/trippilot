import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import { ManualEditScreen } from './ManualEditScreen';

/**
 * TRIP-443 · i15·i22 수동 편집 화면 — variant→mode 파생 + 공용 셸 소비의 관측 계약을 잠근다.
 *
 * 무엇을 보장하나:
 *  - **F(AC-4 얼굴 동치)**: variant 하나를 뒤집으면 4변형 축(누락 배너·상단 안내줄·지도 문구·시각
 *    직접입력)이 함께 켜/꺼진다. mode 단일 스위치를 뒤집는 심판이라 4변형 동시 회귀를 잡는다.
 *  - **★봉합(F2)**: i15(정상)엔 폴백/누락 배너가 없다 — "testID 부재 + 루트 존재 짝"으로 잠가
 *    오타 testID 공허통과를 막는다(ManualPlanPage.integration I2 선례).
 *  - **L(AC-1 잠금)**: 고정/잠금 슬롯은 휴지통·HH:mm 입력 어포던스가 아예 안 붙는다.
 *  - **V(AC-2 배지)**: `hasViolation` 슬롯에 위반 배지가 뜨고, 데이터가 지우면 사라진다. 두 variant
 *    공통(mode 게이팅 밖) — 얼굴 동치 심판이 이 축을 건드리지 않는다(★2).
 *
 * ★ 바텀시트 함정(02a ★4): [시각 입력] 시트의 실제 열림·HH:mm 반영은 목이 무조건 children 렌더라
 *   jest 원리적 무심판(repo-traps). W1 은 **버튼 존재 + onPress→onEditSlotTime 호출**까지만 잠근다.
 *
 * slotKey 형식 = `${date}#${poiId}`(buildSlotKey 관례) — 테스트가 직접 조립한다(planb 는 features/
 * itinerary 의 buildSlotKey 를 import 못 함).
 */

const DATE = '2026-06-11';
const key = (poiId: string): string => `${DATE}#${poiId}`;

type Slot = ItineraryDaysItemSlotsItem;

function slot(poiId: string, over: Partial<Slot> = {}): Slot {
  return {
    poiId,
    startAt: '13:00:00',
    endAt: '14:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: poiId,
    tags: [],
    ...over,
  };
}

/** 3슬롯: A(비고정) · H(isFixed 호텔 체크인) · C(비고정이나 lockedSlotKeys). */
function baseDays(over: { aViolation?: boolean } = {}): ItineraryDaysItem[] {
  return [
    {
      date: DATE,
      slots: [
        slot('poi-a', { hasViolation: over.aViolation ?? false }),
        slot('poi-hotel', { isFixed: true, startAt: '17:30:00' }),
        slot('poi-c'),
      ],
    },
  ];
}

const LOCKED = [key('poi-c')];

const noop = (): void => {};

describe('🔴 F1 · AC-4 — variant=error(i22) 얼굴: 4변형 fallback 축이 켜진다', () => {
  it('누락 배너·"이동시간 미상"·[시각 입력]이 뜨고 상단 hint 는 없다', () => {
    render(
      <ManualEditScreen
        variant="error"
        days={baseDays()}
        lockedSlotKeys={LOCKED}
        onBack={noop}
        onSave={noop}
      />
    );

    // fallback 축 present
    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-manual-missing-data')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-manual-map-unknown')).toBeOnTheScreen();
    expect(
      screen.getByTestId(`planb-manual-time-input-${key('poi-a')}`)
    ).toBeOnTheScreen();

    // normal 축 absent(배너가 hint 를 대체)
    expect(screen.queryByTestId('planb-manual-hint')).toBeNull();
  });
});

describe('🔴 F2 · AC-4 + ★봉합 — variant 기본(i15) 얼굴: fallback 축이 전부 꺼진다', () => {
  it('루트가 뜨고(짝) hint+이력만, 누락 배너·미상·[시각 입력]은 어느 것도 없다', () => {
    render(
      <ManualEditScreen
        days={baseDays()}
        lockedSlotKeys={LOCKED}
        onBack={noop}
        onSave={noop}
      />
    );

    // ★봉합 — 루트 존재 짝(화면이 실제 렌더됐다)
    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();
    // normal 축 present
    expect(screen.getByTestId('planb-manual-hint')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-manual-history')).toBeOnTheScreen();

    // fallback/누락 축은 어느 것도 안 뜬다(MANUAL 은 실패가 아니라 선택)
    [
      'planb-manual-missing-data',
      'planb-manual-map-unknown',
      `planb-manual-time-input-${key('poi-a')}`,
    ].forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
  });
});

describe('🔴 L1 · AC-1 — 고정/잠금 슬롯은 휴지통·HH:mm 입력이 안 붙는다', () => {
  it('비잠금엔 휴지통+[시각 입력], 잠금(isFixed·lockedSlotKeys)엔 둘 다 없고 잠금 표시만', () => {
    render(
      <ManualEditScreen
        variant="error"
        days={baseDays()}
        lockedSlotKeys={LOCKED}
        onBack={noop}
        onSave={noop}
      />
    );

    // 비잠금 A — 어포던스 present
    expect(
      screen.getByTestId(`planb-manual-delete-${key('poi-a')}`)
    ).toBeOnTheScreen();

    // 잠금 H(isFixed)·C(lockedSlotKeys) — 휴지통·[시각 입력] 부재 + 잠금 표시 present
    [key('poi-hotel'), key('poi-c')].forEach((k) => {
      expect(screen.queryByTestId(`planb-manual-delete-${k}`)).toBeNull();
      expect(screen.queryByTestId(`planb-manual-time-input-${k}`)).toBeNull();
      expect(screen.getByTestId(`planb-manual-locked-${k}`)).toBeOnTheScreen();
    });
  });
});

describe('🔴 V1 · AC-2 — 위반 배지는 두 variant 공통(mode 게이팅 밖)', () => {
  it.each(['error', undefined] as const)(
    'variant=%s 에서도 hasViolation 슬롯에 위반 배지가 뜬다',
    (variant) => {
      render(
        <ManualEditScreen
          variant={variant}
          days={baseDays({ aViolation: true })}
          lockedSlotKeys={LOCKED}
          onBack={noop}
          onSave={noop}
        />
      );

      expect(
        screen.getByTestId(`planb-manual-violation-${key('poi-a')}`)
      ).toBeOnTheScreen();
    }
  );
});

describe('🔴 V2 · AC-2 — 배지는 서버 데이터를 추종한다(sticky 아님)', () => {
  it('hasViolation=false 면 배지 부재, 데이터가 켜지면 뜨고 다시 꺼지면 사라진다', () => {
    const { rerender } = render(
      <ManualEditScreen
        days={baseDays({ aViolation: false })}
        onBack={noop}
        onSave={noop}
      />
    );
    expect(
      screen.queryByTestId(`planb-manual-violation-${key('poi-a')}`)
    ).toBeNull();

    rerender(
      <ManualEditScreen
        days={baseDays({ aViolation: true })}
        onBack={noop}
        onSave={noop}
      />
    );
    expect(
      screen.getByTestId(`planb-manual-violation-${key('poi-a')}`)
    ).toBeOnTheScreen();

    rerender(
      <ManualEditScreen
        days={baseDays({ aViolation: false })}
        onBack={noop}
        onSave={noop}
      />
    );
    expect(
      screen.queryByTestId(`planb-manual-violation-${key('poi-a')}`)
    ).toBeNull();
  });
});

describe('🔴 W1 · 화면 콜백 배선(시트 실제 열림은 6-b 실기)', () => {
  it('[저장]·휴지통·[시각 입력] press 가 각 콜백을 부른다', () => {
    const onSave = jest.fn();
    const onDeleteSlot = jest.fn();
    const onEditSlotTime = jest.fn();

    render(
      <ManualEditScreen
        variant="error"
        days={baseDays()}
        lockedSlotKeys={LOCKED}
        onBack={noop}
        onSave={onSave}
        onDeleteSlot={onDeleteSlot}
        onEditSlotTime={onEditSlotTime}
      />
    );

    fireEvent.press(screen.getByTestId('planb-manual-save'));
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId(`planb-manual-delete-${key('poi-a')}`));
    expect(onDeleteSlot).toHaveBeenCalledWith('poi-a');

    // 버튼 존재 + onPress 배선까지만 — 시트 열림·HH:mm 반영은 목이 못 봐 6-b 실기(★4).
    fireEvent.press(
      screen.getByTestId(`planb-manual-time-input-${key('poi-a')}`)
    );
    expect(onEditSlotTime).toHaveBeenCalledWith(key('poi-a'));
  });
});
