import type { ReactElement } from 'react';
import { Linking, Text } from 'react-native';
import {
  focusManager,
  onlineManager,
  useQueries,
  useQuery,
} from '@tanstack/react-query';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';

import { createAppQueryClient } from '@/app/entrypoint/queryClient';
import { pickPhotoAssets } from '@/shared/photo';
import {
  PhotoAccessNotice,
  photoUriQueryOptions,
} from '@/shared/photo/index.view';
import { resetFakeFs, seedCacheFile } from '@/test-support/fakeExpoFileSystem';
import { createWrapper, settle } from '@/test-support/queryRender';

/**
 * TRIP-1803 · 사진 복귀 재조회 — **앱과 같은 쿼리 기본값**(`createAppQueryClient`)에서 진짜 `shared/photo` 를 돌린다.
 * 왜 여기인가: 앱 기본 `staleTime` 30초와 `refetchOnWindowFocus` 거부 목록이 이 결함의 심판 조건인데, pages·shared 테스트는 `@/app` 을
 * import 못 한다(린트). 화면 파일들은 값만 맞춘 클라이언트를 쓰고, 그 값이 앱과 같은 뜻인지를 이 파일이 잇는다.
 *
 * 무엇을 보장하나:
 *  - AC-1 limited 로 고른 세 장이 쿼리 옵션을 거쳐 화면에 세 주소로 나온다.
 *  - AC-2·E-3 앱 복귀 때 못 풀던 사진만 다시 묻고, 풀린 사진은 다시 안 묻는다(iCloud 내려받기 폭주 방지).
 *  - AC-2 권한을 넓히고 돌아오면 안내가 사라진다.
 *  - 앱의 복귀 거부 목록에 사진 키가 없다.
 *  - `photoUriQueryOptions` 는 네 소비처가 캐시를 나눠 쓰는 키로 사진을 푼다.
 *  - `PhotoAccessNotice` 는 "선택한 사진만"·거부일 때만 문구 + 사용자가 누르는 [설정 열기] 를 그린다. 팝업 0.
 *    전체 허용·아직 안 물어봄·응답 전에는 안 그린다. 권한 조회는 네트워크와 무관해 오프라인에도 돈다.
 *
 * (개념) `focusManager.setFocused(false→true)` = "앱이 뒤로 갔다 앞으로 왔다" 흉내. 실제 AppState 연결은 jest 사각(기능 지도).
 * 3동작: 준비(권한·앨범 응답) → 실행(렌더·복귀) → 단언(화면·앨범 조회 횟수).
 */

const mockMlGet = jest.fn();
const mockMlRequest = jest.fn();
const mockAssetInfo = jest.fn();
const mockLaunch = jest.fn();
jest.mock('expo-media-library', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockMlGet(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockMlRequest(...args),
  getAssetInfoAsync: (...args: unknown[]) => mockAssetInfo(...args),
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunch(...args),
}));
jest.mock('@/shared/storage/installId', () => ({
  getInstallId: jest.fn().mockResolvedValue('me'),
}));
jest.mock(
  'expo-file-system',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/test-support/fakeExpoFileSystem').fakeExpoFileSystemModule
);

const LIMITED = {
  granted: true,
  status: 'granted',
  accessPrivileges: 'limited',
};
const ALL = { granted: true, status: 'granted', accessPrivileges: 'all' };
const DENIED = { granted: false, status: 'denied', accessPrivileges: 'none' };
const UNDETERMINED = {
  granted: false,
  status: 'undetermined',
  accessPrivileges: 'none',
};
const NOTICE = 'resume-notice';
const COPY_LIMITED =
  '사진 접근이 "선택한 사진만"으로 제한돼 있어요. 접근 범위는 설정에서 바꿀 수 있어요';
const COPY_DENIED = '사진 접근 권한이 없어 사진을 불러올 수 없어요';

function Uris({ ids }: { ids: string[] }) {
  const results = useQueries({
    queries: ids.map((id) => photoUriQueryOptions(id)),
  });
  return (
    <>
      {ids.map((id, i) => (
        <Text key={id} testID={`uri-${id}`}>
          {String(results[i]?.data)}
        </Text>
      ))}
    </>
  );
}

const renderOnAppClient = (ui: ReactElement) =>
  render(ui, { wrapper: createWrapper(createAppQueryClient()) });

const albumCalls = (id: string) =>
  mockAssetInfo.mock.calls.filter(([arg]) => arg === id).length;

function comeBack() {
  act(() => focusManager.setFocused(false));
  act(() => focusManager.setFocused(true));
}

beforeEach(() => {
  mockMlGet.mockReset().mockResolvedValue(LIMITED);
  mockMlRequest.mockReset().mockResolvedValue(LIMITED);
  mockAssetInfo.mockReset().mockResolvedValue(null);
  mockLaunch.mockReset();
});
// 셋 다 모듈 싱글턴 — 파일 최상위에서 되돌린다.
afterEach(() => {
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  resetFakeFs();
});

describe('🔴 TRIP-1803 · 앱 기본값에서 복귀 재조회', () => {
  it('A1 (AC-1) limited 로 고른 세 장이 앨범 밖이어도 세 주소로 나온다', async () => {
    for (const id of ['a', 'b', 'c']) {
      seedCacheFile('ImagePicker', `${id}.jpg`, `bytes-${id}`);
    }
    mockLaunch.mockResolvedValue({
      canceled: false,
      assets: ['a', 'b', 'c'].map((assetId) => ({
        assetId,
        uri: `file:///cache/ImagePicker/${assetId}.jpg`,
      })),
    });

    const result = await pickPhotoAssets({ limit: 10 });
    renderOnAppClient(<Uris ids={['a', 'b', 'c']} />);

    expect(result.kind).toBe('picked');
    for (const id of ['a', 'b', 'c']) {
      await waitFor(() =>
        expect(screen.getByTestId(`uri-${id}`)).toHaveTextContent(/^file:/)
      );
    }
  });

  it('A2 (AC-2 · E-3) 넓히고 복귀하면 못 풀던 사진만 다시 물어 재시작 없이 풀린다', async () => {
    // 준비 — a 는 풀리고 b 는 못 푼다(사본 없음).
    mockAssetInfo.mockImplementation(async (id: string) =>
      id === 'a' ? { localUri: 'file:///photos/a.jpg' } : null
    );
    renderOnAppClient(<Uris ids={['a', 'b']} />);
    await waitFor(() =>
      expect(screen.getByTestId('uri-b')).toHaveTextContent('null')
    );
    expect(screen.getByTestId('uri-a')).toHaveTextContent(
      'file:///photos/a.jpg'
    );

    // 설정에서 넓혔다 — 아직 복귀 전이라 다시 묻지 않는다.
    mockMlGet.mockResolvedValue(ALL);
    mockAssetInfo.mockImplementation(async (id: string) => ({
      localUri: `file:///photos/${id}.jpg`,
    }));
    await settle();
    expect(albumCalls('b')).toBe(1);

    // 실행
    comeBack();

    // 단언
    await waitFor(() =>
      expect(screen.getByTestId('uri-b')).toHaveTextContent(
        'file:///photos/b.jpg'
      )
    );
    expect(albumCalls('b')).toBe(2);
    expect(albumCalls('a')).toBe(1);
  });

  it('A3 (AC-2) 권한을 넓히고 복귀하면 안내가 사라진다', async () => {
    renderOnAppClient(<PhotoAccessNotice testID={NOTICE} />);
    expect(await screen.findByTestId(`${NOTICE}-settings`)).toBeOnTheScreen();

    mockMlGet.mockResolvedValue(ALL);
    comeBack();

    await waitFor(() =>
      expect(screen.queryByTestId(`${NOTICE}-settings`)).toBeNull()
    );
  });

  it('A4 앱의 복귀 거부 목록에 사진 키가 없다 (`/me` 는 거부 — 짝)', () => {
    const decide = createAppQueryClient().getDefaultOptions().queries
      ?.refetchOnWindowFocus as unknown as (query: {
      queryKey: unknown[];
    }) => boolean;

    expect(decide({ queryKey: ['photo-uri', 'a'] })).toBe(true);
    expect(decide({ queryKey: ['photo-access'] })).toBe(true);
    expect(decide({ queryKey: ['trip-cover-photo', 't', []] })).toBe(true);
    expect(decide({ queryKey: ['/me'] })).toBe(false);
  });
});

describe('🔴 TRIP-1803 · photoUriQueryOptions', () => {
  it('V1 네 소비처가 나눠 쓰는 키로 앨범 주소를 캐시에 둔다', async () => {
    mockAssetInfo.mockResolvedValue({ localUri: 'file:///photos/a.jpg' });
    function Probe() {
      const q = useQuery(photoUriQueryOptions('a'));
      return <Text testID="uri">{String(q.data)}</Text>;
    }
    const client = createAppQueryClient();

    render(<Probe />, { wrapper: createWrapper(client) });

    await waitFor(() =>
      expect(screen.getByTestId('uri')).toHaveTextContent(
        'file:///photos/a.jpg'
      )
    );
    expect(client.getQueryData(['photo-uri', 'a'])).toBe(
      'file:///photos/a.jpg'
    );
  });
});

describe('🔴 TRIP-1803 · PhotoAccessNotice (AC-3 · D5)', () => {
  const notice = <PhotoAccessNotice testID={NOTICE} />;

  it('N1 선택한 사진만 → 문구 + [설정 열기], 누르면 설정 1회, 권한 요청 0회', async () => {
    const openSettings = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderOnAppClient(notice);

    expect(await screen.findByText(COPY_LIMITED)).toBeOnTheScreen();
    expect(screen.getByTestId(NOTICE)).toBeOnTheScreen();
    await user.press(screen.getByTestId(`${NOTICE}-settings`));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(mockMlRequest).not.toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it('N2 (E-5) 거부 → 거부 문구 + [설정 열기], 권한 요청 0회', async () => {
    mockMlGet.mockResolvedValue(DENIED);

    renderOnAppClient(notice);

    expect(await screen.findByText(COPY_DENIED)).toBeOnTheScreen();
    expect(screen.getByTestId(`${NOTICE}-settings`)).toBeOnTheScreen();
    expect(mockMlRequest).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['전체 허용', ALL],
    ['아직 안 물어봄', UNDETERMINED],
  ])('N3 %s → 조회가 끝나도 안내·버튼이 없다', async (_label, permission) => {
    mockMlGet.mockResolvedValue(permission);

    renderOnAppClient(notice);
    await waitFor(() => expect(mockMlGet).toHaveBeenCalledTimes(1));
    await settle();

    expect(screen.queryByTestId(NOTICE)).toBeNull();
    expect(screen.queryByTestId(`${NOTICE}-settings`)).toBeNull();
  });

  it('N4 권한 응답이 오기 전에는 안 그리고, 오면 그린다', async () => {
    let answer: (value: typeof LIMITED) => void = () => {};
    mockMlGet.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );

    renderOnAppClient(notice);
    await settle();
    expect(screen.queryByTestId(`${NOTICE}-settings`)).toBeNull();

    await act(async () => answer(LIMITED));

    expect(await screen.findByTestId(`${NOTICE}-settings`)).toBeOnTheScreen();
  });

  it('N5 오프라인이어도 권한 조회는 돌아 안내가 선다', async () => {
    onlineManager.setOnline(false);
    expect(onlineManager.isOnline()).toBe(false);

    renderOnAppClient(notice);

    expect(await screen.findByText(COPY_LIMITED)).toBeOnTheScreen();
  });
});
