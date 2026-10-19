import { parseScenes, slotUri } from './reflectionScenes';

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

it('장면을 읽고 못 읽는 건 뺀다', () => {
  const scenes = parseScenes(payload);
  expect(scenes).toHaveLength(2);
  expect(scenes[0]).toEqual({
    layout: 'PHOTO_FULL',
    caption: '성산일출봉',
    slot: { date: '2026-09-24', poiId: 'p1' },
  });
  expect(parseScenes('nope')).toEqual([]);
  expect(parseScenes(undefined)).toEqual([]);
});

it('사진 장면만, 그 날·그 장소 사진이 있을 때만 주소를 준다', () => {
  const [photo, stats] = parseScenes(payload);
  const photos = [{ uri: 'file://a', poiId: 'p1' }];
  expect(slotUri(photo, '2026-09-24', photos)).toBe('file://a');
  expect(slotUri(photo, '2026-09-25', photos)).toBeUndefined();
  expect(slotUri(photo, '2026-09-24', [])).toBeUndefined();
  expect(slotUri(stats, '2026-09-24', photos)).toBeUndefined();
});
