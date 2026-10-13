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
 *  - (뷰는 props 만 받는다 — 쿼리·라우터·스토어·API 를 import 하지 않는다(01b Q4, 프리뷰가 네트워크 계층을 끌고 오지 않게).
 *    그 소스 import 스캔 it(옛 AC-11)은 TRIP-1353 에서 지웠다 — README 판정 3, 이 뷰의 props 계약은 위 it 들이 렌더로 잠근다.)
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
