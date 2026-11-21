"""AlphaZero vs PPO vs DQN: a no-search learning curve for AlphaZero and a round-robin tournament.

    python compare.py curve        # runs/main/policy_curve.jsonl
    python compare.py tournament   # runs/tournament.json
"""
import glob
import json
import os
import sys

import torch

from dara import model as M
from dara.arena import play_match


def agent(path, sims=0):
    net, ck = M.load(path)
    ev = M.NetEvaluator(net)
    return ({"kind": "mcts", "evaluator": ev, "sims": sims} if sims else {"kind": "policy", "evaluator": ev}), ck


def curve():
    """Same protocol as baselines.evaluate: best legal move, no search, 32 games against the scripted bot."""
    out = open("runs/main/policy_curve.jsonl", "w")
    hours = {r["iter"]: r["hours"] for r in map(json.loads, open("runs/main/log.jsonl"))}
    torch.manual_seed(0)
    points = [(0.0, {"kind": "policy", "evaluator": M.NetEvaluator(M.DaraNet())})]
    for path in sorted(glob.glob("runs/main/iter*.pt")):
        points.append((hours[int(os.path.basename(path)[4:8])], agent(path)[0]))
    points.append((max(hours.values()), agent("runs/main/latest.pt")[0]))
    for h, a in points:
        w, l, d, _ = play_match(a, {"kind": "greedy"}, games=32, seed=1)
        row = {"hours": h, "core_hours": round(min(h, 3.0) * 4, 2), "vs_greedy": round((w + d / 2) / 32, 3)}
        print(json.dumps(row), flush=True)
        out.write(json.dumps(row) + "\n")


def tournament(games=32):
    players = [
        ("AlphaZero + search", agent("runs/main/latest.pt", 200)[0]),
        ("AlphaZero, no search", agent("runs/main/latest.pt")[0]),
        ("PPO + search", agent("runs/ppo/latest.pt", 200)[0]),
        ("PPO", agent("runs/ppo/latest.pt")[0]),
        ("DQN", agent("runs/dqn/latest.pt")[0]),
        ("Scripted bot", {"kind": "greedy"}),
        ("Random", {"kind": "random"}),
    ]
    n = len(players)
    score = [[None] * n for _ in range(n)]
    detail = []
    for i in range(n):
        for j in range(i + 1, n):
            w, l, d, length = play_match(players[i][1], players[j][1], games=games, seed=11,
                                         opening_plies=0, random_opening=4)
            score[i][j], score[j][i] = round((w + d / 2) / games, 3), round((l + d / 2) / games, 3)
            detail.append({"a": players[i][0], "b": players[j][0], "wins": w, "losses": l, "draws": d})
            print(json.dumps(detail[-1]), flush=True)
    json.dump({"names": [p[0] for p in players], "score": score, "detail": detail,
               "note": f"{games} games per pairing, sides alternating. The first 4 actions of every game are random so "
                       "that games differ; after that every player picks its best move. \"+ search\" means a "
                       "200-simulation tree search guided by that network; PPO's network has a value output, so it "
                       "can be searched the same way, while DQN's cannot."},
              open("runs/tournament.json", "w"))


if __name__ == "__main__":
    {"curve": curve, "tournament": tournament}[sys.argv[1]]()
