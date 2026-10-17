import { readIdSet, writeIdSet } from '@/shared/storage';
import {
  markDoneBarSeen,
  readDoneBarSeen,
  writeDoneBarSeen,
} from '@/entities/trip';

/**
 * TRIP-1428 · 완료 배너 "이미 알린 여행" 집합(seen)의 공개 창구 — 목록 페이지와 확정 훅이 같은 저장 키를 쓰게
 * pages 밖(entities/trip)으로 내렸다(01b Q2).
 *
 * 무엇을 보장하나:
 *  - 저장 키는 `itinerary.doneBar.seen` 그대로다 — 바꾸면 기존 기기의 seen 이 버려져 확정한 여행 전부에 배너가
 *    다시 뜬다(01 Q2). 읽기·쓰기·더하기 셋 다 이 키 하나만 쓴다.
 *  - 저장은 `@/shared/storage` 의 id 집합 저장소(readIdSet/writeIdSet)를 거친다 — 목록 통합 테스트가 그 모듈
 *    경로를 목으로 바꿔 보므로, SecureStore 를 직접 부르면 그 심판을 비켜 간다(01 맹점 ①).
 *  - `markDoneBarSeen` 은 합집합이다(기존 id 보존 · 중복 없음). 읽기가 실패하면 쓰지 않는다(덮어써 잃지 않게).
 *    어떤 실패에도 거절·throw 하지 않는다 — 확정 성공 콜백 안에서 불린다.
 *  - 읽기·쓰기 실패는 `readDoneBarSeen`·`writeDoneBarSeen` 에선 그대로 거절된다(목록이 "읽기 실패 = 배너 없음"으로 닫는다).
 *
 * 3동작: 준비(저장소 메모리) → 실행(함수 호출) → 단언(저장소에 남은 값·키).
 */

// 모듈 경로를 목으로 바꾸면 배럴(`@/shared/storage`)도 이 목을 재수출한다 — 구현이 어느 경로로 import 하든 같은 가짜.
jest.mock('@/shared/storage/idSet', () => ({
  readIdSet: jest.fn(),
  writeIdSet: jest.fn(),
}));

const SEEN_KEY = 'itinerary.doneBar.seen';
/** 저장소 한 칸(키 → 값). 다른 키에 쓰면 여기 따로 남아 "다른 키에 썼다"가 드러난다. */
let store: Record<string, string[]> = {};

beforeEach(() => {
  store = {};
  (readIdSet as jest.Mock)
    .mockReset()
    .mockImplementation(async (key: string) => [...(store[key] ?? [])]);
  (writeIdSet as jest.Mock)
    .mockReset()
    .mockImplementation(async (key: string, ids: readonly string[]) => {
      store[key] = [...ids];
    });
});

describe('readDoneBarSeen · writeDoneBarSeen — 키 itinerary.doneBar.seen 그대로', () => {
  it('읽기는 그 키의 값을 그대로 돌려준다', async () => {
    store[SEEN_KEY] = ['a', 'b'];

    await expect(readDoneBarSeen()).resolves.toEqual(['a', 'b']);
    expect(readIdSet).toHaveBeenCalledWith(SEEN_KEY);
  });

  it('쓰기는 그 키에 받은 목록을 통째로 쓴다', async () => {
    await writeDoneBarSeen(['x', 'y']);

    expect(writeIdSet).toHaveBeenCalledTimes(1);
    expect(writeIdSet).toHaveBeenCalledWith(SEEN_KEY, ['x', 'y']);
    expect(store).toEqual({ [SEEN_KEY]: ['x', 'y'] });
  });

  it('읽기·쓰기 실패는 삼키지 않고 그대로 거절한다 (목록이 "배너 없음"으로 닫는 근거)', async () => {
    (readIdSet as jest.Mock).mockRejectedValue(new Error('keychain'));
    (writeIdSet as jest.Mock).mockRejectedValue(new Error('keychain'));

    await expect(readDoneBarSeen()).rejects.toThrow('keychain');
    await expect(writeDoneBarSeen(['x'])).rejects.toThrow('keychain');
  });
});

describe('markDoneBarSeen — 여행 하나를 seen 에 더한다(합집합)', () => {
  it.each<[string, string[] | undefined, string, string[]]>([
    ['처음(저장값 없음)', undefined, 't1', ['t1']],
    ['다른 여행이 이미 있으면 남긴다', ['a', 'b'], 't1', ['a', 'b', 't1']],
    ['이미 있으면 두 번 넣지 않는다', ['a', 't1'], 't1', ['a', 't1']],
  ])('%s', async (_label, before, tripId, after) => {
    // 준비
    if (before) store[SEEN_KEY] = before;

    // 실행
    await markDoneBarSeen(tripId);

    // 단언 — 그 키 하나에만, 순서 무관 집합으로.
    expect(Object.keys(store)).toEqual([SEEN_KEY]);
    expect([...store[SEEN_KEY]].sort()).toEqual([...after].sort());
  });

  it('읽기가 실패하면 쓰지 않는다 — 이미 알린 여행들을 [t1] 하나로 덮어쓰지 않는다', async () => {
    store[SEEN_KEY] = ['a'];
    (readIdSet as jest.Mock).mockRejectedValue(new Error('keychain'));

    await expect(markDoneBarSeen('t1')).resolves.toBeUndefined();

    expect(writeIdSet).not.toHaveBeenCalled();
    expect(store[SEEN_KEY]).toEqual(['a']);
  });

  it.each<[string, () => void]>([
    [
      '읽기가 동기로 던져도',
      () =>
        (readIdSet as jest.Mock).mockImplementation(() => {
          throw new Error('keychain');
        }),
    ],
    [
      '쓰기가 거절돼도',
      () => (writeIdSet as jest.Mock).mockRejectedValue(new Error('keychain')),
    ],
  ])('%s 거절·throw 없이 끝난다', async (_label, breakStorage) => {
    breakStorage();

    let result: Promise<void> | undefined;
    expect(() => {
      result = markDoneBarSeen('t1');
    }).not.toThrow();
    await expect(result).resolves.toBeUndefined();
  });
});
