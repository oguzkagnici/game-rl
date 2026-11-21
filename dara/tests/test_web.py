"""Checks the browser port (web/dara.js) against the C++ engine and PyTorch."""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from dara.engine import Pool
from web.export import export

NODE = r"""
const D = require(process.argv[2]), fs = require("fs");
const t = JSON.parse(fs.readFileSync(process.argv[3])), net = D.makeNet(JSON.parse(fs.readFileSync(process.argv[4])));
let positions = 0, maxErr = 0;
for (const g of t.games) {
  const s = D.newState();
  for (const st of g) {
    const legal = D.legalActions(s).slice().sort((a, b) => a - b);
    if (JSON.stringify(legal) !== JSON.stringify(st.legal)) throw new Error("legal mismatch at ply " + s.ply);
    if (st.logits) {
      const f = D.features(s, new Float32Array(300));
      for (let p = 0; p < 30; p++) for (let k = 0; k < 10; k++)
        if (Math.abs(f[p * 10 + k] - st.feat[k * 30 + p]) > 1e-6) throw new Error("feature mismatch");
      const o = net.evaluate(s);
      for (const a of legal) maxErr = Math.max(maxErr, Math.abs(o.logits[a] - st.logits[a]));
      maxErr = Math.max(maxErr, Math.abs(o.value - st.value));
    }
    D.applyAction(s, st.action);
    if (s.winner !== st.winner || s.turn !== st.turn) throw new Error("transition mismatch");
    positions++;
  }
}
// search sanity + speed
const s = D.newState(), t0 = Date.now(), search = D.makeSearch(net, s);
search.step(200);
console.log(JSON.stringify({ positions, maxErr, msPerSim: (Date.now() - t0) / 200, best: search.result().action }));
"""


def main(ckpt):
    tmp = tempfile.mkdtemp()
    net, _ = export(ckpt, f"{tmp}/weights.json")
    rng = np.random.default_rng(0)
    pool, games = Pool(1), []
    for g in range(40):
        pool.reset(0)
        steps = []
        while True:
            legal = np.nonzero(pool.legal(0))[0]
            a = pool.greedy(0) if g % 2 else int(rng.choice(legal))
            st = {"legal": legal.tolist(), "action": int(a)}
            if rng.random() < 0.15:
                f = pool.features(0)
                with torch.inference_mode():
                    logits, v = net(torch.from_numpy(f)[None])
                st.update(feat=f.reshape(-1).tolist(), logits=logits[0].tolist(), value=float(v[0]))
            st["winner"] = pool.step(0, a)
            st["turn"] = pool.turn(0)
            steps.append(st)
            if st["winner"] >= 0:
                break
        games.append(steps)
    json.dump({"games": games}, open(f"{tmp}/vectors.json", "w"))
    open(f"{tmp}/check.js", "w").write(NODE)
    out = subprocess.check_output(["node", f"{tmp}/check.js", f"{ROOT}/web/dara.js",
                                   f"{tmp}/vectors.json", f"{tmp}/weights.json"])
    res = json.loads(out)
    assert res["maxErr"] < 0.02, res
    print(f"ok: browser port agrees on {res['positions']} positions; "
          f"max network difference {res['maxErr']:.4f}; {res['msPerSim']:.1f} ms per simulation in node")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else f"{ROOT}/runs/main/latest.pt")
