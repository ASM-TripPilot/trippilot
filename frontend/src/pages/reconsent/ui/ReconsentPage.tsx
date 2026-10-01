import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { type ReactElement, useRef, useState } from 'react';

import { termsDocumentTitle } from '@/features/onboarding/model/termsDocumentTitle';
import { ReconsentScreen } from '@/features/onboarding/ui/ReconsentScreen';
import { fetchBootstrap, fetchTerms, patchConsent } from '@/shared/api';
import { notifyBootstrapReeval } from '@/shared/bootstrap/bootstrapReeval';

interface ReconsentTarget {
  termsType: string;
  version: string;
}

/**
 * 재동의 대상 = 부트스트랩이 올린 타입 ∩ `/terms` 현행판(버전은 서버 값 그대로 — BR-U0-12).
 * 교집합이 비면 통과시키지 않고 실패로 던진다(01b Q3 · INV-4) — 빈 목록은 "전부 체크됨"이 공짜로 참이 된다.
 */
async function loadReconsentTargets(): Promise<ReconsentTarget[]> {
  const [bootstrap, terms] = await Promise.all([
    fetchBootstrap(),
    fetchTerms(),
  ]);
  const versions = new Map(terms.map((t) => [t.termsType, t.version]));
  const targets = bootstrap.reconsent.termsTypes.flatMap((termsType) => {
    const version = versions.get(termsType);
    return version ? [{ termsType, version }] : [];
  });
  if (targets.length === 0) throw new Error('RECONSENT_TARGETS_EMPTY');
  return targets;
}

/**
 * 약관 재동의 배선(pages 층, TRIP-937 · BR-U0-14 · BR-U0-26) — 부트스트랩이 RECONSENT 로 보낸 사용자가
 * 대상 약관을 전부 체크하고 동의하면 타입마다 단건 PATCH(GRANT)를 보내고, **전부 성공한 뒤에만**
 * 재평가 신호 → `/` replace 로 게이트를 빠져나간다(PrefStep2 선례). 일괄 POST 는 채널이 ONBOARDING 으로
 * 기록되므로 쓰지 않는다 — RECONSENT 채널은 서버가 PATCH 에서 추론한다.
 *
 * 부분 실패 후 재시도는 **아직 성공하지 않은 것만** 다시 보낸다(`granted`) — 같은 GRANT 를 append-only
 * 증적에 두 번 남기지 않는다(BR-U0-12).
 */
export function ReconsentPage(): ReactElement {
  const router = useRouter();
  const targets = useQuery({
    queryKey: ['reconsent-targets'],
    queryFn: loadReconsentTargets,
    retry: false, // 열람 페이지와 같은 이유 — 오류가 늦게 뜨지 않게, 재시도는 버튼이 맡는다.
  });
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const granted = useRef(new Set<string>());

  const list = targets.data ?? [];
  const items = list.map((t) => ({
    termsType: t.termsType,
    label: termsDocumentTitle(t.termsType),
    checked: checked[t.termsType] === true,
  }));
  const canAgree =
    items.length > 0 && items.every((item) => item.checked) && !saving;

  const agree = (): void => {
    if (!canAgree) return;
    void (async () => {
      setSaving(true);
      setSaveFailed(false);
      // 저장 실패 뒤 재시도면 대상을 다시 읽는다 — 서버 400(구버전)은 같은 버전 재전송으로는 안 풀린다.
      let current = list;
      if (saveFailed) {
        const fresh = await targets.refetch();
        // 재조회 실패면 조회 오류 표면이, 새로 생긴 미체크 대상이면 그 행이 사용자에게 넘어간다.
        if (
          !fresh.data ||
          fresh.isError ||
          fresh.data.some((t) => checked[t.termsType] !== true)
        ) {
          setSaving(false);
          return;
        }
        current = fresh.data;
      }
      const pending = current.filter((t) => !granted.current.has(t.termsType));
      const results = await Promise.allSettled(
        pending.map(async (t) => {
          await patchConsent(t.termsType, t.version, 'GRANT');
          granted.current.add(t.termsType);
        })
      );
      setSaving(false);
      if (results.some((r) => r.status === 'rejected')) {
        setSaveFailed(true);
        return;
      }
      notifyBootstrapReeval();
      router.replace('/');
    })();
  };

  const errorMessage = targets.isError
    ? '재동의할 약관을 불러오지 못했어요. 다시 시도해 주세요.'
    : saveFailed
      ? '동의를 저장하지 못했어요. 다시 시도해 주세요.'
      : null;

  return (
    <ReconsentScreen
      loading={targets.isPending}
      items={items}
      canAgree={canAgree}
      errorMessage={errorMessage}
      onToggle={(termsType) =>
        setChecked((prev) => ({ ...prev, [termsType]: !prev[termsType] }))
      }
      onViewTerms={(termsType) => router.push(`/terms/${termsType}`)}
      onAgree={agree}
      onRetry={targets.isError ? () => void targets.refetch() : agree}
    />
  );
}
