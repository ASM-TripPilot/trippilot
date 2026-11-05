import fc from 'fast-check';

import type { AddPhotoRequest } from '@/shared/api/index.schemas';
import type { PhotoAssetMeta } from '@/shared/photo';

import { attachPhotosInOrder } from './attachPhotosInOrder';

/**
 * TRIP-1797 · AC1·AC3·AC6·AC8 — 고른 사진을 **한 장씩 차례로** 서버에 등록하는 순수 루프.
 *
 * 무엇을 보장하나:
 *  - 순차: 앞 장의 요청이 끝나야 다음 장을 보낸다(동시에 둘 이상 날아가지 않는다) — 순서가 곧 서버의 사진 순서다.
 *  - 한 장이 실패해도 다음 장을 계속 보낸다. 결과는 성공한 자산·실패한 자산(입력 순서 보존)으로 나뉘고, 이 함수는 절대 throw 하지 않는다.
 *  - 진행: 장마다 요청 **직전**에 `(지금 순번, 전체)` 를 알린다(1부터).
 *  - 위치 동의는 인자 하나로 전 장에 같게 적용된다 — 꺼짐이면 좌표 키가 요청에 아예 없다(`photoAttach` 경유).
 *
 * 왜 이렇게 테스트하나: `Promise.all` 병렬 구현도 요청을 a,b,c 순으로 *시작*하므로 호출 순서만 보면 통과한다.
 *   그래서 `post` 안에서 "지금 진행 중인 요청 수"를 세어 최대치가 1 인지를 단언한다(동시 실행 최대 1).
 * (개념) `post` 는 주입 함수 — 진짜 네트워크 대신 우리가 만든 가짜를 끼워 순서·횟수를 관찰한다(DI).
 * 3동작: 준비(자산·가짜 post) → 실행(attachPhotosInOrder) → 단언(호출 순서·동시성·결과 분할).
 */

const asset = (id: string, withExif = false): PhotoAssetMeta => ({
  localAssetId: id,
  deviceId: 'dev-A',
  ...(withExif ? { exifLat: 35.1, exifLng: 129.1 } : {}),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 진행 중 수·호출 순서를 기록하는 가짜 post. failIds 에 든 자산은 reject. */
function makePost(failIds: string[] = []) {
  const calls: AddPhotoRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const post = async (req: AddPhotoRequest) => {
    calls.push(req);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(3);
    inFlight -= 1;
    if (failIds.includes(req.localAssetId)) throw new Error('boom');
    return {};
  };
  return { post, calls, maxInFlight: () => maxInFlight };
}

describe('attachPhotosInOrder', () => {
  it('S1 a,b,c 를 입력 순서대로 보내고 동시에 둘 이상 날리지 않는다', async () => {
    const { post, calls, maxInFlight } = makePost();

    const result = await attachPhotosInOrder(
      [asset('a'), asset('b'), asset('c')],
      false,
      post
    );

    expect(calls.map((c) => c.localAssetId)).toEqual(['a', 'b', 'c']);
    expect(maxInFlight()).toBe(1);
    expect(result).toEqual({
      succeeded: [asset('a'), asset('b'), asset('c')],
      failed: [],
    });
  });

  it('S2 가운데 한 장이 실패해도 끝 장까지 보내고, 실패는 밖으로 던지지 않고 failed 에 담는다', async () => {
    const { post, calls } = makePost(['b']);

    const result = await attachPhotosInOrder(
      [asset('a'), asset('b'), asset('c')],
      false,
      post
    );

    expect(calls).toHaveLength(3);
    expect(result.succeeded.map((a) => a.localAssetId)).toEqual(['a', 'c']);
    expect(result.failed.map((a) => a.localAssetId)).toEqual(['b']);
  });

  it('S3 장마다 요청 직전에 (순번, 전체) 를 1부터 알린다', async () => {
    const events: string[] = [];
    const post = async (req: AddPhotoRequest) => {
      events.push(`post:${req.localAssetId}`);
      return {};
    };

    await attachPhotosInOrder(
      [asset('a'), asset('b'), asset('c')],
      false,
      post,
      (current, total) => events.push(`progress:${current}/${total}`)
    );

    expect(events).toEqual([
      'progress:1/3',
      'post:a',
      'progress:2/3',
      'post:b',
      'progress:3/3',
      'post:c',
    ]);
  });

  it.each([
    ['동의 켜짐 → 모든 장에 좌표', true],
    ['동의 꺼짐 → 모든 장에서 좌표 키 자체가 없다', false],
  ])('S4 %s', async (_label, consent) => {
    const { post, calls } = makePost();

    await attachPhotosInOrder(
      [asset('a', true), asset('b', true)],
      consent,
      post
    );

    expect(calls).toHaveLength(2);
    for (const req of calls) {
      if (consent) {
        expect(req).toMatchObject({ exifLat: 35.1, exifLng: 129.1 });
      } else {
        expect(req).not.toHaveProperty('exifLat');
        expect(req).not.toHaveProperty('exifLng');
      }
    }
  });

  it('S5 빈 배열이면 요청도 진행 알림도 없고 빈 결과다', async () => {
    const post = jest.fn();
    const onProgress = jest.fn();

    const result = await attachPhotosInOrder([], false, post, onProgress);

    expect(post).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [] });
  });

  it('S6 성질: 어떤 실패 패턴에도 정확히 n 번 순서대로 보내고, 성공·실패가 입력의 순서 보존 분할이다', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 0, maxLength: 12 }),
        async (failMask) => {
          const assets = failMask.map((_, i) => asset(`x${i}`));
          const failIds = assets
            .filter((_, i) => failMask[i])
            .map((a) => a.localAssetId);
          const { post, calls } = makePost(failIds);

          const result = await attachPhotosInOrder(assets, false, post);

          expect(calls.map((c) => c.localAssetId)).toEqual(
            assets.map((a) => a.localAssetId)
          );
          expect(result.failed.map((a) => a.localAssetId)).toEqual(failIds);
          expect(result.succeeded.length + result.failed.length).toBe(
            assets.length
          );
        }
      ),
      {
        examples: [
          [[false, false, false]],
          [[true, true, true]],
          [[false, false, true]],
          [[]],
        ],
      }
    );
  });
});
