"""Checkpoint ladder: the newest checkpoint against earlier ones, same search for both, per terrain.

    python ladder.py --games 128 --vs 5 10 20 30 40
"""
import argparse, glob, json, os
import torch
from toybattle import model as M
from toybattle.arena import play_match
from toybattle.terrains import NAMES

ap = argparse.ArgumentParser()
ap.add_argument("--run", default="runs/main")
ap.add_argument("--new", type=int, default=0, help="iteration of the checkpoint under test (0 = newest)")
ap.add_argument("--vs", type=int, nargs="+", required=True)
ap.add_argument("--games", type=int, default=128)
ap.add_argument("--sims", type=int, default=40)
ap.add_argument("--deals", type=int, default=4)
cfg = ap.parse_args()
torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", 2)))

def agent(it):
    net, _ = M.load(f"{cfg.run}/iter{it:04d}.pt")
    return {"kind": "mcts", "evaluator": M.NetEvaluator(net), "sims": cfg.sims, "deals": cfg.deals}

new = cfg.new or max(int(p[-7:-3]) for p in glob.glob(f"{cfg.run}/iter*.pt"))
a = agent(new)
for old in cfg.vs:
    w, l, d, turns, per = play_match(a, agent(old), cfg.games, seed=1000 + old, by_terrain=True)
    rec = {"new": new, "old": old, "wins": w, "losses": l, "draws": d, "score": (w + d / 2) / cfg.games,
           "by_terrain": {NAMES[t]: v for t, v in per.items()}}
    print(json.dumps(rec), flush=True)
    with open(f"{cfg.run}/ladder.jsonl", "a") as f:
        f.write(json.dumps(rec) + "\n")
