import { formatShareCardPeriod } from './formatShareCardPeriod';

/**
 * TRIP-766 · AC-2 — j06 공유 카드 기간 포매터 신규(`YYYY.MM.DD`, entities/trip/lib).
 *
 * 무엇을 보장하나(계약):
 *  - 🔴 default 얼굴: `YYYY.MM.DD ~ MM.DD`(연도 접두·0패딩·둘째는 월·일만, 구분자 물결표 `~`, nights 없음).
 *  - 🔴 no-photo 얼굴: `N박 M일 · YYYY.MM.DD – MM.DD`(nights 접두·구분자 en dash `–`).
 *  - 🔴 얼굴별 포맷 차이를 **그대로** 잠근다(Figma 카피 불일치 존치 — 통일 금지, Seed 3-a B).
 *  - 🔴 값 인터폴레이션(리터럴 금지): 다른 날짜면 출력도 바뀌고 한 자리 월·일은 0패딩된다.
 *  - 🔴 INV-3: 출력에 소요시간 문자열 0(박·일은 일수지 소요시간 아님 — formatNights 관례).
 *
 * (개념)
 *  - *포매터* = 원시 ISO(`'2026-06-10'`)를 화면 문자열(`'2026.06.10'`)로 바꾸는 순수 함수.
 *  - *0패딩* = 한 자리 수를 두 자리로(`3` → `03`). 기존 포매터엔 없어 신규(브리프 §신규필요).
 *  - *구분자 코드포인트* = `~`(U+007E 물결표)·`–`(U+2013 en dash)·`·`(U+00B7 미들닷)는 눈으로 구분이
 *    안 돼 아래 예제 문자열엔 진짜 코드포인트가 박혀 있고, A5 는 코드포인트로 대조해 하이픈/마침표로
 *    새는 것을 잡는다(formatTripPeriod.test 선례).
 *
 * 3동작 뼈대: 준비(ISO 날짜 쌍) → 실행(포매터 호출, opts 로 얼굴 지정) → 단언(반환 문자열 완전 일치).
 */

const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

describe('🔴 AC-2 · formatShareCardPeriod — 얼굴별 기간 포맷(통일 금지)', () => {
  it('A1 default: "2026.06.10 ~ 06.12"(물결표 · nights 없음 · 둘째는 월·일만)', () => {
    // 준비+실행: default 얼굴은 구분자 `~`, nights 접두 없음.
    const out = formatShareCardPeriod('2026-06-10', '2026-06-12', {
      separator: '~',
    });
    // 단언: 앞 날짜는 연도 접두, 뒤 날짜는 MM.DD 만.
    expect(out).toBe('2026.06.10 ~ 06.12');
  });

  it('A2 no-photo: "2박 3일 · 2026.06.01 – 06.03"(nights 접두 · en dash)', () => {
    // 준비+실행: no-photo 얼굴은 en dash `–` + `N박 M일 · ` 접두.
    const out = formatShareCardPeriod('2026-06-01', '2026-06-03', {
      separator: '–',
      nights: true,
    });
    expect(out).toBe('2박 3일 · 2026.06.01 – 06.03');
  });

  it('A3 값 인터폴레이션 + 0패딩 — 다른 날짜면 출력도 바뀌고 한 자리는 0패딩(리터럴 아님)', () => {
    // 준비+실행: 한 자리 월(3)·일(7·9)이 0패딩(03·07·09)돼야 한다.
    const out = formatShareCardPeriod('2026-03-07', '2026-03-09', {
      separator: '~',
    });
    expect(out).toBe('2026.03.07 ~ 03.09');
  });

  it('A4 nights 인터폴레이션 — 기간이 길면 박수도 따라 바뀐다', () => {
    // 준비+실행: 06-01 → 06-05 는 4박 5일.
    const out = formatShareCardPeriod('2026-06-01', '2026-06-05', {
      nights: true,
      separator: '–',
    });
    expect(out).toBe('4박 5일 · 2026.06.01 – 06.05');
  });

  it('A5 구분자 코드포인트 — no-photo 는 en dash(U+2013)·미들닷(U+00B7), default 는 물결표(U+007E)', () => {
    const noPhoto = formatShareCardPeriod('2026-06-01', '2026-06-03', {
      separator: '–',
      nights: true,
    });
    const def = formatShareCardPeriod('2026-06-10', '2026-06-12', {
      separator: '~',
    });
    // no-photo: en dash·미들닷 실재, 하이픈(U+002D)으로 새지 않는다.
    expect(noPhoto).toContain('–'); // – en dash
    expect(noPhoto).toContain('·'); // · 미들닷
    // default: 물결표 실재, en dash 부재(얼굴 구분자가 섞이지 않는다).
    expect(def).toContain('~'); // ~ 물결표
    expect(def).not.toContain('–');
  });

  it('A6 INV-3 — 두 얼굴 출력에 소요시간 문자열이 없다(거리·날짜만)', () => {
    const def = formatShareCardPeriod('2026-06-10', '2026-06-12', {
      separator: '~',
    });
    const noPhoto = formatShareCardPeriod('2026-06-01', '2026-06-03', {
      separator: '–',
      nights: true,
    });
    expect(def).not.toMatch(DURATION_TEXT);
    expect(noPhoto).not.toMatch(DURATION_TEXT);
  });
});
