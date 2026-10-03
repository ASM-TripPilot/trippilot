import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';

import { buildSlotKey, parseSlotKey } from '@/entities/itinerary-slot';
import { itineraryDestinationHref } from '@/features/itinerary/index.view';
import type { ItineraryDaysItem } from '@/shared/api/index.schemas';

/**
 * TRIP-1006 A2 · 같이 짜기 재진입 목적지가 **문자열 경로**로 슬롯 채우기 화면을 가리킨다 — 그 경로가
 * 라우터를 지나 **같은 슬롯 키로 다시 풀리는가**를 expo-router 실물로 잰다.
 *
 * 왜 따로 재나: 슬롯 키가 `"{date}#{poiId}"` 인데, 문자열 경로에서 `#` 뒤는 URL 조각(fragment)이라
 * 라우터가 잘라 버린다. 그러면 슬롯 채우기 화면은 날짜만 받아 엉뚱한 슬롯(또는 빈 화면)을 연다.
 * 판정기 단위 테스트는 "인코딩된 문자열"까지만 보고, 그 문자열이 정말 원래 키로 돌아오는지는
 * 라우터만 안다(02a ★1).
 *
 * *(개념)* `renderRouter` — expo-router 가 테스트용으로 주는 가짜 앱. 경로 → 화면 표를 넘기면 실제
 *   라우터가 `initialUrl` 을 해석해 그 화면을 그린다. 화면 안에서 `useLocalSearchParams()` 로 읽은
 *   값이 곧 "라우터가 풀어 준 값"이다.
 *
 * 3동작: 준비 = 슬롯 키가 든 일정 · 경로 → 실행 = 그 경로로 앱을 연다 → 단언 = 화면이 받은 slotKey.
 *
 * 통합 버킷(`.integration.test`)에 두는 이유: 실물 expo-router 는 `@react-navigation/native` ESM 을
 *   require 하는데, node 버킷의 `--experimental-vm-modules` 아래서는 그 로드가 실패한다(02a §5).
 */

const DATE = '2026-10-10';
const POI = 'poi-a';

/** 라우터가 풀어 준 slotKey 를 글자로 드러내는 가짜 슬롯 채우기 화면. */
function SlotKeyProbe() {
  const { slotKey } = useLocalSearchParams<{ slotKey: string }>();
  return <Text testID="probe-slot-key">{slotKey}</Text>;
}

const ROUTES = {
  'trips/[tripId]/itinerary/copick/[slotKey]': SlotKeyProbe,
  index: () => null,
};

function receivedSlotKey(): unknown {
  return screen.getByTestId('probe-slot-key').props.children;
}

describe('RT-0 · 탐지기 자가검사 — 날것의 `#` 는 실제로 잘린다', () => {
  it('인코딩 없이 이은 경로로 열면 화면은 날짜만 받는다', () => {
    // 이 테스트가 통과해야 아래 RT-1 이 "잘림을 볼 수 있는 심판"이라는 뜻이 된다.
    renderRouter(ROUTES, {
      initialUrl: `/trips/T/itinerary/copick/${DATE}#${POI}`,
    });

    expect(receivedSlotKey()).toBe(DATE);
  });
});

describe('🔴 RT-1 · 재진입 목적지 경로가 같은 슬롯 키로 다시 풀린다 (1006 A2)', () => {
  it('판정기가 만든 copick 경로로 열면 화면이 원래 슬롯 키를 그대로 받는다', () => {
    // 준비 — 첫 비고정 슬롯이 poi-a 인 일정(앞의 고정 숙소는 건너뛴다).
    const days: ItineraryDaysItem[] = [
      {
        date: DATE,
        slots: [
          {
            poiId: 'hotel',
            startAt: '00:00:00',
            endAt: '00:00:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: POI,
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    const href = itineraryDestinationHref('T', 'copick', days);

    // 실행
    renderRouter(ROUTES, { initialUrl: href });

    // 단언 ① 원래 키와 글자 단위로 같다.
    const key = receivedSlotKey();
    expect(key).toBe(buildSlotKey(DATE, POI));
    // 단언 ② 슬롯 채우기 화면이 쓰는 되읽기도 성공한다(날짜·장소 둘 다 복원).
    expect(parseSlotKey(String(key))).toEqual({
      kind: 'ok',
      date: DATE,
      poiId: POI,
    });
  });
});
