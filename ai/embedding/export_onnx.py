"""KURE-v1 인코더를 ONNX 로 내보낸다 — Triton(ORT 백엔드) 경로의 빌드 단계.

`bake_model.py` 와 같은 자리의 형제다. 저쪽은 torch 서빙용 fp16 사본을 굽고,
이쪽은 Triton 이 읽을 ONNX 를 굽는다.

## 인코더만 내보낸다

ONNX 가 돌리는 것은 XLMRobertaModel 하나이고, **토크나이즈·풀링·정규화는 전부
FastAPI(app.py)가 한다.** 풀링을 그래프에 넣으면 그 구현이 두 곳(여기와 torch 경로)에
생겨 조용히 갈라진다 — KURE-v1 은 CLS 풀링이고(`1_Pooling/config.json` 의
`pooling_mode_cls_token: true`), mean 으로 잘못 넣어도 차원이 1024 그대로라
어떤 검사도 못 잡는다.

그래서 출력은 `last_hidden_state` [batch, seq, 1024] 하나다. 여기서 CLS 를 뽑는
책임은 `app.py._embed_triton` 에 단 한 번만 있다.

## 2GB 넘는 모델

fp32 가중치가 2.27GB 라 ONNX protobuf 단일 파일 상한(2GB)을 넘는다 —
external data 로 쪼개 저장한다(`model.onnx` + `.onnx_data`). Triton/ORT 는
model.onnx 와 **같은 디렉토리**에 있는 external data 를 따라간다.

실행:
    cd ai && uv pip install sentence-transformers   # 프로젝트 의존성 아님
    uv run python embedding/export_onnx.py <out_dir>
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# **torch·sentence-transformers 는 함수 안에서 읽는다.** 둘 다 프로젝트 의존성이 아니라
# (의도 — `ai/docs/임베딩-사이징-근거.md`) 모듈 수준에서 import 하면 이 파일을 읽는 것만으로
# 죽는다. 그러면 경로 선택 같은 가벼운 규칙조차 테스트할 수 없다.

MODEL_NAME = os.environ.get("EMBEDDING_MODEL") or "nlpai-lab/KURE-v1"
# 이미지에 구워진 fp16 사본. 빌드 안에서는 `HF_HUB_OFFLINE=1` 이라 **이 경로가 유일한
# 읽을 자리**다 — 모델명으로 가면 허브로 나가려다 빌드가 죽는다.
MODEL_PATH = os.environ.get("EMBEDDING_MODEL_PATH") or ""
EXPECTED_DIM = 1024  # BR-AF-09


def model_source() -> str:
    """구운 가중치가 있으면 그것, 없으면 모델명 — `app.py::_load` 와 같은 규칙."""
    return MODEL_PATH or MODEL_NAME


def _encoder_class(torch):
    """`last_hidden_state` 하나만 내보내는 얇은 래퍼.

    XLMRobertaModel 은 dataclass(`BaseModelOutputWithPooling...`)를 돌려주고 거기엔
    쓰지 않는 `pooler_output` 이 딸려 있다. **그걸 그대로 내보내면 안 된다** — pooler 는
    tanh(dense(CLS)) 라 CLS 와 다른 벡터인데 차원이 같아, 호출측이 출력 이름을 헷갈리면
    조용히 다른 공간이 나온다.

    클래스를 함수 안에서 만드는 이유는 상속 대상(`torch.nn.Module`)이 모듈 수준에
    없기 때문이다 — 위 import 주석 참조.
    """

    class Encoder(torch.nn.Module):
        def __init__(self, backbone) -> None:
            super().__init__()
            self.backbone = backbone

        def forward(self, input_ids, attention_mask):
            return self.backbone(
                input_ids=input_ids, attention_mask=attention_mask
            ).last_hidden_state

    return Encoder


def main(out_dir: str) -> int:
    import torch
    from sentence_transformers import SentenceTransformer

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    st = SentenceTransformer(model_source(), device="cpu")
    # 구운 가중치는 fp16 이다. 그대로 내보내면 CPU 에 fp16 고속 경로가 없어 19배 느린
    # 그래프가 나온다(TRIP-518). `app.py::_load` 와 같은 자리에서 fp32 로 되올린다.
    st[0].auto_model.float()
    dim = st.get_sentence_embedding_dimension()
    if dim != EXPECTED_DIM:
        print(f"[export] 차원 {dim} != {EXPECTED_DIM} (BR-AF-09)", file=sys.stderr)
        return 1

    # 풀링 설정을 여기서도 확인한다 — 업스트림이 CLS→mean 으로 바뀌면
    # app.py 의 풀링과 어긋나는데, 그건 벡터가 조용히 달라지는 유일한 경로다.
    #
    # 설정 dict 모양이 sentence-transformers 버전마다 다르다: 5.x 이하는 불리언
    # 플래그(`pooling_mode_cls_token`), 6.x 는 문자열 하나(`pooling_mode: "cls"`).
    # **모르는 모양이면 통과시키지 않는다** — "키가 없으니 기본값 CLS 겠지"로 넘기면
    # mean 모델을 CLS 로 읽어도 차원이 1024 그대로라 아무 데서도 안 걸린다.
    pooling = st[1].get_config_dict()
    if "pooling_mode" in pooling:
        mode = pooling["pooling_mode"]
    elif "pooling_mode_cls_token" in pooling:
        mode = "cls" if pooling["pooling_mode_cls_token"] else "cls-아님"
    else:
        print(f"[export] 풀링 설정 모양을 모르겠다: {pooling}", file=sys.stderr)
        return 1
    if mode != "cls":
        print(f"[export] 풀링이 CLS 가 아니다({mode!r}) — app.py 와 어긋난다", file=sys.stderr)
        return 1

    backbone = st[0].auto_model.eval().float()
    sample = st.tokenize(["날씨가 나빠 야외 일정을 바꿔야 한다", "짧게"])

    path = out / "model.onnx"
    with torch.no_grad():
        torch.onnx.export(
            _encoder_class(torch)(backbone),
            (sample["input_ids"], sample["attention_mask"]),
            str(path),
            input_names=["input_ids", "attention_mask"],
            output_names=["last_hidden_state"],
            dynamic_axes={
                "input_ids": {0: "batch", 1: "seq"},
                "attention_mask": {0: "batch", 1: "seq"},
                "last_hidden_state": {0: "batch", 1: "seq"},
            },
            opset_version=17,
            dynamo=False,
        )
    print(f"[export] 완료 → {path} (dim={dim}, 풀링=CLS)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "onnx"))
