import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PreferenceView } from '@/shared/api/generated/schemas';

import { PreferencesEditScreen } from './PreferencesEditScreen';

/**
 * TRIP-610 · 5-c 심판 강화 — 저장 diff 기준선은 "편집을 시작한 스냅숏"이어야 한다(경고-1 봉합).
 *
 * 무엇을 보장하나(닫는 사각):
 *  - 🔴 편집 도중 GET 이 재요청(재연결/무효화/포그라운드 focus)으로 **다른 데이터**를 돌려줘 화면의
 *    `view` 가 갈려도, 저장 diff 는 **시드 시점 기준선**으로 계산된다 — 사용자가 손대지 않은 축은
 *    PUT 에 실리지 않는다(서버 최신값을 덮어쓰는 lost update 금지, AC-2 가 막으려던 손실의 역유입).
 *
 * 왜 기존 통합(MSW)이 아니라 usePreferences 모듈 목인가:
 *  화면이 자족 컨테이너(스스로 GET/PUT)라 "편집 도중 view 가 다른 데이터로 갱신되는" 순간을 회차별로
 *  주입할 창구가 필요하다. 훅을 목해 1회차 view=A(시드) → 2회차 view=B(재요청 시뮬레이션)로 바꾸면
 *  화면이 `buildPreferenceInput` 에 **어느 view 를 기준선으로 넘기는지**를 `save` 인자로 직접 관찰할 수
 *  있다. 순수함수 `buildPreferenceInput(view, selection)` 자체는 무죄 — 고칠 곳은 화면이 넘기는 view 가
 *  frozen(시드 스냅숏)이어야 한다는 것뿐이다(`preferenceDraft` 는 real 로 두어 화면이 틀린 view 를
 *  넘기면 실제로 축이 새는 것을 관통한다). I1~I5(MSW 배선)·preferenceDraft 단위는 별 파일이라 무간섭.
 *
 * 왜 지금 RED 인가: 현재 `handleSave` 는 저장 시점의 **살아있는 view**(=B)를 기준선으로 넘긴다 —
 *  안 만진 styles 가 B(`['미식']`) 기준으로 "바뀐 것"처럼 보여 시드값 `['휴양']` 이 PUT 에 실린다.
 *  구현자가 기준선 스냅숏을 상태로 얼리면(baseline freeze) GREEN.
 *
 * 3동작 뼈대: 준비(view=A 시드) → 실행(pace만 편집 → view 를 B 로 갈아 재렌더 → 저장) →
 *  단언(save 인자에 편집한 pace 만, 안 만진 styles 는 없음).
 */

// 회차별로 갈아끼우는 GET view(재요청 시뮬레이션). handleSave 가 넘기는 기준선을 관찰하기 위한 seam.
// (jest.mock 팩토리가 참조하려면 이름이 `mock` 접두여야 한다 — out-of-scope 변수 가드.)
let mockView: PreferenceView | undefined;
const mockSave = jest.fn();

jest.mock('../model/usePreferences', () => ({
  usePreferences: () => ({
    view: mockView,
    isLoading: false,
    save: mockSave,
    saveError: false,
  }),
}));

// 화면이 뒤로가기에 useRouter 를 쓸 수 있어 무해 스텁(내비게이션은 무단언).
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

beforeEach(() => {
  mockView = undefined;
  mockSave.mockClear();
});

describe('PreferencesEditScreen — 저장 diff 기준선(경고-1)', () => {
  it('편집 도중 view 가 갱신돼도 안 만진 축은 시드 기준선으로 빠진다(lost update 금지)', async () => {
    // 준비 — 진입 시 GET=A: styles 설정('휴양'), pace 미설정. 이 A 가 편집 기준선.
    mockView = { styles: { value: ['휴양'], isNeutralDefault: false } };
    const { rerender } = render(<PreferencesEditScreen />);

    // 시드 확인(공허 통과 차단) — A 가 타일에 반영됐다.
    expect(
      await screen.findByTestId('settings-pref-style-휴양')
    ).toBeSelected();

    // 실행 ① — 사용자는 pace 만 '알차게'로 바꾼다(styles 미접촉).
    fireEvent.press(screen.getByTestId('settings-pref-pace-알차게'));
    expect(screen.getByTestId('settings-pref-pace-알차게')).toBeSelected();

    // 실행 ② — 그 사이 재요청으로 GET=B(타 기기가 styles 를 '미식'으로 바꿈) → 화면 view 가 B 로 갈린다.
    mockView = { styles: { value: ['미식'], isNeutralDefault: false } };
    rerender(<PreferencesEditScreen />);

    // 실행 ③ — 저장.
    fireEvent.press(screen.getByTestId('settings-pref-save'));

    // 단언 — 편집한 pace 만 실린다. 안 만진 styles 는 기준선(A) 대비 무변경이라 빠져야 한다.
    // 현재 구현은 기준선을 B 로 잡아 시드값 `['휴양']` 을 styles 로 실어 서버의 '미식'을 덮는다 → RED.
    // toStrictEqual 로 여분 축·undefined 키까지 잠근다(02a §5-B).
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toStrictEqual({ pace: '알차게' });
  });
});
