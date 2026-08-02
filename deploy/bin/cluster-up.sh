#!/usr/bin/env bash
#
# 로컬 kind 클러스터를 만들고 SigNoz 를 설치한다. 최초 1회 또는 클러스터를 새로 만들 때 실행.
#
#   ./deploy/bin/cluster-up.sh
#
# 이미 있으면 건너뛴다(멱등). 완전히 새로 만들려면:
#   kind delete cluster --name trippilot && ./deploy/bin/cluster-up.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_cmd kind kubectl docker

# ── 1. 클러스터 ────────────────────────────────────────────────────────────
if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  ok "kind 클러스터 '${CLUSTER_NAME}' 가 이미 있습니다 — 생성을 건너뜁니다."
else
  log "kind 클러스터 '${CLUSTER_NAME}' 생성 (${KIND_CONFIG})"
  kind create cluster --config "${KIND_CONFIG}"
fi

kubectl config use-context "${KUBE_CONTEXT}" >/dev/null
kubectl wait --for=condition=Ready nodes --all --timeout=180s >/dev/null
ok "노드 Ready"

# ── 2. SigNoz ─────────────────────────────────────────────────────────────
if kubectl get namespace signoz >/dev/null 2>&1; then
  ok "SigNoz 네임스페이스가 이미 있습니다 — 설치를 건너뜁니다."
else
  require_cmd helm
  command -v foundryctl >/dev/null 2>&1 || die "foundryctl 이 없습니다.
    curl -fsSL https://signoz.io/foundry.sh | bash
    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"

  log "SigNoz 설치 (3~4분 소요)"
  # 산출물은 저장소 밖에 둔다 — pours/ 가 저장소를 오염시킨다.
  signoz_dir="${HOME}/signoz"
  mkdir -p "${signoz_dir}"
  cat > "${signoz_dir}/casting-k8s.yaml" <<'YAML'
apiVersion: v1alpha1
kind: Installation
metadata:
  name: signoz
spec:
  deployment:
    flavor: helm
    mode: kubernetes
YAML
  (cd "${signoz_dir}" && foundryctl cast -f casting-k8s.yaml -p ./pours-k8s --format text)
fi

log "SigNoz 기동 대기 (최대 10분)"
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=signoz -n signoz --timeout=600s >/dev/null 2>&1 || true
kubectl get pods -n signoz

cat <<EOF

$(ok "클러스터 준비 완료")

  SigNoz UI 열기 (별도 터미널, 켜둔 채 유지):
    kubectl port-forward -n signoz svc/signoz 8080:8080
    → http://localhost:8080

  백엔드 빌드·배포:
    ./deploy/bin/build.sh && ./deploy/bin/deploy.sh

EOF
