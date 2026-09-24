import type { ComponentProps } from 'react';

import { TimeSheet } from './TimeSheet';

/**
 * TRIP-927 · TimeSheet props 는 `mode` 판별 유니온이다 — **이 파일의 심판은 jest 가 아니라 `pnpm tsc`**.
 *
 * `// @ts-expect-error` 는 "바로 다음 줄에서 타입 오류가 나야 한다"는 선언이고, 오류가 안 나면 tsc 가
 * `TS2578 Unused '@ts-expect-error' directive` 로 실패한다(선례 `tripContract.test.ts`). jest 는 엘리먼트를
 * 만들기만 하고 렌더하지 않는다.
 *
 * 무엇을 보장하나:
 *  - T1·T2 default(`mode` 없음) 소비처는 한 글자도 안 바꾸고 컴파일된다 — PlaceAddPage 형태(매개변수가
 *    `endAt: string` 인 이름 붙은 핸들러)·ManualPlanPage 형태(인라인 `(patch) => adjust(patch)`)(AC-3).
 *  - T3 h04 는 `endAt: null` 을 보낼 수 있으므로 `endAt: string` 전용 핸들러를 받지 않는다.
 *  - T4 h04 의 종료 미설정 갈래에는 `endsNextDay` 가 **없다** — 소비처가 유도를 빼먹으면 컴파일이 막힌다(Q2).
 *  - T5 h04 의 종료 설정 갈래에는 `endsNextDay: boolean` 이 있다.
 *
 * ⚠️ directive 는 한 줄 범위라 대상 JSX 를 한 줄에 둔다(prettier 가 접으면 엉뚱한 줄에 걸린다, 02a ★8).
 * ⚠️ `mode="h04"` 는 spread 가 아니라 속성으로 적는다 — spread 속 판별자는 인라인 화살표의 문맥 타이핑을
 *    좁히지 못한다(스크래치 tsc 실측). 실제 소비처(페이지)도 속성으로 적는다.
 */

type Patch = { startAt: string; endAt: string; endsNextDay: boolean };

const base = {
  startAt: '13:00:00',
  endAt: '14:30:00',
  onCancel: () => undefined,
  testIDPrefix: 'itinerary-edit-time',
  labels: { start: '시작', end: '종료' },
};

/** PlaceAddPage `handleApplyTime` 형태 — 매개변수가 endAt: string 이다. */
function narrow(patch: Patch): void {
  void patch;
}

/** 스토어 `adjustSlotTime` 의 patch 자리 형태. */
function adjust(patch: Patch): void {
  void patch;
}

describe('AC-3 · Q2 — mode 판별 유니온 타입 계약 (심판 = pnpm tsc)', () => {
  it('default 는 좁은 핸들러를 받고, h04 는 null 갈래를 강제한다', () => {
    // T1 — default + 이름 붙은 좁은 핸들러(PlaceAddPage).
    const t1 = <TimeSheet {...base} onApply={narrow} />;

    // T2 — default + 인라인(ManualPlanPage·옛 ItineraryEditPage). endAt 은 string 이다.
    const t2 = (
      <TimeSheet
        {...base}
        onApply={(patch) => {
          const endAt: string = patch.endAt;
          void endAt;
          adjust(patch);
        }}
      />
    );

    // @ts-expect-error h04 는 endAt:null 을 보낼 수 있어 endAt:string 전용 핸들러를 못 받는다
    const t3 = <TimeSheet mode="h04" {...base} onApply={narrow} />;

    const t45 = (
      <TimeSheet
        mode="h04"
        {...base}
        onApply={(patch) => {
          if (patch.endAt === null) {
            // @ts-expect-error 종료 미설정 갈래에는 endsNextDay 가 없다(Q2)
            void patch.endsNextDay;
          } else {
            // T5 — 종료 설정 갈래는 endsNextDay 를 싣는다.
            const endsNextDay: boolean = patch.endsNextDay;
            void endsNextDay;
          }
        }}
      />
    );

    const props: ComponentProps<typeof TimeSheet>[] = [
      t1.props,
      t2.props,
      t45.props,
    ];
    expect([...props, t3.props]).toHaveLength(4);
  });
});
