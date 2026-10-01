import { useEffect, useState } from 'react';

import { fetchTerms, submitConsents, type ConsentInput } from '@/shared/api';

import type { TermsItemView } from '../ui/TermsScreen';

/**
 * 약관 동의 상태·서버 호출 (US-ONB-02 · AC A3~A8 · C4 · BR-U0-10·11, TRIP-366).
 *
 * 서버 GET /terms 는 6종을 주지만 U0 온보딩은 **필수 3종만** 그린다(BR-U0-11) — 나머지 3종
 * (MARKETING·GPS_RECORDING·PERSONALIZATION)은 후속 유닛 설정 화면 몫이다. 세 종 모두 필수라
 * 전부 GRANT 해야 '다음'이 활성된다(BR-U0-10). '전체 동의'는 파생 상태(모든 행이 체크됨)일 뿐
 * 별도로 저장하지 않는다. 제출은 체크된 항목만 **서버가 준 버전 그대로** GRANT 로 담아 1회 호출한다
 * (BR-U0-12 · D8).
 */

/**
 * BR-U0-11 — U0 온보딩에서 노출하는 필수 약관 3종(표시 순서 = 이 배열 순서, 법정 고지라 결정론적으로 고정).
 * 서버가 이 셋 밖의 종을 줘도(6종) 걸러내므로, 노출 안 하는 약관을 사용자가 선언하지 않은 증적으로 담는
 * 일이 구조적으로 불가능해진다(BR-U0-12). 세 종 모두 필수다(BR-U0-10).
 */
const ONBOARDING_TERMS_TYPES = [
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
  'LOCATION_TERMS',
];

/**
 * 화면 표시용 라벨(BR-U0-10 정본 문구). 서버 body 는 약관 전문(+ [플레이스홀더] 임시값)이라 짧은 라벨은
 * 클라가 갖는다. 필터가 3종으로 서므로 라벨 폴백(원시 코드 노출)은 구조적으로 발생하지 않는다.
 */
const TERMS_LABELS: Record<string, string> = {
  TERMS_OF_SERVICE: '서비스 이용약관',
  PRIVACY_POLICY: '개인정보 수집·이용',
  LOCATION_TERMS: '위치기반서비스',
};

const CONSENT_ERROR_MESSAGE = '동의 저장에 실패했어요. 다시 시도해 주세요.';

export interface UseTermsConsent {
  items: TermsItemView[];
  allChecked: boolean;
  canProceed: boolean;
  missingRequiredLabels: string[];
  errorMessage: string | null;
  toggle: (termsType: string) => void;
  toggleAll: () => void;
  /** 성공(true)일 때만 컨테이너가 다음 단계로 이동한다. */
  submit: () => Promise<boolean>;
}

export function useTermsConsent(): UseTermsConsent {
  const [items, setItems] = useState<TermsItemView[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const terms = await fetchTerms();
      const byType = new Map(terms.map((term) => [term.termsType, term]));
      // 서버 응답 순서와 무관하게 노출 순서를 고정하고, 서버에 실재하는 종만 그린다.
      setItems(
        ONBOARDING_TERMS_TYPES.flatMap((type) => {
          const term = byType.get(type);
          return term
            ? [
                {
                  termsType: term.termsType,
                  version: term.version,
                  label: TERMS_LABELS[type] ?? term.termsType,
                  required: true,
                  checked: false,
                },
              ]
            : [];
        })
      );
    })();
  }, []);

  const requiredItems = items.filter((item) => item.required);
  const allChecked = items.length > 0 && items.every((item) => item.checked);
  const canProceed =
    requiredItems.length > 0 && requiredItems.every((item) => item.checked);
  const missingRequiredLabels = requiredItems
    .filter((item) => !item.checked)
    .map((item) => item.label);

  const toggle = (termsType: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.termsType === termsType
          ? { ...item, checked: !item.checked }
          : item
      )
    );
  };

  const toggleAll = () => {
    const next = !allChecked;
    setItems((prev) => prev.map((item) => ({ ...item, checked: next })));
  };

  const submit = async (): Promise<boolean> => {
    const consents: ConsentInput[] = items
      .filter((item) => item.checked)
      .map((item) => ({
        termsType: item.termsType,
        termsVersion: item.version,
        action: 'GRANT',
      }));
    try {
      await submitConsents(consents);
      setErrorMessage(null);
      return true;
    } catch {
      // INV-4 — 조용히 넘어가지 않는다. 오류를 남기고 다음 단계로 이동하지 않는다.
      setErrorMessage(CONSENT_ERROR_MESSAGE);
      return false;
    }
  };

  return {
    items,
    allChecked,
    canProceed,
    missingRequiredLabels,
    errorMessage,
    toggle,
    toggleAll,
    submit,
  };
}
