import type { DayCoverage } from '@/shared/api/generated/schemas';

import {
  formatSectionRange,
  formatTripRange,
  unresolvedDaysView,
} from './baseScreen';

/**
 * TRIP-225 g02 — 화면이 그릴 **문자열**을 만드는 순수 함수들. 네트워크·시계를 안 건드린다.
 *
 * 무엇을 보장하나:
 *  - 구간 행 날짜(`6/10–6/12`)와 섹션 부제(`6월 10일–13일`)가 **서로 다른 두 서식**으로 나온다.
 *    기존 `formatDateRange`(`6월 10일 – 6월 13일`)와도 다르다 — 셋을 섞으면 화면이 Figma와 어긋난다.
 *  - 미해결 날짜 나열이 **앞 2개 + `외 N일`**로 접힌다(01b D16). 접는 규칙은 경계에서만 갈리므로
 *    1개·정확히 2개·3개·5개를 전부 태운다(02a ★9).
 *  - 나열 대상은 **`AUTO`가 아닌 것 전부**다(GAP·OVERLAP 둘 다). "나쁜 상태를 열거"하는 대신
 *    "좋은 상태를 배제"하는 형태라, 서버가 상태를 하나 더 늘려도 안 깨진다(01b D16).
 *
 * ⚠️ 구분자는 **en dash `–`(U+2013)** 다 — 하이픈 `-`(U+002D)이 아니다. 눈으로 구분되지 않아
 * 코드포인트로도 한 번 못박는다(`baseSections.ts`의 `EN_DASH` 상수와 같은 문자).
 */

/** 여행 6/10~6/13의 숙박일 3개(6/10·6/11·6/12) + 6/13은 체크아웃일이라 서버가 안 센다. */
function day(date: string, status: DayCoverage['status']): DayCoverage {
  return { date, status };
}

describe('formatSectionRange — 구간 행 날짜 (6/10–6/12)', () => {
  it('en dash로 이어 붙이고 월·일에 0을 채우지 않는다', () => {
    expect(formatSectionRange('2026-06-10', '2026-06-12')).toBe('6/10–6/12');

    // 하이픈으로 적으면 Figma와 다른 글자가 된다 — 코드포인트로 못박는다.
    expect(formatSectionRange('2026-06-10', '2026-06-12')).toContain(
      String.fromCharCode(0x2013)
    );
    expect(formatSectionRange('2026-06-10', '2026-06-12')).not.toContain('-');
  });

  it('한 자리 월·일도 0 패딩 없이 나온다', () => {
    // `07-01`을 그대로 쓰면 `07/01–07/03`이 되어 Figma(`6/10`)와 자리수가 어긋난다.
    expect(formatSectionRange('2026-07-01', '2026-07-03')).toBe('7/1–7/3');
  });
});

describe('formatTripRange — 섹션 부제 (6월 10일–13일)', () => {
  it('같은 달이면 둘째 월을 생략하고 공백 없이 잇는다', () => {
    // 기존 `formatDateRange`는 `'6월 10일 – 6월 13일'`(양쪽 월 + 공백)이라 서식이 다르다.
    expect(formatTripRange('2026-06-10', '2026-06-13')).toBe('6월 10일–13일');
  });

  it('달을 넘으면 둘째 월을 적는다', () => {
    // ⚠️ Figma는 같은 달 예시만 그렸다 — 이 갈래는 이 칸의 발명이다(02a §5-6 I-6).
    expect(formatTripRange('2026-06-30', '2026-07-02')).toBe(
      '6월 30일–7월 2일'
    );
  });
});

describe('unresolvedDaysView — 미해결 날짜 접기 (01b D16 · 02a ★9)', () => {
  it('1개면 그것만 나오고 접미가 붙지 않는다', () => {
    const view = unresolvedDaysView([
      day('2026-06-10', 'AUTO'),
      day('2026-06-11', 'GAP'),
      day('2026-06-12', 'AUTO'),
    ]);

    expect(view.items).toEqual([{ date: '2026-06-11', label: '6/11' }]);
    expect(view.overflowCount).toBe(0);
  });

  it('정확히 2개까지는 전부 나오고 접미가 없다 — 경계 ①', () => {
    // 여기와 아래 3개 케이스 사이가 규칙이 갈리는 유일한 자리다. 하나만 재면
    // `>= 2`와 `> 2`가 구별되지 않는다.
    const view = unresolvedDaysView([
      day('2026-06-11', 'GAP'),
      day('2026-06-12', 'AUTO'),
      day('2026-06-13', 'OVERLAP'),
    ]);

    expect(view.items).toEqual([
      { date: '2026-06-11', label: '6/11' },
      { date: '2026-06-13', label: '6/13' },
    ]);
    expect(view.overflowCount).toBe(0);
  });

  it('3개면 앞 2개만 남고 나머지가 접힌다 — 경계 ②', () => {
    const view = unresolvedDaysView([
      day('2026-06-11', 'GAP'),
      day('2026-06-13', 'OVERLAP'),
      day('2026-06-14', 'GAP'),
    ]);

    expect(view.items).toEqual([
      { date: '2026-06-11', label: '6/11' },
      { date: '2026-06-13', label: '6/13' },
    ]);
    expect(view.overflowCount).toBe(1);
  });

  it('접미 수가 상수가 아니라 실제 나머지다', () => {
    // `외 1일`을 고정으로 박은 구현이 위 케이스만으로는 통과한다.
    const view = unresolvedDaysView([
      day('2026-06-11', 'GAP'),
      day('2026-06-12', 'GAP'),
      day('2026-06-13', 'OVERLAP'),
      day('2026-06-14', 'GAP'),
      day('2026-06-15', 'OVERLAP'),
    ]);

    expect(view.items).toHaveLength(2);
    expect(view.overflowCount).toBe(3);
  });

  it('전부 AUTO면 비어 있다 — 그래도 막을지는 이 함수가 정하지 않는다', () => {
    // 나열이 비는 것과 "막지 않는다"는 별개다(01b D16-b). 막을 권위는 `blocked` 필드 하나이고,
    // 그 짝은 페이지 테스트(3-4)가 진다.
    const view = unresolvedDaysView([
      day('2026-06-10', 'AUTO'),
      day('2026-06-11', 'AUTO'),
      day('2026-06-12', 'AUTO'),
    ]);

    expect(view.items).toEqual([]);
    expect(view.overflowCount).toBe(0);
  });

  it('GAP과 OVERLAP을 모두 세고 서버가 준 순서를 지킨다', () => {
    // 긍정 짝 — 위 "전부 AUTO면 0"이 **어떤 것도 안 세는** 구현으로도 통과하는 것을 막는다.
    // GAP만 나열하면 겹침만 있는 여행에서 안내행이 비어 침묵 실패가 된다(BR-U1-55).
    const view = unresolvedDaysView([
      day('2026-06-13', 'OVERLAP'),
      day('2026-06-11', 'GAP'),
    ]);

    expect(view.items).toEqual([
      { date: '2026-06-13', label: '6/13' },
      { date: '2026-06-11', label: '6/11' },
    ]);
  });

  it('빈 배열도 그대로 빈 결과다', () => {
    expect(unresolvedDaysView([])).toEqual({ items: [], overflowCount: 0 });
  });
});
