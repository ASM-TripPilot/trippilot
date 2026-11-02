import { render, screen } from '@testing-library/react-native';

import { CoPickStepper, type CoPickStep } from './CoPickStepper';

/**
 * TRIP-794 · CoPickStepper(신규 widget, h09·h10 공유) — 이전·현재·다음 3단 스텝퍼.
 *
 * 무엇을 보장하나:
 *  - 🔴 3단(prev·current·next)이 각자 역할 라벨·제목·상태 2줄을 그린다.
 *  - 🔴 상태 문구 위치 계약: '선택함' / '지금 고르는 중' / '비어 있음'.
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
 *
 * *(jest 사각 · 6-b 육안)* 원·연결선·완료 체크 배지의 실제 모양/좌표, primary 정확한 색상은 6-b.
 */

// INV-3 소요시간 탐지기 — 숫자+분/시간 또는 '소요'. HH:mm 은 숫자 뒤가 ':' 라 안 걸린다.
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

const PREV: CoPickStep = {
  title: '황령산 전망대',
  status: '선택함',
  done: true,
};
const CURRENT: CoPickStep = { title: '오후 · 전시', status: '지금 고르는 중' };
const NEXT: CoPickStep = { title: '오후 · 카페', status: '비어 있음' };

describe('🔴 CoPickStepper — 3단·상태 라벨·role 고정 3슬롯', () => {
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

  it('T3 · 상태 문구: 이전=선택함 · 현재=지금 고르는 중 · 다음=비어 있음', () => {
    render(<CoPickStepper prev={PREV} current={CURRENT} next={NEXT} />);

    expect(screen.getByTestId('copick-stepper-prev-status')).toHaveTextContent(
      '선택함'
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
