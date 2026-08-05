import type { SavedStay } from '@/shared/api/generated/schemas';

import { formatDateRange } from './tripWizardStep1';
import {
  formatStayDateRange,
  resolveStayImport,
  type StayImportView,
} from './stayDateImport';

/**
 * TRIP-208 등록 숙소 날짜 연계 — **얼굴을 고르는 순수 함수**(01b §3 판정 트리 · D1·D2·D6·D7·D8).
 *
 * 무엇을 보장하나: `GET /saved-stays` 결과와 "기간이 이미 채워졌나" 두 가지만 보고 네 얼굴
 * (로딩 · 대안 · 활성 · 비활성+사유) 중 **정확히 하나**를 고르고, 비활성 사유 셋의 우선순위가
 * ① 기간 이미 입력 > ② 다중 숙소 > ③ 날짜 없음으로 갈린다(D6). 그리고 이 행의 기간 표기
 * `6.10~6.13`이 날짜 카드의 `6월 10일 – 6월 13일`과 **다른 서식**임을 못박는다.
 *
 * 왜 순수 함수인가: 이 판정이 화면에 있으면 `tripWizardStep1Boundary.test.ts`가 막고(화면은
 * 완성 props만 받는다 — AC-13), 배선에 흩어 두면 조합을 하나씩 렌더해야만 확인할 수 있다.
 * 여기서 조합을 전부 태워 두면 배선 테스트는 "그 결과가 화면까지 이어지는가"만 보면 된다.
 *
 * ⚠️ 조용한 급소 — **"목록이 아직 없다"와 "조회가 실패해서 없다"는 다른 상태다.** 앞은
 * 자리표시(로딩), 뒤는 빈 목록으로 판정을 돌려야 한다(01b D4). 뒤를 로딩으로 접으면
 * 스켈레톤이 영원히 돌고 사용자가 할 수 있는 일이 사라진다 — 침묵 실패다(BR-U1-55 · INV-4).
 *
 * 3동작 뼈대: 준비=숙소 목록·플래그 조립 → 실행=resolveStayImport → 단언=고른 얼굴과 문구.
 */

/** Figma `2225:2362` 실측 인스턴스가 쓰는 범위. 날짜 카드 테스트와 같은 날짜다. */
const CHECK_IN = '2026-06-10';
const CHECK_OUT = '2026-06-13';

/** 01b §9 — Figma·정본에 근거가 **없는 발명 문자열** 2종. 게이트①에서 뒤집히면 구현 상수와
 * 이 두 줄이 함께 바뀐다. */
const REASON_PERIOD_FILLED = '이미 입력한 기간이 있어요';
const REASON_MULTIPLE_STAYS = '여러 숙소가 등록돼 있어요';
/** 사유 셋 중 **유일한 Figma 실측 확정값**(`2226:2034`). 가운뎃점은 U+00B7이다. */
const REASON_NO_DATES = '등록 숙소에 체크인·체크아웃이 없어요';

const ALL_REASONS = [
  REASON_PERIOD_FILLED,
  REASON_MULTIPLE_STAYS,
  REASON_NO_DATES,
];

/**
 * 계약(`SavedStay`)의 required 6필드를 채운 픽스처. 상상해서 만들지 않는다 —
 * `checkIn`·`checkOut`은 **각각 독립 nullable**이라 없는 것이 계약상 정상이다.
 */
function stay(over: Partial<SavedStay> = {}): SavedStay {
  return {
    savedStayId: '00000000-0000-0000-0000-000000000001',
    name: '해운대 호텔',
    coordConfirmed: true,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

/** 날짜가 **둘 다** 있는 숙소(D7 — 쌍이라야 "가져올 날짜가 있다"). */
function dated(name: string, over: Partial<SavedStay> = {}): SavedStay {
  return stay({ name, checkIn: CHECK_IN, checkOut: CHECK_OUT, ...over });
}

/** 기본 입력 — 목록만 갈아 끼우면 되게. */
function input(over: Partial<Parameters<typeof resolveStayImport>[0]> = {}) {
  return {
    stays: [] as SavedStay[],
    loading: false,
    periodFilled: false,
    ...over,
  };
}

/** 비활성 얼굴의 사유 문구만 꺼낸다(타입 좁히기 없이 읽으면 tsc가 막는다). */
function noteOf(view: StayImportView): string {
  if (view.kind === 'blocked' || view.kind === 'ready') return view.note;
  throw new Error(`문구가 없는 얼굴이다: ${view.kind}`);
}

describe('기간 서식 — 이 행은 날짜 카드와 다른 표기를 쓴다', () => {
  it('점과 물결로 쓴다 (Figma 2225:2370)', () => {
    expect(formatStayDateRange(CHECK_IN, CHECK_OUT)).toBe('6.10~6.13');
  });

  it('한 자리 월·일에 0을 채우지 않는다', () => {
    expect(formatStayDateRange('2026-01-05', '2026-12-31')).toBe('1.5~12.31');
  });

  it('⚠️ 날짜 카드의 서식과 문자가 다르다 — 재사용하면 여기서 걸린다', () => {
    // 같은 인자를 **두 함수에 함께** 태운다. 서식이 하나뿐이라고 착각해
    // `formatDateRange`를 그대로 쓰면 이 it이 red를 낸다.
    const row = formatStayDateRange(CHECK_IN, CHECK_OUT);
    const card = formatDateRange(CHECK_IN, CHECK_OUT);

    expect(row).not.toBe(card);
    // 카드는 en dash(U+2013), 이 행은 ASCII 물결표(U+007E)다. 눈으로는 잘 안 갈린다.
    expect(card).toContain('–');
    expect(row).not.toContain('–');
    expect(row).toContain('~');
    expect(card).not.toContain('~');
  });
});

describe('데이터 축 — 목록이 없거나 비었을 때 (01b §3 1단계)', () => {
  it('아직 못 받았고 조회 중이면 자리표시다', () => {
    expect(
      resolveStayImport(input({ stays: undefined, loading: true }))
    ).toEqual({ kind: 'loading' });
  });

  it('⚠️ 조회가 끝났는데 목록이 없으면 로딩이 아니라 대안이다 (D4 · INV-4)', () => {
    // `loading:false`인데 `stays:undefined`는 **첫 조회가 실패한 상태**다(02a §5-3 실측:
    // 첫 실패면 data는 undefined이고 isPending은 false가 된다). 여기서 로딩을 돌려주면
    // 스켈레톤이 영원히 돌고 사용자가 할 수 있는 일이 사라진다 — 침묵 실패다.
    expect(
      resolveStayImport(input({ stays: undefined, loading: false }))
    ).toEqual({ kind: 'empty' });
  });

  it('등록 숙소 0개면 대안이다 (AC-2 · D8)', () => {
    expect(resolveStayImport(input({ stays: [] }))).toEqual({ kind: 'empty' });
  });

  it('짝 — 대안 판정은 기간 입력 여부와 무관하다 (AC-2 "기간 입력 여부와 무관")', () => {
    // 얼굴 C에는 `가져오기` 버튼이 아예 없으므로(Figma 2226:1829) "기간 이미 입력"과
    // 교차할 이유가 없다. 여기서 사유 ①로 새면 대안 UI가 영영 안 뜬다.
    expect(resolveStayImport(input({ stays: [], periodFilled: true }))).toEqual(
      {
        kind: 'empty',
      }
    );
  });
});

describe('얼굴 A — 날짜 있는 숙소가 정확히 1곳 (AC-1)', () => {
  it('숙소명과 기간을 이어 붙인 부제를 만든다', () => {
    const view = resolveStayImport(input({ stays: [dated('해운대 호텔')] }));

    expect(view).toEqual({
      kind: 'ready',
      note: '해운대 호텔 · 6.10~6.13',
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
    });
  });

  it('날짜 없는 숙소가 섞여 있어도 날짜 있는 곳이 하나면 활성이다', () => {
    // "등록 숙소 2곳"이 아니라 "**날짜 있는** 숙소 2곳"이 다중 판정 기준이다(01b §3).
    const view = resolveStayImport(
      input({
        stays: [dated('해운대 호텔'), stay({ name: '경주 게스트하우스' })],
      })
    );

    expect(view.kind).toBe('ready');
    expect(noteOf(view)).toContain('해운대 호텔');
    expect(noteOf(view)).not.toContain('경주 게스트하우스');
  });

  it('좌표 미확정 숙소를 제외하지 않는다 (INV-U1-08은 거점 배정에만 적용)', () => {
    // 날짜 가져오기는 좌표와 무관하다(01b §6 제약 · 티켓 명시). `coordConfirmed`로
    // 거르면 지도에서 안 찍은 숙소의 날짜를 영원히 못 가져온다.
    const view = resolveStayImport(
      input({ stays: [dated('링크로 담은 호텔', { coordConfirmed: false })] })
    );

    expect(view.kind).toBe('ready');
  });
});

describe('얼굴 B — 비활성 + 사유 (AC-4 · AC-5 · AC-6)', () => {
  it('기간이 이미 입력돼 있으면 사유 ① (BR-U1-41 덮어쓰기 금지 · D2)', () => {
    const view = resolveStayImport(
      input({ stays: [dated('해운대 호텔')], periodFilled: true })
    );

    expect(view).toEqual({ kind: 'blocked', note: REASON_PERIOD_FILLED });
  });

  it('날짜 있는 숙소가 2곳 이상이면 사유 ② (D1 — 다중 구간은 US-TRIP-06)', () => {
    const view = resolveStayImport(
      input({ stays: [dated('해운대 호텔'), dated('경주 한옥')] })
    );

    expect(view).toEqual({ kind: 'blocked', note: REASON_MULTIPLE_STAYS });
  });

  it('날짜 있는 숙소가 0곳이면 사유 ③ (Figma 실측 문구)', () => {
    const view = resolveStayImport(input({ stays: [stay()] }));

    expect(view).toEqual({ kind: 'blocked', note: REASON_NO_DATES });
  });

  const HALF_DATED: { name: string; over: Partial<SavedStay> }[] = [
    { name: '체크인만 있다', over: { checkIn: CHECK_IN, checkOut: null } },
    { name: '체크아웃만 있다', over: { checkIn: null, checkOut: CHECK_OUT } },
    { name: '둘 다 null이다', over: { checkIn: null, checkOut: null } },
  ];

  it.each(HALF_DATED)('D7 · $name → "날짜 없음"으로 친다', ({ over }) => {
    // 계약은 두 필드를 **각각 독립 nullable**로 둔다 — 한쪽만 있는 숙소가 정상이다.
    // 반쪽 기간은 여행 기간이 될 수 없고(BR-U1-36은 시작·종료 쌍을 검증한다),
    // Figma 문구도 `체크인·체크아웃`으로 둘을 한 덩어리로 부른다.
    const view = resolveStayImport(input({ stays: [stay(over)] }));

    expect(view).toEqual({ kind: 'blocked', note: REASON_NO_DATES });
  });
});

describe('D6 · 사유가 여럿 성립하면 하나만 나온다 (AC-7)', () => {
  it('① 기간 이미 입력이 ② 다중 숙소를 이긴다', () => {
    // 준비 — 두 사유가 **동시에** 성립한다. 우선순위가 없으면 구현마다 다른 문구가 뜬다.
    const both = input({
      stays: [dated('해운대 호텔'), dated('경주 한옥')],
      periodFilled: true,
    });

    expect(noteOf(resolveStayImport(both))).toBe(REASON_PERIOD_FILLED);

    // 짝 — 기간만 비우면 ②로 내려온다. 이게 없으면 "언제나 ①만 내는" 구현도 통과한다.
    expect(noteOf(resolveStayImport({ ...both, periodFilled: false }))).toBe(
      REASON_MULTIPLE_STAYS
    );
  });

  it('② 다중 숙소가 ③ 날짜 없음을 이긴다', () => {
    const view = resolveStayImport(
      input({ stays: [dated('해운대 호텔'), dated('경주 한옥'), stay()] })
    );

    expect(noteOf(view)).toBe(REASON_MULTIPLE_STAYS);
  });

  it('세 사유가 다 성립해도 화면에 갈 문구는 정확히 하나다', () => {
    // 우선순위의 실질 — 사용자는 "지금 이 화면에서 고칠 수 있는 것"(기간 지우기) 하나만
    // 본다. 세 문구를 이어 붙이는 구현을 여기서 막는다.
    const view = resolveStayImport(
      input({ stays: [dated('a'), dated('b'), stay()], periodFilled: true })
    );

    const matched = ALL_REASONS.filter((reason) =>
      noteOf(view).includes(reason)
    );
    expect(matched).toEqual([REASON_PERIOD_FILLED]);
  });
});
