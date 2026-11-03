import * as fc from 'fast-check';

import {
  parseReflectionPayload,
  sceneKind,
  slotUri,
} from './reflectionPayload';

/**
 * 회고 카드 payload(JSON 문자열) 해석 — 장면(TRIP-1445)에 표지·해시태그·사건 출처(TRIP-1665)를 더했다.
 * 와이어 정본은 `ai/docs/openapi.json` 의 SceneSchema·CoverSchema·ReflectionGenerateResponse.
 * 초심자용: "파서"는 문자열을 읽어 쓸 수 있는 값으로 바꾸는 함수다. 어디가 깨져도 던지지 않고 빈 결과를 낸다.
 *
 * 무엇을 보장하나(AC-2):
 *  - 옛 장면 파서의 기대가 그대로 성립한다(이사한 두 케이스).
 *  - cover·hashtags·source_event 를 읽는다. 깨진 입력·null·타입 오류에 던지지 않고 빈 결과.
 *  - 모르는 layout 과 백엔드 전용 TEXT 는 버리지 않고 종류만 표시한다(INV-4: 조용히 삼키지 않는다).
 */

const payload = JSON.stringify({
  scenes: [
    {
      layout: 'PHOTO_FULL',
      caption: ' 성산일출봉 ',
      photo_slot: { visit_ref: { date: '2026-09-24', poi_id: 'p1' } },
    },
    { layout: 'STATS', caption: '3곳' },
    { layout: 'EVENT' },
  ],
});

const EMPTY = { cover: {}, hashtags: [], scenes: [] };

describe('장면 (이사: 옛 reflectionScenes.test)', () => {
  it('장면을 읽고 못 읽는 건 뺀다', () => {
    const { scenes } = parseReflectionPayload(payload);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toEqual({
      layout: 'PHOTO_FULL',
      caption: '성산일출봉',
      slot: { date: '2026-09-24', poiId: 'p1' },
    });
    expect(parseReflectionPayload('nope').scenes).toEqual([]);
    expect(parseReflectionPayload(undefined).scenes).toEqual([]);
  });

  it('사진 장면만, 그 날·그 장소 사진이 있을 때만 주소를 준다', () => {
    const [photo, stats] = parseReflectionPayload(payload).scenes;
    const photos = [{ uri: 'file://a', poiId: 'p1' }];
    expect(slotUri(photo, '2026-09-24', photos)).toBe('file://a');
    expect(slotUri(photo, '2026-09-25', photos)).toBeUndefined();
    expect(slotUri(photo, '2026-09-24', [])).toBeUndefined();
    expect(slotUri(stats, '2026-09-24', photos)).toBeUndefined();
  });
});

describe('표지·해시태그·사건 출처 (AC-2)', () => {
  const full = JSON.stringify({
    cover: {
      title: ' 부산 첫날 ',
      subtitle: '바다를 보며, 혼자만의 하루',
      photo_slot: { visit_ref: { date: '2026-09-24', poi_id: 'p9' } },
    },
    hashtags: [' #부산 ', '맛집', '부산', '', '   ', 7, null, '##겹'],
    scenes: [
      { layout: 'EVENT', caption: '비로 실내 전환', source_event: 'PLAN_B' },
      { layout: 'EVENT', caption: '건너뜀', source_event: 7 },
      { layout: 'STATS', caption: '3곳', source_event: null },
    ],
  });

  it('cover 의 제목·부제·사진 자리를 읽는다', () => {
    expect(parseReflectionPayload(full).cover).toEqual({
      title: '부산 첫날',
      subtitle: '바다를 보며, 혼자만의 하루',
      slot: { date: '2026-09-24', poiId: 'p9' },
    });
  });

  it('해시태그는 다듬고(공백·앞 #), 빈 값·비문자열을 빼고, 중복을 걷는다(순서 보존)', () => {
    const { hashtags } = parseReflectionPayload(full);
    expect(hashtags.slice(0, 3)).toEqual(['부산', '맛집', '겹']);
    expect(hashtags).toHaveLength(3);
  });

  it('source_event 는 값이 비지 않은 문자열일 때만 키가 생긴다', () => {
    const { scenes } = parseReflectionPayload(full);
    expect(scenes[0]).toEqual({
      layout: 'EVENT',
      caption: '비로 실내 전환',
      sourceEvent: 'PLAN_B',
    });
    expect('sourceEvent' in scenes[1]).toBe(false);
    expect('sourceEvent' in scenes[2]).toBe(false);
  });

  it('photo_slot 이 null 이거나 visit_ref 가 반쪽이어도 던지지 않고 사진 자리만 없다', () => {
    const parsed = parseReflectionPayload(
      JSON.stringify({
        cover: { title: 't', subtitle: 's', photo_slot: null },
        scenes: [
          {
            layout: 'PHOTO_FULL',
            caption: 'c',
            photo_slot: { visit_ref: { date: '2026-09-24' } },
          },
        ],
      })
    );
    expect(parsed.cover).toEqual({ title: 't', subtitle: 's' });
    expect(parsed.scenes).toEqual([{ layout: 'PHOTO_FULL', caption: 'c' }]);
  });
});

describe('깨진 입력은 빈 결과다 (던지지 않는다)', () => {
  it.each([
    'nope',
    'null',
    '[]',
    '"s"',
    '{"scenes":"x"}',
    '{"cover":null,"hashtags":"x","scenes":[null,1,"x",{}]}',
    '',
  ])('%p', (text) => {
    expect(parseReflectionPayload(text)).toEqual(EMPTY);
  });

  it('undefined', () => {
    expect(parseReflectionPayload(undefined)).toEqual(EMPTY);
  });
});

describe('모르는 layout 과 TEXT 는 버리지 않는다 (INV-4)', () => {
  const texts = JSON.stringify({
    scenes: [
      { layout: 'TEXT', caption: '광안리 을(를) 다녀왔어요.' },
      { layout: 'WEIRD', caption: '새 종류' },
    ],
  });

  it('장면 목록에 그대로 남고 종류가 표시된다', () => {
    const { scenes } = parseReflectionPayload(texts);
    expect(scenes.map((s) => s.layout)).toEqual(['TEXT', 'WEIRD']);
    expect(scenes.map((s) => sceneKind(s.layout))).toEqual(['TEXT', 'UNKNOWN']);
  });

  it.each([
    ['PHOTO_FULL', 'PHOTO'],
    ['PHOTO_CAPTION', 'PHOTO'],
    ['STATS', 'STATS'],
    ['MAP', 'MAP'],
    ['EVENT', 'EVENT'],
    ['TEXT', 'TEXT'],
    ['', 'UNKNOWN'],
    ['toString', 'UNKNOWN'],
    ['WEIRD', 'UNKNOWN'],
  ])('sceneKind(%p) → %s', (layout, kind) => {
    expect(sceneKind(layout)).toBe(kind);
  });
});

describe('성질 (PBT)', () => {
  const jsonish = fc.oneof(
    fc.string(),
    fc.json(),
    fc.jsonValue().map((v) => JSON.stringify(v)),
    fc
      .record({
        cover: fc.anything(),
        hashtags: fc.anything(),
        scenes: fc.array(fc.anything()),
      })
      .map((v) => JSON.stringify(v))
  );

  it('어떤 문자열에도 던지지 않고, 결과의 모든 값이 약속한 모양이다', () => {
    fc.assert(
      fc.property(jsonish, (text) => {
        const { hashtags, scenes } = parseReflectionPayload(text);
        expect(new Set(hashtags).size).toBe(hashtags.length);
        for (const tag of hashtags) {
          expect(tag.trim()).not.toBe('');
          expect(tag.startsWith('#')).toBe(false);
        }
        for (const scene of scenes) {
          expect(scene.layout.trim()).not.toBe('');
          expect(scene.caption.trim()).not.toBe('');
        }
      }),
      { numRuns: 300 }
    );
  });
});
