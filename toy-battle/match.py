"""Two checkpoints (any runs, any network sizes) against each other, per terrain.

    python match.py runs/big/latest.pt runs/main/latest.pt --games 256 --out runs/league.jsonl

--a-search / --b-search give each side its own budget as deals x simulations.
"""
import argparse, json, os
import torch
from toybattle import model as M
from toybattle.arena import play_match
from toybattle.terrains import NAMES

ap = argparse.ArgumentParser()
ap.add_argument("a")
ap.add_argument("b")
ap.add_argument("--games", type=int, default=256)
ap.add_argument("--a-search", default="4x40")
ap.add_argument("--b-search", default="4x40")
ap.add_argument("--seed", type=int, default=777)
ap.add_argument("--out", default="runs/league.jsonl")
cfg = ap.parse_args()
torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", 4)))


def agent(path, spec):
    net, ck = M.load(path)
    deals, sims = (int(x) for x in spec.split("x"))
    return {"kind": "mcts", "evaluator": M.NetEvaluator(net), "sims": sims, "deals": deals}, ck.get("iteration", ck.get("iter"))


a, ia = agent(cfg.a, cfg.a_search)
b, ib = agent(cfg.b, cfg.b_search)
w, l, d, turns, per = play_match(a, b, cfg.games, seed=cfg.seed, by_terrain=True)
rec = {"a": cfg.a, "a_round": ia, "a_search": cfg.a_search, "b": cfg.b, "b_round": ib, "b_search": cfg.b_search,
       "wins": w, "losses": l, "draws": d, "score": (w + d / 2) / cfg.games,
       "by_terrain": {NAMES[t]: v for t, v in per.items()}}
print(json.dumps(rec), flush=True)
with open(cfg.out, "a") as f:
    f.write(json.dumps(rec) + "\n")
