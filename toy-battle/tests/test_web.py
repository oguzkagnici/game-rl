"""The JavaScript port (web/toybattle.js) against the C++ engine and the PyTorch network.

    python tests/test_web.py [checkpoint]

Plays games in the C++ engine, records every position (state, legal actions, features, network output,
action taken, next state) and replays them in node.  Needs node.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from toybattle.engine import Pool
from toybattle import model as M
from web.export import export_net, export_terrains

ckpt = sys.argv[1] if len(sys.argv) > 1 else f"{ROOT}/runs/main/latest.pt"
net, spec = export_net(ckpt)
evaluator = M.NetEvaluator(net)
rng = np.random.default_rng(0)
pool = Pool(1, seed=7)
cases = []
for g in range(80):
    pool.reset(0, g % 8, (g // 8) % 2)
    while True:
        legal = np.nonzero(pool.legal(0))[0]
        feat = pool.features(0)
        case = {"dump": pool.raw(0).tolist(), "legal": legal.tolist(), "feat": feat.tolist()}
        if len(cases) % 4 == 0:
            logits, v = evaluator(feat[None])
            case["logits"], case["value"] = logits[0].tolist(), float(v[0])
        a = pool.greedy(0) if rng.random() < 0.5 else int(rng.choice(legal))
        case["action"] = int(a)
        w = pool.step(0, a)
        case["next"] = pool.raw(0).tolist()
        cases.append(case)
        if w >= 0:
            break
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump({"net": spec, "terrains": export_terrains(), "cases": cases}, f)
r = subprocess.run(["node", f"{ROOT}/tests/web_check.js", f.name], capture_output=True, text=True)
os.unlink(f.name)
print(r.stdout.strip(), r.stderr.strip()[-2000:])
phases = sorted({c["dump"][2] for c in cases})
print(f"{len(cases)} positions, phases seen: {phases}")
sys.exit(r.returncode)
