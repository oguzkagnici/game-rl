"""Export a checkpoint for the browser: BatchNorm folded into the convolutions,
weights rearranged channels-last and stored as base64 float16.

    python web/export.py runs/main/latest.pt web/weights.json
"""
import base64
import json
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dara import model as M


def fold(conv, bn):
    scale = bn.weight / torch.sqrt(bn.running_var + bn.eps)
    return conv.weight * scale[:, None, None, None], bn.bias - bn.running_mean * scale


def export(ckpt, out):
    net, ck = M.load(ckpt)
    parts = []

    def add_conv(w, b):                     # [oc, ic, ky, kx] -> [ky, kx, ic, oc]
        parts.extend([w.permute(2, 3, 1, 0).reshape(-1), b.reshape(-1)])

    with torch.no_grad():
        add_conv(*fold(net.stem, net.stem_bn))
        for blk in net.blocks:
            add_conv(*fold(blk.c1, blk.b1))
            add_conv(*fold(blk.c2, blk.b2))
        add_conv(*fold(net.p_conv, net.p_bn))
        add_conv(net.p_out.weight, net.p_out.bias)
        add_conv(*fold(net.v_conv, net.v_bn))
        # fc1 input is torch's flatten of [8, 30]; the browser uses [30, 8]
        w = net.v_fc1.weight.reshape(64, 8, 30).permute(2, 1, 0).reshape(-1)
        parts.extend([w, net.v_fc1.bias, net.v_fc2.weight.reshape(-1), net.v_fc2.bias])
        data = torch.cat(parts).numpy().astype("<f2")
    spec = {"channels": net.channels, "blocks": net.n_blocks,
            "iteration": ck.get("iteration", 0), "hours": round(ck.get("elapsed", 0) / 3600, 2),
            "data": base64.b64encode(data.tobytes()).decode()}
    with open(out, "w") as f:
        json.dump(spec, f)
    return net, spec


if __name__ == "__main__":
    _, spec = export(sys.argv[1], sys.argv[2])
    print(f"exported iteration {spec['iteration']}: {len(spec['data']) // 1024} KB")
