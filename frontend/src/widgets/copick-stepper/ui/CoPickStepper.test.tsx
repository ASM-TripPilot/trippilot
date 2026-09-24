import { render, screen } from '@testing-library/react-native';

import { CoPickStepper, type CoPickStep } from './CoPickStepper';

/**
 * TRIP-794 · CoPickStepper(신규 widget, h09·h10 공유) — 이전·현재·다음 3단 스텝퍼.
 *
 * 무엇을 보장하나:
 *  - 🔴 3단(prev·current·next)이 각자 역할 라벨·제목·상태 2줄을 그린다.
 *  - 🔴 **현재 단만 빨강**(`text-primary`), 이전/다음 상태는 muted — 색 대비를 className 토큰으로 잠근다.
 *  - 🔴 상태 문구 위치 계약: '고름' / '지금 고르는 중' / '비어 있음'.
 *  - 🔴 prop `{prev?, current, next?}` **role 고정 3슬롯** — current만 주면 prev/next 열은 부재
 *       (이 shape 가 h10(795) 재사용을 구속한다, seed D2).
 *  - 🔴 INV-3 — 소요시간 문자열 0(진행·상태 어디에도). "오후"는 시간대 라벨이라 허용.
 *
 * *(설계 개념)* 새 문법 풀이:
 *  - `render(<X/>)`: 컴포넌트를 가상 화면에 그린다. `screen.getByTestId(id)`: 그 화면에서
 *    testID 로 노드를 찾는다(없으면 throw). `queryByTestId`: 없으면 `null`(부재 단언용).
 *  - `toHaveTextContent('문구')`: 그 노드의 텍스트가 '문구'와 **완전일치**(RNTL v13 기본 exact,
 *    node_modules `matches.js` `exact=true` 실측 — 02a §5-1). 부분포함이 필요하면 정규식을 준다
 *    (`toHaveTextContent(/전시/)` = `regex.test` 부분매치).
 *  - `className` 은 렌더 트리에 평문 prop 으로 남아 jest 가 읽는다(SVG fill 함정과 다름). 색 토큰은
 *    공백으로 쪼갠 **정확 토큰**으로 본다(`text-primary` 가 `text-primary-pale` 에 오검출되지 않게).
 *
 * *(jest 사각 · 6-b 육안)* 원·연결선·완료 체크 배지의 실제 모양/좌표, primary 정확한 색상은 6-b.
 */

// className 토큰을 공백으로 쪼개 정확히 그 토큰이 있는지 본다(text-primary ≠ text-primary-pale).
function classSet(testID: string): Set<string> {
  const node = screen.getByTestId(testID);
  return new Set(String(node.props.className ?? '').split(/\s+/));
}

// INV-3 소요시간 탐지기 — 숫자+분/시간 또는 '소요'. HH:mm 은 숫자 뒤가 ':' 라 안 걸린다.
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

const PREV: CoPickStep = {
  title: '황령산 전망대',
  status: '고름',
  done: true,
};
const CURRENT: CoPickStep = { title: '오후 · 전시', status: '지금 고르는 중' };
const NEXT: CoPickStep = { title: '오후 · 카페', status: '비어 있음' };

describe('🔴 S0 · INV-3 탐지기 자가검사 (전처리 없음 · 탐지기 단독)', () => {
  it('소요시간은 잡고, 시간대 라벨·슬롯 수·날짜는 안 잡는다', () => {
    // 조합 실측 — 이게 맞아야 아래 T5 렌더 스캔이 의미를 갖는다.
    expect(DURATION_TEXT.test('30분')).toBe(true);
    expect(DURATION_TEXT.test('1시간')).toBe(true);
    expect(DURATION_TEXT.test('소요')).toBe(true);
    // 허용(오검출 금지) — 시간대 라벨·슬롯 진행·날짜.
    expect(DURATION_TEXT.test('오후 · 전시')).toBe(false);
    expect(DURATION_TEXT.test('슬롯 3 / 4')).toBe(false);
    expect(DURATION_TEXT.test('6월 10일(수)')).toBe(false);
  });
});

describe('🔴 CoPickStepper — 3단·현재 빨강·상태 라벨·role 고정 3슬롯', () => {
  it('T1 · 3열(이전·현재·다음)이 역할·제목·상태를 그린다', () => {
    // 준비 — prev/current/next 3단.
    render(<CoPickStepper prev={PREV} current={CURRENT} next={NEXT} />);

    // 단언 — 루트 + 3열 존재.
    expect(screen.getByTestId('copick-stepper')).toBeTruthy();
    expect(screen.getByTestId('copick-stepper-prev')).toBeTruthy();
    expect(screen.getByTestId('copick-stepper-current')).toBeTruthy();
    expect(screen.getByTestId('copick-stepper-next')).toBeTruthy();

    // 역할 라벨 leaf(완전일치).
    expect(screen.getByTestId('copick-stepper-prev-role')).toHaveTextContent(
      '이전'
    );
    expect(screen.getByTestId('copick-stepper-current-role')).toHaveTextContent(
      '현재'
    );
    expect(screen.getByTestId('copick-stepper-next-role')).toHaveTextContent(
      '다음'
    );

    // 제목 leaf(완전일치).
    expect(screen.getByTestId('copick-stepper-prev-title')).toHaveTextContent(
      '황령산 전망대'
    );
    expect(
      screen.getByTestId('copick-stepper-current-title')
    ).toHaveTextContent('오후 · 전시');
    expect(screen.getByTestId('copick-stepper-next-title')).toHaveTextContent(
      '오후 · 카페'
    );
  });

  it('T2 · 현재 단만 빨강(text-primary), 이전/다음 상태는 muted', () => {
    render(<CoPickStepper prev={PREV} current={CURRENT} next={NEXT} />);

    // 현재 — 상태·역할 라벨 모두 빨강 토큰.
    expect(classSet('copick-stepper-current-status').has('text-primary')).toBe(
      true
    );
    expect(classSet('copick-stepper-current-role').has('text-primary')).toBe(
      true
    );

    // 이전/다음 — muted 이고 빨강 아님(색 대비 잠금).
    expect(classSet('copick-stepper-prev-status').has('text-muted')).toBe(true);
    expect(classSet('copick-stepper-prev-status').has('text-primary')).toBe(
      false
    );
    expect(classSet('copick-stepper-next-status').has('text-muted')).toBe(true);
    expect(classSet('copick-stepper-next-status').has('text-primary')).toBe(
      false
    );
  });

  it('T3 · 상태 문구: 이전=고름 · 현재=지금 고르는 중 · 다음=비어 있음', () => {
    render(<CoPickStepper prev={PREV} current={CURRENT} next={NEXT} />);

    expect(screen.getByTestId('copick-stepper-prev-status')).toHaveTextContent(
      '고름'
    );
    expect(
      screen.getByTestId('copick-stepper-current-status')
    ).toHaveTextContent('지금 고르는 중');
    expect(screen.getByTestId('copick-stepper-next-status')).toHaveTextContent(
      '비어 있음'
    );
  });

  it('T4 · role 고정 3슬롯 — current만 주면 prev/next 열은 부재', () => {
    // 첫/마지막 슬롯 상황 — current 필수, prev/next optional.
    render(<CoPickStepper current={CURRENT} />);

    // 현재 열은 있고.
    expect(screen.getByTestId('copick-stepper-current')).toBeTruthy();
    // 이전/다음 열은 없다(부재 = queryBy).
    expect(screen.queryByTestId('copick-stepper-prev')).toBeNull();
    expect(screen.queryByTestId('copick-stepper-next')).toBeNull();
  });

  it('T5 · INV-3 — 렌더된 어느 텍스트에도 소요시간 문자열이 없다', () => {
    render(<CoPickStepper prev={PREV} current={CURRENT} next={NEXT} />);

    // 소요시간(분/시간/소요)은 0. "오후 · 전시"(시간대 라벨)는 통과.
    expect(screen.queryByText(DURATION_TEXT)).toBeNull();
  });
});
