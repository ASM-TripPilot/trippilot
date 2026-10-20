import fc from 'fast-check';

import type { TriggerKind } from '@/shared/api/index.schemas';
import { TriggerVariant } from '@/shared/api/index.schemas';

import { triggerDayLabel } from './triggerDayLabel';
import { TRIGGER_LABELS, VARIANT_LABELS, triggerLabel } from './triggerLabel';
import { triggerPillCopy, type TriggerPillSlot } from './triggerPillCopy';

/**
 * PBT-SA-22(business-rules §11) — `triggerLabel` · `triggerPillCopy` · `triggerDayLabel` 묶음의 성질.
 *
 *  ① 변형 전수 라벨 — 생성 `TriggerVariant` 12종 모두 비어 있지 않은 라벨이 있고, triggerLabel 이 그 라벨을 낸다.
 *  ② 소요시간 패턴 0 — 어떤 kind·변형·슬롯·날짜어 조합에서도 템플릿이 `N분`·`N시간`·`소요` 를 만들지 않는다(INV-3).
 *     장소명 자리는 비우고 검사한다 — `365분식`·`4시30분왕족발` 같은 상호를 템플릿 위반으로 읽지 않게(BR-SA-12 ③과 같은 규칙).
 *  ③ 월말·연말에도 다음 날은 늘 `내일` — 기대값은 에포크 일수(정수)에서 한 방향으로만 만든다(구현과 다른 경로).
 *  ④ 변형이 없으면 옛 출력 — 아래 `oldPillCopy` 는 FE-B 이전 구현을 그대로 옮긴 오라클이다.
 *
 * README §PBT 작성 규칙 — 꼭 나와야 하는 사례(월말·연말·윤일·숫자 든 상호)는 `examples` 로 박는다.
 */

const MS_PER_DAY = 86_400_000;
const isoFromEpochDay = (day: number): string =>
  new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
const epochDayOf = (iso: string): number =>
  Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);

const KINDS: TriggerKind[] = ['WEATHER', 'CLOSURE', 'DELAY', 'MANUAL'];
const VARIANTS = Object.values(TriggerVariant) as NonNullable<TriggerVariant>[];

/** FE-B 이전 `triggerPillCopy`(TRIP-748 D2) — 성질 ④의 오라클. 구현을 고쳐도 이 사본은 고치지 않는다. */
function oldPillCopy(kind: TriggerKind, slot?: TriggerPillSlot | null): string {
  const { label } = TRIGGER_LABELS[kind];
  const name = slot?.nameKo;
  if (!slot || !name) return label;
  if (kind === 'WEATHER') {
    return `${label} · ${name} ${Number(slot.startAt.slice(0, 2))}시`;
  }
  if (kind === 'DELAY') return `${label} · ${name} 방면`;
  if (kind === 'CLOSURE') return `${label} · ${name} 주변 시설`;
  return label;
}

const kindArb = fc.constantFrom(...KINDS);
// 변형 — 12종 + null + 모르는 값(옛 앱이 새 서버 값을 받는 경우).
const variantArb = fc.oneof(
  fc.constantFrom(...VARIANTS),
  fc.constant(null),
  fc.constant('TYPHOON' as unknown as TriggerVariant)
);
const startAtArb = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(
    ([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
  );
const nameArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 30 }),
  fc.constantFrom('365분식', '4시30분왕족발', '40시간 카페', '국립중앙박물관')
);
const slotArb: fc.Arbitrary<TriggerPillSlot | null | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.record({
    nameKo: fc.oneof(nameArb, fc.constant(null)),
    startAt: startAtArb,
  })
);
const epochDayArb = fc.integer({ min: 18_000, max: 26_000 }); // 2019 ~ 2041
const DURATION = /\d+\s*(분|시간)|소요|duration/i;

describe('PBT-SA-22 · 라벨·알약·날짜어', () => {
  it('① 변형 12종 모두 라벨이 있고 triggerLabel 이 그 라벨을 낸다(kind 의 iconKey 유지)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...VARIANTS), kindArb, (variant, kind) => {
        const label = triggerLabel(kind, variant);
        expect(VARIANT_LABELS[variant].length).toBeGreaterThan(0);
        expect(label.label).toBe(VARIANT_LABELS[variant]);
        expect(label.iconKey).toBe(TRIGGER_LABELS[kind].iconKey);
      })
    );
  });

  it('② 어떤 조합에서도 템플릿에 소요시간 패턴이 없다(장소명 자리는 비우고 검사)', () => {
    fc.assert(
      fc.property(
        kindArb,
        variantArb,
        slotArb,
        epochDayArb,
        fc.integer({ min: -3, max: 40 }),
        (kind, variant, slot, today, offset) => {
          const dayLabel = triggerDayLabel(
            isoFromEpochDay(today + offset),
            isoFromEpochDay(today)
          );
          const copy = triggerPillCopy(kind, slot, { variant, dayLabel });
          const name = slot?.nameKo;
          const template = name ? copy.split(name).join('') : copy;
          // 짝 앵커 — 빈 문자열 공허 통과 차단.
          expect(copy.length).toBeGreaterThan(0);
          expect(template).not.toMatch(DURATION);
        }
      ),
      {
        examples: [
          [
            'WEATHER',
            'RAIN',
            { nameKo: '365분식', startAt: '17:30:00' },
            20_000,
            1,
          ],
          [
            'CLOSURE',
            'OUT_OF_HOURS',
            { nameKo: '4시30분왕족발', startAt: '09:00:00' },
            20_000,
            0,
          ],
          [
            'DELAY',
            null,
            { nameKo: '40시간 카페', startAt: '23:59:00' },
            20_000,
            2,
          ],
        ],
      }
    );
  });

  it('③ 어느 날이든 다음 날은 "내일", 같은 날은 null, 그 밖은 "M월 D일"', () => {
    fc.assert(
      fc.property(
        epochDayArb,
        fc.integer({ min: -400, max: 400 }),
        (today, offset) => {
          const todayIso = isoFromEpochDay(today);
          const target = isoFromEpochDay(today + offset);
          const label = triggerDayLabel(target, todayIso);
          if (offset === 0) expect(label).toBeNull();
          else if (offset === 1) expect(label).toBe('내일');
          else {
            const [, month, day] = target.split('-');
            expect(label).toBe(`${Number(month)}월 ${Number(day)}일`);
          }
        }
      ),
      {
        examples: [
          [epochDayOf('2026-10-31'), 1], // 월말
          [epochDayOf('2026-12-31'), 1], // 연말
          [epochDayOf('2028-02-28'), 1], // 윤년 2월 28일 → 윤일
          [epochDayOf('2028-02-29'), 1], // 윤일 → 3월 1일
          [epochDayOf('2027-02-28'), 1], // 평년 2월 말
          [epochDayOf('2026-10-19'), 0],
          [epochDayOf('2026-10-19'), 2], // 모레는 상대어가 아니다
        ],
      }
    );
  });

  it('④ 변형이 없으면(옵션 없음·빈 옵션·null·모르는 값) 옛 출력과 같다', () => {
    fc.assert(
      fc.property(kindArb, slotArb, (kind, slot) => {
        const old = oldPillCopy(kind, slot);
        expect(triggerPillCopy(kind, slot)).toBe(old);
        expect(triggerPillCopy(kind, slot, {})).toBe(old);
        expect(triggerPillCopy(kind, slot, { variant: null })).toBe(old);
        expect(
          triggerPillCopy(kind, slot, { variant: null, dayLabel: null })
        ).toBe(old);
        expect(
          triggerPillCopy(kind, slot, {
            variant: 'TYPHOON' as unknown as TriggerVariant,
          })
        ).toBe(old);
      }),
      {
        examples: [
          ['CLOSURE', { nameKo: '해운대 해변', startAt: '17:00:00' }],
          ['WEATHER', { nameKo: '해운대 해변', startAt: '09:45:00' }],
          ['MANUAL', { nameKo: '해운대 해변', startAt: '10:00:00' }],
        ],
      }
    );
  });
});
