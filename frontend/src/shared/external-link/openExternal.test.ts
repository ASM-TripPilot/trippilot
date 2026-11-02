import * as Linking from 'expo-linking';

import { openAppSettings, openExternal } from '@/shared/external-link';

/**
 * TRIP-1684 · AC4-b·c — 앱(iOS/Android) 쪽 외부 열기 헬퍼. 호출부 15곳이 `Linking` 을 직접 부르던 것을 이 한 벌로 모았지만
 * **앱 동작은 한 글자도 안 바뀐다**는 것을 못 박는다.
 *
 * 무엇을 보장하나:
 *  - `openExternal(url)` 은 `expo-linking.openURL` 을 인자 그대로 1번, **첫 `await` 전에** 부른다. 거절은 삼키지 않고 호출자에게 그대로
 *    전달한다(호출부 사다리가 이 거절로 앱 → 웹 → 안내로 강등한다). `canOpenURL` 은 부르지 않는다(iOS 네이티브 등록이 필요해서).
 *  - 목이 값을 안 돌려줘도(`jest.fn()` 기본 `undefined`) 항상 Promise 를 돌려준다 — 호출부가 `.catch(...)` 를 바로 붙인다.
 *  - `openAppSettings()` 도 `openSettings` 를 1번 부르고 거절을 그대로 전달한다.
 *  - 앱 번들에 웹 안내(Toast)가 딸려 들어오지 않는다(웹 파일 전용 의존).
 *
 * (개념) `jest.mock('expo-linking', 팩토리)` = 그 모듈을 가짜로 통째 치환. 기존 테스트 15개가 같은 방식이라 헬퍼도 `react-native` 가
 *   아니라 `expo-linking` 을 import 해야 그 가짜가 닿는다.
 * 3동작 뼈대: 준비(가짜 Linking 세팅) → 실행(헬퍼 호출) → 단언(가짜가 받은 인자·횟수, 돌려받은 Promise).
 */

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
  openSettings: jest.fn(),
}));
// 앱 헬퍼가 Toast 를 끌어오면 불러오는 순간 터진다 — 앱 번들 무변경(AC4-f)의 동작 쪽 증거.
jest.mock('@/shared/ui/Toast', () => {
  throw new Error('앱 외부 열기 헬퍼는 @/shared/ui/Toast 를 불러오면 안 된다');
});

const mockOpenURL = Linking.openURL as jest.Mock;
const mockOpenSettings = Linking.openSettings as jest.Mock;
const mockCanOpenURL = Linking.canOpenURL as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
});

describe('openExternal (앱)', () => {
  it('openURL 을 인자 그대로 1번, 첫 await 전에(동기로) 부른다 · canOpenURL 은 안 부른다', async () => {
    mockOpenURL.mockResolvedValue(true);
    const url = 'nmap://place?lat=35.1&lng=129.1&name=%EA%B4%91&appname=x';

    const pending = openExternal(url);

    // await 하기 전 — 누름 직후 동기로 단언하는 기존 테스트(fireEvent.press 뒤 toHaveBeenCalledTimes(1))가 기대는 시점.
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(url);
    await pending;
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockCanOpenURL).not.toHaveBeenCalled();
  });

  it('openURL 이 거절하면 그 에러 그대로 거절한다 — 삼키지 않는다(사다리 강등의 신호)', async () => {
    const boom = new Error('처리할 앱 없음');
    mockOpenURL.mockRejectedValue(boom);

    await expect(openExternal('nmap://route/public?x=1')).rejects.toBe(boom);
  });

  it('가짜가 아무것도 안 돌려줘도(undefined) 항상 Promise 를 돌려준다 — 호출부의 .catch 가 안 터진다', async () => {
    mockOpenURL.mockReturnValue(undefined);

    const result = openExternal('https://www.openstreetmap.org/copyright');

    expect(result).toBeInstanceOf(Promise);
    await expect(result.catch(() => undefined)).resolves.toBeUndefined();
  });
});

describe('openAppSettings (앱)', () => {
  it('openSettings 를 1번 부른다 · openURL·canOpenURL 은 안 부른다', async () => {
    mockOpenSettings.mockResolvedValue(undefined);

    await openAppSettings();

    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockCanOpenURL).not.toHaveBeenCalled();
  });

  it('동기로 부르고(누름 직후 단언 가능), 거절은 그대로 전달한다 · 가짜가 undefined 여도 Promise', async () => {
    mockOpenSettings.mockReturnValueOnce(undefined);
    const first = openAppSettings();
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    expect(first).toBeInstanceOf(Promise);
    await first;

    const boom = new Error('설정 열기 실패');
    mockOpenSettings.mockRejectedValueOnce(boom);
    await expect(openAppSettings()).rejects.toBe(boom);
  });
});
