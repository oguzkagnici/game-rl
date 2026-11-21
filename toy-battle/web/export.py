"""Export a checkpoint and the terrains for the browser (weights as base64 float16).

    python web/export.py runs/main/latest.pt out.json
"""
import base64
import json
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from toybattle import model as M
from toybattle.terrains import EFFECTS, TERRAINS, packed


def export_net(ckpt):
    net, ck = M.load(ckpt)
    parts = []
    lin = lambda l: parts.extend([l.weight.reshape(-1), l.bias])
    norm = lambda n: parts.extend([n.weight, n.bias])
    with torch.no_grad():                    # the order read by loadNet() in toybattle.js
        lin(net.base_in), lin(net.glob_in), lin(net.glob_tok)
        for ly in net.layers:
            norm(ly.n1), lin(ly.qkv), lin(ly.out), norm(ly.n2), lin(ly.f1), lin(ly.f2)
        parts.append(net.rel.reshape(-1))
        norm(net.norm), lin(net.p_base), lin(net.p_glob), lin(net.v1), lin(net.v2)
        data = torch.cat(parts).numpy().astype("<f2")
    return net, {"dim": net.dim, "layers": net.n_layers, "heads": net.heads, "iteration": ck.get("iteration", 0),
                 "hours": round(ck.get("elapsed", 0) / 3600, 1), "data": base64.b64encode(data.tobytes()).decode()}


def export_terrains():
    out = []
    for t in TERRAINS:
        pos = {b["name"]: (b["x"], b["y"]) for b in t["bases"]}
        pos.update({h["name"]: (h["x"], h["y"]) for p in (0, 1) for h in t["hqs"][p]})
        out.append({"name": t["name"], "effect": EFFECTS[t["effect"]], "objective": t["objective"],
                    "packed": packed(t).tolist(),
                    "bases": [{"name": b["name"], "x": b["x"], "y": b["y"], "special": b["special"], "gate": b["gate"]} for b in t["bases"]],
                    "hqs": [[{"x": h["x"], "y": h["y"], "gate": h["gate"]} for h in t["hqs"][p]] for p in (0, 1)],
                    "edges": [[*pos[a], *pos[b]] for a, b in t["edges"]],
                    "regions": t["regions"]})
    return out


if __name__ == "__main__":
    _, spec = export_net(sys.argv[1])
    json.dump({"net": spec, "terrains": export_terrains()}, open(sys.argv[2], "w"))
    print(f"exported round {spec['iteration']}: {len(spec['data']) // 1024} KB of weights")
