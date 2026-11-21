"""Final network against its own earlier checkpoints and against stronger network-free search.

    python ladder.py            # prints one JSON line per match, appends to runs/main/ladder.jsonl
"""
import argparse
import glob
import json
import os

from dara import model as M
from dara.arena import heuristic_agent, play_match


def net_agent(path, sims):
    net, ck = M.load(path)
    return {"kind": "mcts", "evaluator": M.NetEvaluator(net), "sims": sims}, ck


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="runs/main")
    ap.add_argument("--games", type=int, default=48)
    ap.add_argument("--sims", type=int, default=200)
    ap.add_argument("--iters", type=int, nargs="*", default=[5, 10, 20, 30])
    args = ap.parse_args()

    final, ck = net_agent(os.path.join(args.run, "latest.pt"), args.sims)
    out = open(os.path.join(args.run, "ladder.jsonl"), "a")

    def report(name, opponent, games, me=final):
        w, l, d, n = play_match(me, opponent, games=games, seed=7)
        row = {"opponent": name, "wins": w, "losses": l, "draws": d,
               "score": round((w + d / 2) / games, 3), "avg_actions": round(n, 1)}
        print(json.dumps(row), flush=True)
        out.write(json.dumps(row) + "\n")
        out.flush()

    for path in sorted(glob.glob(os.path.join(args.run, "iter*.pt"))):
        it = int(os.path.basename(path)[4:8])
        if it in args.iters:
            opp, _ = net_agent(path, args.sims)
            report(f"iteration {it} (same {args.sims} simulations)", opp, args.games)
    report("heuristic search, 5000 simulations", heuristic_agent(5000), 16)
    raw, _ = net_agent(os.path.join(args.run, "latest.pt"), 2)   # 2 simulations = play the policy head's top move
    report("heuristic search, 2000 simulations, vs network with no search", heuristic_agent(2000), 32, me=raw)


if __name__ == "__main__":
    main()
