"""Does the network get stronger with more search?  Same network on both sides, different budgets.

    python search_test.py --games 128
"""
import argparse, json, os
import torch
from toybattle import model as M
from toybattle.arena import play_match

ap = argparse.ArgumentParser()
ap.add_argument("--ckpt", default="runs/main/latest.pt")
ap.add_argument("--games", type=int, default=128)
ap.add_argument("--base", default="4x40", help="deals x simulations of the reference side")
ap.add_argument("--vs", nargs="+", default=["4x160", "16x40"])
ap.add_argument("--out", default="runs/main/search_test.jsonl")
cfg = ap.parse_args()
torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", 4)))
net, _ = M.load(cfg.ckpt)
ev = M.NetEvaluator(net)
agent = lambda spec: {"kind": "mcts", "evaluator": ev, "deals": int(spec.split("x")[0]), "sims": int(spec.split("x")[1])}
for spec in cfg.vs:
    w, l, d, _ = play_match(agent(spec), agent(cfg.base), cfg.games, seed=4242)
    rec = {"more": spec, "base": cfg.base, "wins": w, "losses": l, "draws": d, "score": (w + d / 2) / cfg.games}
    print(json.dumps(rec), flush=True)
    open(cfg.out, "a").write(json.dumps(rec) + "\n")
