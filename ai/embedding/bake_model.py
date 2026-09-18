"""모델을 fp16 으로 변환해 이미지에 굽는다 (TRIP-517 빌드 단계).

fp32 2.1GB → fp16 1.1GB. 런타임은 fp32 로 되올려 쓰므로(app.py) 연산 속도는 그대로다.
검색 순위 영향 없음 — TRIP-518 실측에서 코사인 1.00000 · top4 24/24 위치 동일.

**리비전을 인자로 받아 고정한다.** 태그(`main`)만 쓰면 업스트림이 바뀔 때 적재된
벡터와 공간이 달라지는 일이 조용히 일어난다.
"""

from __future__ import annotations

import sys

import torch
from sentence_transformers import SentenceTransformer

EXPECTED_DIM = 1024  # BR-AF-09


def main(model_name: str, revision: str, out_dir: str) -> int:
    print(f"[bake] {model_name}@{revision} → {out_dir}")
    model = SentenceTransformer(model_name, revision=revision, device="cpu")

    dim = model.get_sentence_embedding_dimension()
    if dim != EXPECTED_DIM:
        # 빌드 실패로 드러낸다 — 차원이 다른 모델이 이미지에 들어가면
        # 적재(vector(1024))와 어긋난 채로 서비스한다.
        print(f"[bake] 차원 {dim} != {EXPECTED_DIM} (BR-AF-09)", file=sys.stderr)
        return 1

    backbone = model[0].auto_model
    # `auto_model` 은 setter 없는 property(self.model 별칭)라 대입이 조용히 무시된다.
    # 실경로는 `model[0].model` — TRIP-518 에서 이걸 몰라 "int8 은 no-op" 이라는
    # 틀린 결론을 낼 뻔했다. 여기서는 state_dict 를 바꾸므로 그 함정을 피해 간다.
    half = {
        k: (v.half() if v.is_floating_point() else v)
        for k, v in backbone.state_dict().items()
    }
    backbone.load_state_dict(half, strict=True, assign=True)
    model.save(out_dir)
    print(f"[bake] 완료 (dim={dim})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
