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

# 셀렉터에서 migrator 를 **반드시 빼야 한다.**
#
# signoz-telemetrystore-migrator 는 스키마를 올리고 끝나는 Job 이라 0/1 Completed 로 남고,
# 종료된 파드는 영원히 condition=Ready 가 되지 않는다. app.kubernetes.io/name=signoz 만으로
# 걸면 이 파드가 함께 잡혀 **SigNoz 가 이미 다 떠 있어도 타임아웃을 전부 소진**한 뒤
# || true 로 빠져나온다. 실패가 아니라 조용한 낭비라 더 헷갈린다
# (실측: SigNoz 준비 3분 30초, 스크립트 총 13분. 이 셀렉터를 고친 뒤 재실행은 1초).
SIGNOZ_READY_SELECTOR='app.kubernetes.io/name=signoz,app.kubernetes.io/component!=signoz-telemetrystore-migrator'

# 파드가 아직 만들어지기 전이면 kubectl wait 가 "no matching resources found" 로 즉시 실패한다.
# 먼저 생성될 때까지 짧게 기다린다.
for _ in $(seq 1 30); do
  [[ -n "$(kubectl get pods -n signoz -l "${SIGNOZ_READY_SELECTOR}" -o name 2>/dev/null)" ]] && break
  sleep 2
done

if kubectl wait --for=condition=Ready pod -l "${SIGNOZ_READY_SELECTOR}" \
     -n signoz --timeout=600s >/dev/null 2>&1; then
  ok "SigNoz 파드 Ready"
else
  warn "SigNoz 파드가 시간 안에 Ready 가 되지 않았습니다 — 아래 상태를 확인하세요."
fi
kubectl get pods -n signoz

# UI 를 고정 NodePort(30083 → 호스트 8083)로 연다. port-forward 를 켜 둘 필요가 없어진다.
# 8080 은 frontend 가 쓴다(TRIP-325) — 여기를 8080 으로 적으면 frontend 로 안내하게 된다.
log "SigNoz UI NodePort 적용"
kubectl apply -f "${SIGNOZ_MANIFEST_DIR}"

# 헤드리스 서버에 띄웠다면 안내 주소도 localhost 가 아니어야 한다(just 의 host 와 같은 규칙).
ui_host="${TRIPPILOT_HOST:-localhost}"

cat <<EOF

$(ok "클러스터 준비 완료")

  SigNoz UI:  http://${ui_host}:8083     (port-forward 불필요)

  ⚠️ 최초 1회 관리자 계정을 만들어야 합니다. 계정(=조직)이 없으면 collector 가
     파이프라인 설정을 받지 못해 **OTLP 수신기 자체가 열리지 않습니다**.
     비밀번호 규칙: 12자 이상 + 대문자 + 소문자 + 숫자 + 기호

  백엔드 빌드·배포:
    ./deploy/bin/build.sh && ./deploy/bin/deploy.sh

EOF
