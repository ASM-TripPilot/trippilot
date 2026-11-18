import fc from 'fast-check';

import type { ImageLicense } from '@/shared/api/index.schemas';

import { PHOTO_CREDIT, resolvePhotoPolicy } from './photoLicense';

/**
 * TRIP-1740 · 관광공사 사진 이용 조건(공공누리) — 사진을 자를지(fit)·출처를 달지(showCredit)를 정하는 **순수 판정 한 곳**.
 *
 * 무엇을 보장하나(AC-1·AC-2·AC-3):
 *  - 서버 사진이 있고 유형이 TYPE3(변경금지) 이면 자르지 않는다(`contain`). TYPE1 만 꽉 채워 자른다(`cover`).
 *  - 유형을 모르는 서버 사진(null·undefined)도 자르지 않는다 — 수집이 덜 끝난 3유형 사진을 잘린 채 노출하지 않으려는 안전한 쪽(Q2).
 *  - 서버 사진이면 유형과 무관하게 출처를 단다. 서버 사진이 아니면(번들 표지·기기 사진 폴백·로드 실패) 유형이 무엇이든
 *    `cover` + 출처 없음 — 번들 그림에 여백이 생기거나 「사진: 한국관광공사」 가 엉뚱한 그림에 붙지 않는다.
 *
 * 왜 순수 함수인가: 정책이 화면 안에 있으면 조합마다 렌더해야 보이고, 정책을 바꾸는 한 줄(null 의 처리)이 여러 곳에 흩어진다.
 * 입력은 `hasServerPhoto`(불리언)라 ''·공백·로드 실패의 판정은 여기 없다 — 그건 `PoiPhoto.test.tsx` 가 렌더로 본다.
 *
 * 3동작 뼈대: 준비=(유형, 서버 사진 여부) 조합 → 실행=`resolvePhotoPolicy` → 단언=`{ fit, showCredit }`.
 * (개념) 속성 기반 테스트(PBT)는 입력을 자동으로 많이 만들어 "항상 성립하는 성질"을 확인한다. 아래 성질은 구현식을 베끼지 않고
 * 위 문장들을 독립적으로 다시 적은 것이다.
 *
 * 유형은 문자열 리터럴로 쓴다(`ImageLicense` 값 import 는 생성 스키마 수백 모듈을 이 순수 함수의 부팅 경로에 싣는다 — 타입만 가져온다).
 */

type License = ImageLicense | null | undefined;

const LICENSES: readonly License[] = ['TYPE1', 'TYPE3', null, undefined];

describe('resolvePhotoPolicy · 전 조합 표 (AC-1·AC-2·AC-3)', () => {
  // 서버 사진이 있을 때: 유형 → fit. 출처는 넷 다 참.
  it.each<[string, License, 'cover' | 'contain']>([
    ['TYPE1 은 꽉 채운다', 'TYPE1', 'cover'],
    ['TYPE3 은 자르지 않는다', 'TYPE3', 'contain'],
    ['null 은 자르지 않는다 (유형 미수집 — Q2)', null, 'contain'],
    ['undefined 도 자르지 않는다 (키 누락·옛 응답)', undefined, 'contain'],
  ])('서버 사진 있음 · %s', (_name, imageLicense, fit) => {
    expect(resolvePhotoPolicy({ imageLicense, hasServerPhoto: true })).toEqual({
      fit,
      showCredit: true,
    });
  });

  // 서버 사진이 없을 때(번들 표지·로드 실패 폴백): 유형이 TYPE3 이어도 번들 그림은 항상 cover + 출처 없음.
  it.each<[string, License]>([
    ['TYPE1', 'TYPE1'],
    ['TYPE3', 'TYPE3'],
    ['null', null],
    ['undefined', undefined],
  ])(
    '서버 사진 없음 · 유형 %s 여도 cover + 출처 없음',
    (_name, imageLicense) => {
      expect(
        resolvePhotoPolicy({ imageLicense, hasServerPhoto: false })
      ).toEqual({ fit: 'cover', showCredit: false });
    }
  );
});

describe('resolvePhotoPolicy · 성질 (PBT)', () => {
  const licenseArb = fc.constantFrom<License>(...LICENSES);

  it('출처는 서버 사진일 때만 달린다 — showCredit 은 hasServerPhoto 와 같다', () => {
    fc.assert(
      fc.property(licenseArb, fc.boolean(), (imageLicense, hasServerPhoto) => {
        expect(
          resolvePhotoPolicy({ imageLicense, hasServerPhoto }).showCredit
        ).toBe(hasServerPhoto);
      }),
      // 거짓 쪽·참 쪽 양끝은 확률에 맡기지 않는다(README: 생성기 적중 단언은 examples 로).
      {
        examples: [
          ['TYPE3', true],
          ['TYPE3', false],
          [null, true],
          [undefined, false],
        ],
      }
    );
  });

  it('자르지 않는 경우는 "서버 사진이면서 TYPE1 이 아닌" 경우뿐이다', () => {
    fc.assert(
      fc.property(licenseArb, fc.boolean(), (imageLicense, hasServerPhoto) => {
        const { fit } = resolvePhotoPolicy({ imageLicense, hasServerPhoto });
        expect(fit === 'contain').toBe(
          hasServerPhoto && imageLicense !== 'TYPE1'
        );
      }),
      {
        examples: [
          ['TYPE3', true],
          ['TYPE1', true],
          [null, true],
          ['TYPE3', false],
        ],
      }
    );
  });

  // 추론함(01b·브리프 §5 비대칭): 계약은 TYPE1·TYPE3 두 값뿐이지만 서버가 새 값(공공누리 2·4유형, 오타, 소문자)을 열어 둘 수 있다.
  // cover 의 대가는 이용 조건 위반이고 contain 의 대가는 미관이라, 정확히 'TYPE1' 이 아니면 자르지 않는다.
  it('계약 밖 문자열(TYPE2·소문자·빈 문자열)은 TYPE1 이 아니므로 자르지 않는다', () => {
    const unknownArb = fc
      .string()
      .filter((text) => text !== 'TYPE1') as fc.Arbitrary<unknown>;
    fc.assert(
      fc.property(unknownArb, (imageLicense) => {
        expect(
          resolvePhotoPolicy({
            imageLicense: imageLicense as License,
            hasServerPhoto: true,
          }).fit
        ).toBe('contain');
      }),
      { examples: [['TYPE2'], ['type1'], ['']] }
    );
  });
});

describe('PHOTO_CREDIT · 문구 상수 한 곳 (AC-2)', () => {
  it('긴 문구·짧은 문구·낭독 문구가 사용자 결정 그대로다', () => {
    expect(PHOTO_CREDIT).toEqual({
      full: '사진: 한국관광공사',
      short: '한국관광공사',
      a11y: '사진 출처 한국관광공사',
    });
  });
});
