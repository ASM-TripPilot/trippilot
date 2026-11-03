import { sortSlotsByStartAt } from './sortSlotsByStartAt';

/**
 * TRIP-1674 · 시각을 바꾼 뒤 그 날 슬롯을 **시작 시각 순**으로 다시 세우는 순수 함수 — 정렬 규칙의 정본.
 *
 * 무엇을 보장하나: 서버(AI `DaySolution`)는 슬롯이 시작 시각 순이 아니면 422 를 내고 저장이 "판정 보류"로
 * 끝난다. 그 규칙을 FE 가 똑같이 따른다.
 *  ① `startAt` 이 있는 슬롯은 `HH:mm:ss` **전체**(초까지) 오름차순 ② 같은 시각은 입력 순서 유지(안정)
 *  ③ `startAt` 이 null 인 슬롯은 제자리 ④ 끝 시각·`endsNextDay` 는 키가 아니다
 *  ⑤ 입력은 안 바꾸고 새 배열을 돌려준다(원소는 같은 객체).
 *
 * > *(개념)* **제네릭 `<T extends { startAt: string | null }>`** — 슬롯 전체 모양이 아니라 "`startAt` 을
 * > 가진 무엇이든" 받는다는 뜻. 함수가 키만 읽는다는 계약을 타입으로 적은 것이라 여기 테스트의 슬롯도
 * > `{ id, startAt }` 만으로 충분하다.
 *
 * 3동작 뼈대: 준비=슬롯 열 → 실행=sortSlotsByStartAt → 단언=id 열.
 */

interface S {
  id: string;
  startAt: string | null;
  endAt?: string;
  endsNextDay?: boolean;
}

const s = (id: string, startAt: string | null, rest: Partial<S> = {}): S => ({
  id,
  startAt,
  ...rest,
});
const ids = (slots: S[]): string[] => slots.map((one) => one.id);

describe('sortSlotsByStartAt', () => {
  it('C1 · 이웃을 넘는 시각은 시각 순으로 정렬된다', () => {
    const input = [s('a', '15:00:00'), s('b', '11:00:00'), s('c', '13:00:00')];
    expect(ids(sortSlotsByStartAt(input))).toEqual(['b', 'c', 'a']);
  });

  it('C8 · 이미 정렬된 열은 그대로다(불필요한 흔들림 없음)', () => {
    const input = [s('a', '09:00:00'), s('b', '11:00:00'), s('c', '13:00:00')];
    expect(ids(sortSlotsByStartAt(input))).toEqual(['a', 'b', 'c']);
  });

  it('C2 · 같은 시각은 입력 순서를 유지한다(안정)', () => {
    const input = [
      s('a', '10:00:00'),
      s('b', '09:00:00'),
      s('c', '10:00:00'),
      s('d', '09:00:00'),
    ];
    // 같은 키 안에서 입력 순서: 09:00 → b, d · 10:00 → a, c.
    expect(ids(sortSlotsByStartAt(input))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('C3 · 초가 다른 시각도 구분한다(09:30:30 은 09:30:00 뒤)', () => {
    const input = [s('a', '09:30:30'), s('b', '09:30:00')];
    expect(ids(sortSlotsByStartAt(input))).toEqual(['b', 'a']);
  });

  it('C4 · 자정을 넘기는 슬롯도 시작 시각으로 센다(끝 시각·endsNextDay 는 키가 아니다)', () => {
    const input = [
      s('x', '23:50:00', { endAt: '23:59:00', endsNextDay: false }),
      s('night', '23:15:00', { endAt: '00:45:00', endsNextDay: true }),
      s('early', '08:00:00', { endAt: '09:00:00', endsNextDay: false }),
    ];
    // 끝 시각(00:45)이 키면 night 가 맨 앞, endsNextDay 를 +24h 로 얹으면 night 가 x 뒤 — 둘 다 아니다.
    expect(ids(sortSlotsByStartAt(input))).toEqual(['early', 'night', 'x']);
  });

  it('C5 · startAt 이 null 인 슬롯은 제자리에 남고 나머지끼리 그 사이에서 정렬된다', () => {
    const input = [
      s('a', '13:00:00'),
      s('n1', null),
      s('b', '09:00:00'),
      s('n2', null),
      s('c', '11:00:00'),
    ];
    // null 의 자리(1, 3)는 그대로, 나머지 자리(0, 2, 4)에 b·c·a.
    expect(ids(sortSlotsByStartAt(input))).toEqual(['b', 'n1', 'c', 'n2', 'a']);
  });

  it.each([
    ['빈 배열', [] as S[]],
    ['원소 1개', [s('a', '09:00:00')]],
    ['전부 null', [s('n1', null), s('n2', null)]],
  ])('경계 · %s 은 그대로다', (_name, input) => {
    expect(ids(sortSlotsByStartAt(input))).toEqual(ids(input));
  });

  it('비파괴 · 입력 배열은 그대로고, 결과 원소는 입력의 같은 객체다', () => {
    const a = s('a', '15:00:00', { endAt: '16:00:00' });
    const b = s('b', '11:00:00');
    const input = [a, b];
    const snapshot = JSON.parse(JSON.stringify(input)) as S[];

    const sorted = sortSlotsByStartAt(input);

    expect(input).toEqual(snapshot);
    expect(input[0]).toBe(a);
    expect(sorted[0]).toBe(b);
    expect(sorted[1]).toBe(a);
  });
});
