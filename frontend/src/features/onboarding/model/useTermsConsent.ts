import { useEffect, useState } from 'react';

import { fetchTerms, submitConsents, type ConsentInput } from '@/shared/api';

import type { TermsItemView } from '../ui/TermsScreen';

/**
 * 약관 동의 상태·서버 호출 (US-ONB-02 · AC A3~A8 · C4).
 *
 * 필수 2종(TERMS_OF_SERVICE·PRIVACY_POLICY)은 활성 조건에 기여하고 마케팅(선택)은 기여하지 않는다(D1).
 * '전체 동의'는 파생 상태(모든 행이 체크됨)일 뿐 별도로 저장하지 않는다. 제출은 체크된 항목만
 * **서버가 준 버전 그대로** GRANT 로 담아 1회 호출한다(BR-U0-12 · D8).
 */

/** D1 — 이 두 종만 필수다. 서버 GET /terms 는 required 플래그를 주지 않으므로 클라가 분류한다. */
const REQUIRED_TERMS_TYPES = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];

/** 화면 표시용 라벨(UX 카피). 서버가 주는 body 는 약관 전문이라 짧은 라벨은 클라가 갖는다. */
const TERMS_LABELS: Record<string, string> = {
  TERMS_OF_SERVICE: '서비스 이용약관',
  PRIVACY_POLICY: '개인정보 처리방침',
  MARKETING: '마케팅 정보 수신 동의',
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
      setItems(
        terms.map((term) => ({
          termsType: term.termsType,
          version: term.version,
          label: TERMS_LABELS[term.termsType] ?? term.termsType,
          required: REQUIRED_TERMS_TYPES.includes(term.termsType),
          checked: false,
        }))
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
