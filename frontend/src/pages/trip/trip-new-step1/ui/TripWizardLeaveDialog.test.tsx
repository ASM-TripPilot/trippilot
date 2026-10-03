import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactTestInstance } from 'react-test-renderer';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { TripWizardLeaveDialog } from './TripWizardLeaveDialog';

/**
 * TRIP-1114 · g01 위저드 이탈 확인 다이얼로그 — **뷰 전용** 심판(US-TRIP-10 · INV-4).
 *
 * 무엇을 보장하나:
 *  - 제목·본문·버튼 3개·실패 문구가 01b 확정 문구와 완전히 같다.
 *  - 세 버튼은 각자 자기 콜백만 한 번 부른다(서로 새지 않는다).
 *  - 실패 문구는 `failed` 일 때만, 다이얼로그 안에 뜬다.
 *  - 위→아래 [저장하고 나가기](코랄) · [삭제하고 나가기](아웃라인) · [계속 작성](텍스트) — 01b Q2.
 *  - 딤·카드·제목·본문 토큰은 형제 `BaseRegenerateDialog` 와 같다(AC-9).
 *  - 뷰는 props 만 받는다 — 쿼리·라우터·스토어·API 를 import 하지 않는다(01b Q4, 프리뷰가 네트워크
 *    계층을 끌고 오지 않게).
 *
 * 커버하지 않는 것: 딤이 실제로 화면을 덮는지·중앙 정렬·터치 차단(조건부 렌더 오버레이의 jest 사각 — 6-b).
 * 언제 열리고 누른 뒤 무엇이 나가는지는 `TripNewStep1Page.integration` 「‹ 나가기 확인」 몫.
 *
 * ⚠️ `toHaveTextContent(문자열)`·`getByText(문자열)`은 완전 일치다(RNTL 13.3.3 `build/matches.js` —
 *    공백은 접어서 비교).
 */

const TITLE = '여행 만들기를 그만둘까요?';
const BODY =
  '저장하면 내 여행에 작성 중으로 남아요. 삭제하면 되돌릴 수 없어요.';
const ERROR_TEXT = '삭제하지 못했어요. 다시 시도해 주세요.';

function tokens(el: ReactTestInstance): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function renderDialog(failed = false) {
  const onSave = jest.fn();
  const onDelete = jest.fn();
  const onStay = jest.fn();
  render(
    <TripWizardLeaveDialog
      failed={failed}
      onSave={onSave}
      onDelete={onDelete}
      onStay={onStay}
    />
  );
  return { onSave, onDelete, onStay };
}

describe('🔴 AC-9 · 문구 (01b Q1 확정)', () => {
  it('제목·본문·세 버튼 라벨이 확정 문구와 완전히 같다', () => {
    renderDialog();

    expect(screen.getByTestId('trip-wizard-leave-dialog')).toBeOnTheScreen();
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-leave-save')).toHaveTextContent(
      '저장하고 나가기'
    );
    expect(screen.getByTestId('trip-wizard-leave-delete')).toHaveTextContent(
      '삭제하고 나가기'
    );
    expect(screen.getByTestId('trip-wizard-leave-stay')).toHaveTextContent(
      '계속 작성'
    );
  });
});

describe('🔴 AC-6 · 실패 문구는 실패했을 때만, 다이얼로그 안에 뜬다 (INV-4)', () => {
  it('failed 가 false 면 실패 문구가 없다', () => {
    renderDialog(false);

    expect(screen.queryByTestId('trip-wizard-leave-error')).toBeNull();
  });

  it('failed 가 true 면 다이얼로그 안에 실패 문구가 완전 일치로 뜨고, 버튼 셋은 그대로다', () => {
    renderDialog(true);

    const dialog = screen.getByTestId('trip-wizard-leave-dialog');
    expect(
      within(dialog).getByTestId('trip-wizard-leave-error')
    ).toHaveTextContent(ERROR_TEXT);
    expect(tokens(screen.getByTestId('trip-wizard-leave-error'))).toEqual(
      expect.arrayContaining(['font-noto', 'text-label', 'text-primary-text'])
    );
    for (const id of [
      'trip-wizard-leave-save',
      'trip-wizard-leave-delete',
      'trip-wizard-leave-stay',
    ]) {
      expect(within(dialog).getByTestId(id)).toBeOnTheScreen();
    }
  });
});

describe('🔴 AC-3·4·5 · 버튼은 자기 콜백만 부른다', () => {
  it.each([
    ['trip-wizard-leave-save', 'onSave'],
    ['trip-wizard-leave-delete', 'onDelete'],
    ['trip-wizard-leave-stay', 'onStay'],
  ] as const)('%s 를 누르면 %s 만 한 번 부른다', (testID, called) => {
    // 준비
    const callbacks = renderDialog();

    // 실행
    fireEvent.press(screen.getByTestId(testID));

    // 단언 — 부른 것은 1번, 나머지 둘은 0번.
    expect(callbacks[called]).toHaveBeenCalledTimes(1);
    for (const [name, fn] of Object.entries(callbacks)) {
      if (name !== called) expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe('🔴 AC-9 · 세로 3단 · 강조 배정 (01b Q2)', () => {
  it('버튼 순서는 위에서부터 저장 → 삭제 → 계속 작성이다', () => {
    renderDialog();

    const order = screen
      .getAllByRole('button')
      .map((button) => button.props.testID);

    expect(order).toEqual([
      'trip-wizard-leave-save',
      'trip-wizard-leave-delete',
      'trip-wizard-leave-stay',
    ]);
  });

  it('저장은 코랄 채움, 삭제는 아웃라인, 계속 작성은 테두리·채움 없는 회색 글자다', () => {
    renderDialog();

    const save = screen.getByTestId('trip-wizard-leave-save');
    expect(tokens(save)).toEqual(
      expect.arrayContaining([
        'h-[44px]',
        'w-full',
        'rounded-button',
        'bg-primary',
      ])
    );
    expect(tokens(screen.getByText('저장하고 나가기'))).toEqual(
      expect.arrayContaining([
        'font-noto-bold',
        'text-card-title',
        'text-on-primary',
      ])
    );

    const del = screen.getByTestId('trip-wizard-leave-delete');
    expect(tokens(del)).toEqual(
      expect.arrayContaining([
        'h-[44px]',
        'w-full',
        'rounded-button',
        'border',
        'border-hairline-strong',
        'bg-canvas',
      ])
    );
    expect(tokens(del)).not.toContain('bg-primary');
    expect(tokens(screen.getByText('삭제하고 나가기'))).toEqual(
      expect.arrayContaining(['font-noto-bold', 'text-card-title', 'text-body'])
    );

    const stay = screen.getByTestId('trip-wizard-leave-stay');
    expect(tokens(stay)).not.toContain('bg-primary');
    expect(tokens(stay)).not.toContain('border');
    expect(tokens(screen.getByText('계속 작성'))).toContain('text-muted');
  });
});

describe('🔴 AC-9 · 레이아웃 토큰 (BaseRegenerateDialog 동형)', () => {
  it('딤 55% 전면 · 카드 330/20 · 제목 19 Bold ink · 본문 body 21', () => {
    renderDialog();

    expect(tokens(screen.getByTestId('trip-wizard-leave-dialog'))).toEqual(
      expect.arrayContaining([
        'absolute',
        'inset-0',
        'items-center',
        'justify-center',
        'bg-scrim/55',
      ])
    );
    expect(tokens(screen.getByTestId('trip-wizard-leave-card'))).toEqual(
      expect.arrayContaining([
        'w-[330px]',
        'rounded-[20px]',
        'bg-canvas',
        'p-2xl',
      ])
    );
    expect(tokens(screen.getByText(TITLE))).toEqual(
      expect.arrayContaining(['text-[19px]', 'font-noto-bold', 'text-ink'])
    );
    expect(tokens(screen.getByText(BODY))).toEqual(
      expect.arrayContaining(['font-noto', 'text-body', 'leading-[21px]'])
    );
  });
});

describe('🔴 AC-11(Q4 모양) · 뷰는 props 만 받는다', () => {
  const SOURCE = join(__dirname, 'TripWizardLeaveDialog.tsx');
  const FORBIDDEN = [
    '@tanstack/react-query',
    'expo-router',
    'axios',
    '@/shared/api',
    // TRIP-1157: 스토어는 슬라이스 공개 API(index·index.view)로도 들어온다 — model 딥 접두가 아니라 슬라이스 접두로 막는다.
    '@/features/trip',
    '@/features/create-trip',
    '@/pages',
    '@/app',
    '@routes',
  ];
  /** `from '…'` 절의 모듈 경로만 뽑는다(심볼명이 아니라 from 절 기준 — 동명 이심볼 오탐 방지). */
  const specifiersOf = (source: string): string[] =>
    [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const isForbidden = (spec: string): boolean =>
    FORBIDDEN.some(
      (prefix) => spec === prefix || spec.startsWith(`${prefix}/`)
    ) ||
    spec.startsWith('../model') ||
    /^(\.\.\/)+features\//.test(spec); // 상대경로로 슬라이스 밖 features 를 뚫는 것도 금칙

  it('탐지기 자가검사 — 금칙 import 는 잡고 react-native 는 통과시킨다', () => {
    const sample = [
      "import { useQueryClient } from '@tanstack/react-query';",
      "import { useTripWizardStore } from '@/features/create-trip/model/tripWizardStore';",
      "import { useTripWizardStore as viaIndex } from '@/features/create-trip';",
      "import { Pressable, Text, View } from 'react-native';",
    ].join('\n');

    expect(specifiersOf(sample).filter(isForbidden)).toEqual([
      '@tanstack/react-query',
      '@/features/create-trip/model/tripWizardStore',
      '@/features/create-trip',
    ]);
  });

  it('뷰 파일이 react-native 를 쓰고, 쿼리·라우터·API·스토어 import 는 0건이다', () => {
    const specifiers = specifiersOf(readFileSync(SOURCE, 'utf8'));

    // 긍정 짝 — 빈 파일이면 "금칙 0건"이 공허하게 통과한다.
    expect(specifiers).toContain('react-native');
    expect(specifiers.filter(isForbidden)).toEqual([]);
  });
});
