jest.mock('@/shared/api/generated/account/account');
jest.mock('@/shared/api/generated/profile/profile');

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AxiosError } from 'axios';
import { Share } from 'react-native';

import { DELETION_SCOPE } from '@/features/settings/model/deletionScope';
import {
  useDeleteMeDeletion,
  useGetMe,
  useGetMeExport,
  usePostMeDeletion,
} from '@/shared/api/generated/account/account';
import type { AccountExport } from '@/shared/api/generated/schemas';
import {
  useGetMeProfile,
  usePatchMeProfileNickname,
} from '@/shared/api/generated/profile/profile';

import { SettingsPage } from '..';

/**
 * TRIP-608 — l05 설정 배선 승인 테스트(딥 경로 목 seam).
 *
 * 무엇을 보장하나(AC): 2단 삭제 게이트(AC-12, **법적 최우선**) · 삭제 상태기(AC-3/4/10) ·
 * 닉네임 저장·오류(AC-2/7/8/9) · 내보내기 잘림 표면화+핸드오프(AC-5).
 *
 * 왜 페이지 층인가: 이 AC 들은 훅 응답 → 상태 전이 → 화면이라는 **배선**의 성질이다. 화면(순수)만
 * 으로도, 순수 함수만으로도 표현할 수 없다 — 목 훅으로 서버 응답을 주입하고 실제 페이지를 렌더해
 * 잠근다.
 *
 * ★ 목 seam은 **딥 경로**(`@/shared/api/generated/{account,profile}/*`)다 — 배럴 목이면 실 훅이
 *   돌아 QueryClient 부재로 죽는다(explore 선례). 뮤테이션 목은 **옵션 캡처형**이라 mutate 가
 *   `opts.mutation.onSuccess/onError` 를 동기 발화한다 — 페이지가 그 콜백을 물었는지(상태 전이)까지
 *   관측된다. 단순 `{mutate:jest.fn()}` 목이면 AC-3/4/8/9/10 전이가 원리적으로 안 뜬다.
 *
 * ⚠️ jest 사각(6-b 실기 전용): 딤이 실제로 화면을 덮나·2단 모달이 실제로 뜨나. 여기선 다이얼로그를
 *   조건부 렌더로 보고 testID 존재/부재 + mutate 시퀀스로만 잠근다(리포 Modal 선례 0).
 *
 * (개념) 매처 — 완전값 leaf(요약 `여행자123`/`새이름`, 그룹 라벨, `DELETION_SCOPE[0]`)는 문자열
 *  인자(완전일치), 상위 텍스트에 더 붙는 것(오류 카피·purgeAt 연도·export 문구)은 정규식(부분포함).
 *  node_modules 실측(02a §5-A).
 */

const mockUseGetMe = useGetMe as jest.Mock;
const mockUseGetMeProfile = useGetMeProfile as jest.Mock;
const mockUsePostMeDeletion = usePostMeDeletion as jest.Mock;
const mockUseDeleteMeDeletion = useDeleteMeDeletion as jest.Mock;
const mockUsePatchNickname = usePatchMeProfileNickname as jest.Mock;
const mockUseGetMeExport = useGetMeExport as jest.Mock;

/** `isAxiosError` 가 true 여야 페이지의 상태 판정(`isNotFound` 등)이 도는 경로를 탄다. */
function httpError(status: number): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

function makeExport(overrides: {
  truncatedSections: string[];
  sections: string[];
}): AccountExport {
  return {
    accountId: 'acc-1',
    exportedAt: '2026-08-30T00:00:00Z',
    sectionLimit: 500,
    truncatedSections: overrides.truncatedSections,
    sections: overrides.sections.map((section) => ({
      section,
      items: [],
      truncated: false,
    })),
  };
}

/**
 * 옵션 캡처형 뮤테이션 목 — mutate 호출 시 spy 를 찍고, error 면 onError, 아니면 onSuccess 를
 * 페이지가 넘긴 콜백으로 동기 발화한다.
 */
function primeMutation(
  hook: jest.Mock,
  opts: { spy?: jest.Mock; onSuccessData?: unknown; error?: unknown }
) {
  hook.mockImplementation(
    (options?: {
      mutation?: {
        onSuccess?: (data: unknown, vars: unknown, ctx: unknown) => void;
        onError?: (error: unknown, vars: unknown, ctx: unknown) => void;
      };
    }) => ({
      isPending: false,
      mutate: (vars?: unknown) => {
        opts.spy?.(vars);
        if (opts.error) {
          options?.mutation?.onError?.(opts.error, vars, undefined);
        } else {
          options?.mutation?.onSuccess?.(opts.onSuccessData, vars, undefined);
        }
      },
    })
  );
}

function primeAccount(
  status: 'ACTIVE' | 'DELETION_PENDING',
  email: string | null
) {
  mockUseGetMe.mockReturnValue({
    data: {
      accountId: 'acc-1',
      status,
      email,
      socialProviders: ['KAKAO'],
      onboardingCompleted: true,
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  primeAccount('ACTIVE', 'a@b.com');
  mockUseGetMeProfile.mockReturnValue({
    data: { nickname: '여행자123', nicknameUpdatedAt: '2026-01-01T00:00:00Z' },
  });
  primeMutation(mockUsePostMeDeletion, {
    onSuccessData: { purgeAt: '2026-09-13T00:00:00Z', cascadeSummary: {} },
  });
  primeMutation(mockUseDeleteMeDeletion, { onSuccessData: undefined });
  primeMutation(mockUsePatchNickname, {
    onSuccessData: { nickname: '여행자123', nicknameUpdatedAt: 'x' },
  });
  mockUseGetMeExport.mockReturnValue({
    refetch: jest.fn().mockResolvedValue({
      data: makeExport({ truncatedSections: [], sections: [] }),
    }),
  });
});

describe('TRIP-608 · 2단 삭제 게이트 (AC-12 · 법적)', () => {
  it('1단 [계속] 뒤 POST 미발화, 2단 [계정 삭제] 뒤 정확히 1회', () => {
    const postSpy = jest.fn();
    primeMutation(mockUsePostMeDeletion, {
      spy: postSpy,
      onSuccessData: { purgeAt: '2026-09-13T00:00:00Z', cascadeSummary: {} },
    });
    render(<SettingsPage />);

    // 실행: 삭제 진입 → 1단 [계속].
    fireEvent.press(screen.getByTestId('settings-delete-account'));
    fireEvent.press(screen.getByTestId('settings-delete-confirm'));

    // 단언(급소): 1단만으로는 POST 가 나가지 않는다.
    expect(postSpy).not.toHaveBeenCalled();

    // 실행: 2단 최종 확인.
    fireEvent.press(screen.getByTestId('settings-delete-confirm-final'));

    // 단언: 2단 확정 뒤에만, 정확히 한 번.
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('1단 다이얼로그가 deletionScope 전체 목록을 고지한다(Q1)', () => {
    render(<SettingsPage />);
    fireEvent.press(screen.getByTestId('settings-delete-account'));

    // 단언(전량·완전일치): Figma 3항목 축약이 아니라 deletionScope.ts 실제 목록 전량을 그린다.
    // 첫 항목만 확인하면(구 DELETION_SCOPE[0]) 목록을 slice 로 줄여도 통과해 법적 '덜 고지'가
    // 초록으로 샌다 — 되돌릴 수 없는 삭제라 각 항목을 개별로 잠근다.
    DELETION_SCOPE.forEach((item) => {
      expect(screen.getByText(item)).toBeOnTheScreen();
    });
    expect(screen.getByTestId('settings-delete-confirm')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-delete-cancel')).toBeOnTheScreen();
  });

  it('1단에서 취소하면 POST 를 안 낸다(AC-12 짝 · 1단)', () => {
    const postSpy = jest.fn();
    primeMutation(mockUsePostMeDeletion, { spy: postSpy });
    render(<SettingsPage />);

    fireEvent.press(screen.getByTestId('settings-delete-account'));
    fireEvent.press(screen.getByTestId('settings-delete-cancel'));

    // 단언: POST 미발화 + 다이얼로그 접힘.
    expect(postSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-delete-confirm')).toBeNull();
  });

  it('2단(최종 확인)에서 취소하면 POST 를 안 낸다(AC-12 짝 · 2단)', () => {
    const postSpy = jest.fn();
    primeMutation(mockUsePostMeDeletion, { spy: postSpy });
    render(<SettingsPage />);

    // 실행: 삭제 진입 → 1단 [계속]으로 2단 전이 → 2단 [취소].
    // 1단·2단 취소 버튼은 testID 가 같지만 조건부 렌더라 공존하지 않는다 — step2 전이 뒤엔
    // getByTestId 가 2단 취소를 집는다(사용자가 오삭제에 가장 가까운 지점).
    fireEvent.press(screen.getByTestId('settings-delete-account'));
    fireEvent.press(screen.getByTestId('settings-delete-confirm'));
    fireEvent.press(screen.getByTestId('settings-delete-cancel'));

    // 단언(급소): 2단에서 취소한 사용자는 삭제되지 않는다 — POST 미발화 + 2단 다이얼로그 접힘.
    expect(postSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-delete-confirm-final')).toBeNull();
  });
});

describe('TRIP-608 · 삭제 상태기 (AC-3 · AC-4 · AC-10)', () => {
  it('AC-3: 2단 확정 200 → DELETION_PENDING · purgeAt · [삭제 철회]', () => {
    primeMutation(mockUsePostMeDeletion, {
      spy: jest.fn(),
      onSuccessData: { purgeAt: '2026-09-13T00:00:00Z', cascadeSummary: {} },
    });
    render(<SettingsPage />);

    fireEvent.press(screen.getByTestId('settings-delete-account'));
    fireEvent.press(screen.getByTestId('settings-delete-confirm'));
    fireEvent.press(screen.getByTestId('settings-delete-confirm-final'));

    // 단언: 유예 상태로 전환 + 철회 어포던스 + purgeAt(연도만 부분포함 — 서식은 구현 재량).
    expect(screen.getByTestId('settings-deletion-pending')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-deletion-cancel')).toBeOnTheScreen();
    expect(screen.getByText(/2026/)).toBeOnTheScreen();
  });

  it('AC-4: 철회 200 → ACTIVE 복귀', () => {
    // 준비: 이미 유예 상태로 진입한 세션.
    primeAccount('DELETION_PENDING', 'a@b.com');
    const delSpy = jest.fn();
    primeMutation(mockUseDeleteMeDeletion, {
      spy: delSpy,
      onSuccessData: undefined,
    });
    render(<SettingsPage />);

    // 실행: 삭제 철회.
    fireEvent.press(screen.getByTestId('settings-deletion-cancel'));

    // 단언: DELETE 1회 + 유예 배너 사라짐 + 삭제 진입행 복귀.
    expect(delSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('settings-deletion-pending')).toBeNull();
    expect(screen.getByTestId('settings-delete-account')).toBeOnTheScreen();
  });

  it('AC-10: 철회 404 → 안내(침묵 금지), 유예 유지', () => {
    primeAccount('DELETION_PENDING', 'a@b.com');
    primeMutation(mockUseDeleteMeDeletion, {
      spy: jest.fn(),
      error: httpError(404),
    });
    render(<SettingsPage />);

    fireEvent.press(screen.getByTestId('settings-deletion-cancel'));

    // 단언: 404 는 "유예 없음"이지 성공이 아니다 — 안내를 띄우고 유예 상태를 유지한다.
    expect(
      screen.getByTestId('settings-deletion-cancel-error')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('settings-deletion-pending')).toBeOnTheScreen();
  });
});

describe('TRIP-608 · 닉네임 (AC-2 · AC-7 · AC-8 · AC-9)', () => {
  it('AC-7: 길이 밖(2자 미만)이면 PATCH 미발화 + 인라인 오류', () => {
    const patchSpy = jest.fn();
    primeMutation(mockUsePatchNickname, { spy: patchSpy });
    render(<SettingsPage />);

    // 실행: 편집 확장 → 1자 입력 → 저장.
    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    fireEvent.changeText(screen.getByTestId('settings-nickname-input'), '가');
    fireEvent.press(screen.getByTestId('settings-nickname-save'));

    // 단언(급소): 클라 길이 검증이 먼저 막아 요청이 나가지 않는다.
    expect(patchSpy).not.toHaveBeenCalled();
    // 단언: 인라인 오류를 명시한다(침묵 금지).
    expect(screen.getByTestId('settings-nickname-error')).toBeOnTheScreen();
  });

  it('AC-2: 2~20자면 PATCH 발화 + 200 시 요약 갱신', () => {
    const patchSpy = jest.fn();
    primeMutation(mockUsePatchNickname, {
      spy: patchSpy,
      onSuccessData: { nickname: '새이름', nicknameUpdatedAt: 'x' },
    });
    render(<SettingsPage />);

    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    fireEvent.changeText(
      screen.getByTestId('settings-nickname-input'),
      '새이름'
    );
    fireEvent.press(screen.getByTestId('settings-nickname-save'));

    // 단언: 서버 계약대로 { data: { nickname } } 로 정확히 1회.
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith({ data: { nickname: '새이름' } });
    // 단언(완전일치): 200 뒤 요약값이 새 닉네임으로 갱신된다.
    expect(screen.getByText('새이름')).toBeOnTheScreen();
  });

  it('AC-8: 409 NicknameTaken → "이미 사용 중" 인라인, 요약 미변경', () => {
    primeMutation(mockUsePatchNickname, {
      spy: jest.fn(),
      error: httpError(409),
    });
    render(<SettingsPage />);

    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    fireEvent.changeText(
      screen.getByTestId('settings-nickname-input'),
      '중복이름'
    );
    fireEvent.press(screen.getByTestId('settings-nickname-save'));

    // 단언(부분포함): 중복 안내(정확 카피는 구현 재량).
    expect(screen.getByText(/이미 사용 중/)).toBeOnTheScreen();
    // 단언(완전일치): 요약값은 바뀌지 않는다 — 서버가 거부했으므로.
    expect(screen.getByText('여행자123')).toBeOnTheScreen();
  });

  it('AC-9: 503 ModerationUnavailable → 모더레이션 불가 인라인', () => {
    primeMutation(mockUsePatchNickname, {
      spy: jest.fn(),
      error: httpError(503),
    });
    render(<SettingsPage />);

    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    fireEvent.changeText(
      screen.getByTestId('settings-nickname-input'),
      '검토중이름'
    );
    fireEvent.press(screen.getByTestId('settings-nickname-save'));

    // 단언: 인라인 오류 컨테이너 + 모더레이션 계열 문구(정확 카피 미고정, 부분포함).
    expect(screen.getByTestId('settings-nickname-error')).toBeOnTheScreen();
    expect(screen.getByText(/모더레이션|검토|확인할 수 없/)).toBeOnTheScreen();
  });
});

describe('TRIP-608 · 내보내기 (AC-5 · INV-4)', () => {
  it('내보내기 누르면 잘린 목록을 표면화하고 Share 로 넘긴다', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({
      action: 'sharedAction',
    } as never);
    mockUseGetMeExport.mockReturnValue({
      refetch: jest.fn().mockResolvedValue({
        data: makeExport({
          truncatedSections: ['photos'],
          sections: ['trips', 'photos'],
        }),
      }),
    });
    render(<SettingsPage />);

    // 실행: 내보내기 행을 누른다(지연 조회 → 요약·Share).
    fireEvent.press(screen.getByTestId('settings-export-row'));

    // 단언: Share 로 핸드오프(메시지 문자열).
    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    // 단언(부분포함): 잘린 몫을 조용히 삼키지 않고 표면화한다(INV-4).
    expect(screen.getByTestId('settings-export-truncated')).toHaveTextContent(
      /photos/
    );

    shareSpy.mockRestore();
  });

  it('잘린 항목이 없으면 잘림 고지 미표시(성공만)', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({
      action: 'sharedAction',
    } as never);
    mockUseGetMeExport.mockReturnValue({
      refetch: jest.fn().mockResolvedValue({
        data: makeExport({ truncatedSections: [], sections: ['trips'] }),
      }),
    });
    render(<SettingsPage />);

    fireEvent.press(screen.getByTestId('settings-export-row'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    // 단언(없어야 한다): 잘린 게 없으면 고지가 안 뜬다.
    expect(screen.queryByTestId('settings-export-truncated')).toBeNull();

    shareSpy.mockRestore();
  });
});
