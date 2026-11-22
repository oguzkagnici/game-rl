"""AlphaZero-style training for Toy Battle, one network for all 8 terrains.

Loop:  self-play with tree search guided by the current network  ->  train the network to predict
the search's move distribution and the game result  ->  repeat.  Every self-play game is on a random
terrain with a random first player.

    python train.py --hours 6            # resumes automatically from runs/main
"""
import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from toybattle import model as M
from toybattle.arena import heuristic_agent, play_match
from toybattle.engine import FEAT, NA, Pool
from toybattle.terrains import NAMES


class SelfPlay:
    """Keeps `n` games going and yields finished training positions.

    Playout-cap randomisation: most moves get a cheap search, a random quarter get a full search with
    exploration noise and only those are policy targets.  Forced moves are played without a search.
    """

    def __init__(self, n, cfg, seed):
        self.cfg, self.n = cfg, n
        self.pool = Pool(n, seed=seed)
        self.rng = np.random.default_rng(seed)
        self.traj = [[] for _ in range(n)]
        self.count = [0] * n
        self.full = [False] * n
        self.ter = [0] * n
        self.out = []
        self.first = [0] * n
        self.stats = {"games": 0, "turns": 0, "draws": 0, "first_wins": 0, "blue_wins": 0}
        for i in range(n):
            self._new(i)
            self._begin(i)

    def _new(self, i):
        self.ter[i] = int(self.rng.integers(8))
        self.first[i] = int(self.rng.integers(2))
        self.pool.reset(i, self.ter[i], self.first[i])
        self.traj[i], self.count[i] = [], 0

    def _begin(self, i):
        c, pool = self.cfg, self.pool
        while True:                                  # play forced moves straight away
            legal = np.nonzero(pool.legal(i))[0]
            if len(legal) > 1:
                break
            self._step(i, int(legal[0]))
        self.full[i] = self.rng.random() < c.p_full
        if self.full[i]:
            pool.begin(i, c.full_sims, c.full_deals, c.noise_eps, c.noise_alpha)
        else:
            pool.begin(i, c.fast_sims, c.fast_deals)

    def _step(self, i, a):
        winner = self.pool.step(i, a)
        self.count[i] += 1
        if winner >= 0:
            for feat, pi, t, q, full in self.traj[i]:
                z = 0.0 if winner == 2 else (1.0 if t == winner else -1.0)
                self.out.append((feat, pi, z, q, full))
            s = self.stats
            s["games"] += 1
            s["turns"] += self.pool.state(i)["nturn"]
            s["draws"] += winner == 2
            s["first_wins"] += winner == self.first[i]
            s["blue_wins"] += winner == 0
            self._new(i)

    def play(self, evaluator, n_positions):
        self.out, pool = [], self.pool
        while len(self.out) < n_positions:
            m = pool.collect()
            if m:
                pool.apply(*evaluator(pool.feats[:m]))
            for i in pool.finished():
                visits, q = pool.result(i)
                pi = visits / visits.sum()
                p = pi if self.count[i] < self.cfg.temp_actions else pi ** 4
                a = int(self.rng.choice(NA, p=p / p.sum()))
                self.traj[i].append((pool.features(i), pi, pool.turn(i), q, self.full[i]))
                self._step(i, a)
                self._begin(i)
        return self.out

    def pop_stats(self):
        s, self.stats = self.stats, {k: 0 for k in self.stats}
        return s


class Replay:
    def __init__(self, capacity):
        self.cap, self.size, self.ptr, self.total = capacity, 0, 0, 0
        self.feat = np.zeros((capacity, FEAT), np.float16)
        self.pi = np.zeros((capacity, NA), np.float16)
        self.z = np.zeros(capacity, np.float32)
        self.q = np.zeros(capacity, np.float32)
        self.full = np.zeros(capacity, np.bool_)

    def add(self, samples):
        for feat, pi, z, q, full in samples:
            j = self.ptr
            self.feat[j], self.pi[j], self.z[j], self.q[j], self.full[j] = feat, pi, z, q, full
            self.ptr = (self.ptr + 1) % self.cap
            self.size = min(self.size + 1, self.cap)
            self.total += 1

    def sample(self, batch, rng):
        window = int(min(self.size, max(40000, self.total * 0.5)))      # the most recent half of everything
        idx = (self.ptr - 1 - rng.integers(0, window, batch)) % self.cap
        return (torch.from_numpy(self.feat[idx].astype(np.float32)), torch.from_numpy(self.pi[idx].astype(np.float32)),
                torch.from_numpy(self.z[idx]), torch.from_numpy(self.q[idx]), torch.from_numpy(self.full[idx]))

    def save(self, path):
        n = self.size
        order = (self.ptr - n + np.arange(n)) % self.cap
        np.savez(path, feat=self.feat[order], pi=self.pi[order], z=self.z[order], q=self.q[order],
                 full=self.full[order], total=self.total)

    def load(self, path):
        d = np.load(path)
        n = len(d["z"])
        self.feat[:n], self.pi[:n], self.z[:n], self.q[:n], self.full[:n] = d["feat"], d["pi"], d["z"], d["q"], d["full"]
        self.size, self.ptr, self.total = n, n % self.cap, int(d["total"])


def train_steps(net, opt, replay, steps, cfg, rng):
    net.train()
    pl = vl = 0.0
    for _ in range(steps):
        feat, pi, z, q, full = replay.sample(cfg.batch, rng)
        logits, v = net(feat)
        ce = -(pi * F.log_softmax(logits, dim=1)).sum(1)
        w = full.float()
        p_loss = (ce * w).sum() / w.sum().clamp(min=1)
        v_loss = F.mse_loss(v, (1 - cfg.q_mix) * z + cfg.q_mix * q)
        opt.zero_grad()
        (p_loss + v_loss).backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 2.0)
        opt.step()
        pl += p_loss.item()
        vl += v_loss.item()
    net.eval()
    return pl / steps, vl / steps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="runs/main")
    ap.add_argument("--hours", type=float, default=6.0)
    ap.add_argument("--games", type=int, default=256, help="parallel self-play games")
    ap.add_argument("--iter-positions", type=int, default=20000)
    ap.add_argument("--full-sims", type=int, default=50, help="simulations per deal in a full search")
    ap.add_argument("--full-deals", type=int, default=4)
    ap.add_argument("--fast-sims", type=int, default=20)
    ap.add_argument("--fast-deals", type=int, default=2)
    ap.add_argument("--p-full", type=float, default=0.25)
    ap.add_argument("--noise-eps", type=float, default=0.25)
    ap.add_argument("--noise-alpha", type=float, default=0.3)
    ap.add_argument("--temp-actions", type=int, default=16)
    ap.add_argument("--q-mix", type=float, default=0.3)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--reuse", type=float, default=4.0, help="times each position is trained on")
    ap.add_argument("--capacity", type=int, default=400000)
    ap.add_argument("--dim", type=int, default=96)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--warm-from", default="", help="replay buffer of another run: a new network first learns from it")
    ap.add_argument("--warm-steps", type=int, default=3000)
    ap.add_argument("--eval-every", type=int, default=3)
    ap.add_argument("--eval-games", type=int, default=64)
    ap.add_argument("--eval-sims", type=int, default=40)
    ap.add_argument("--eval-deals", type=int, default=4)
    cfg = ap.parse_args()

    os.makedirs(cfg.run, exist_ok=True)
    ck_path, buf_path, log_path = f"{cfg.run}/latest.pt", f"{cfg.run}/replay.npz", f"{cfg.run}/log.jsonl"
    rng = np.random.default_rng(int(time.time()))
    replay = Replay(cfg.capacity)
    it, elapsed = 0, 0.0
    if os.path.exists(ck_path):
        net, ck = M.load(ck_path)
        it, elapsed = ck["iteration"], ck["elapsed"]
        if os.path.exists(buf_path):
            replay.load(buf_path)
        print(f"resumed at iteration {it}, {replay.size} positions in replay", flush=True)
    else:
        net, ck = M.ToyNet(cfg.dim, cfg.layers), None
    opt = torch.optim.AdamW(net.parameters(), lr=cfg.lr, weight_decay=1e-4)
    if ck:
        opt.load_state_dict(ck["opt"])
        for g in opt.param_groups:               # the command line decides the learning rate
            g["lr"] = cfg.lr
    if not ck and cfg.warm_from:                 # head start: imitate the searches of an earlier run
        replay.load(cfg.warm_from)
        t0 = time.time()
        p_loss, v_loss = train_steps(net, opt, replay, cfg.warm_steps, cfg, rng)
        print(f"warm start: {cfg.warm_steps} steps on {replay.size} positions, p_loss {p_loss:.3f}, v_loss {v_loss:.3f}, "
              f"{time.time() - t0:.0f}s", flush=True)
    evaluator = M.NetEvaluator(net)
    sp = SelfPlay(cfg.games, cfg, seed=int(time.time()) % 100000)
    deadline = time.time() + cfg.hours * 3600

    while time.time() < deadline:
        t0 = time.time()
        samples = sp.play(evaluator, cfg.iter_positions)
        replay.add(samples)
        t1 = time.time()
        steps = int(len(samples) * cfg.reuse / cfg.batch)
        p_loss, v_loss = train_steps(net, opt, replay, steps, cfg, rng)
        t2 = time.time()
        it += 1
        elapsed += t2 - t0
        s = sp.pop_stats()
        g = max(s["games"], 1)
        rec = {"iter": it, "hours": round(elapsed / 3600, 3), "positions": replay.total, "games": s["games"],
               "avg_turns": round(s["turns"] / g, 1), "draws": round(s["draws"] / g, 3),
               "first_winrate": round(s["first_wins"] / g, 3), "blue_winrate": round(s["blue_wins"] / g, 3),
               "p_loss": round(p_loss, 4), "v_loss": round(v_loss, 4),
               "selfplay_s": round(t1 - t0), "train_s": round(t2 - t1)}
        if it % cfg.eval_every == 0 or it == 1:
            me = {"kind": "mcts", "evaluator": evaluator, "sims": cfg.eval_sims, "deals": cfg.eval_deals}
            score = lambda r: round((r[0] + r[2] / 2) / cfg.eval_games, 3)       # (wins + draws / 2) / games
            r = play_match(me, {"kind": "greedy"}, cfg.eval_games, seed=it, by_terrain=True)
            rec["vs_greedy"] = score(r)
            rec["vs_greedy_by_terrain"] = {NAMES[t]: round((w + d / 2) / max(w + l + d, 1), 2) for t, (w, l, d) in r[4].items()}
            rec["vs_search200"] = score(play_match(me, heuristic_agent(200, 4), cfg.eval_games, seed=it))
            rec["vs_search800"] = score(play_match(me, heuristic_agent(800, 4), cfg.eval_games, seed=it))
            rec["policy_vs_greedy"] = score(play_match({"kind": "policy", "evaluator": evaluator}, {"kind": "greedy"}, cfg.eval_games, seed=it))
            rec["eval_s"] = round(time.time() - t2)
            elapsed += time.time() - t2
        M.save(net, ck_path, iteration=it, elapsed=elapsed, opt=opt.state_dict())
        if it % 5 == 0:
            M.save(net, f"{cfg.run}/iter{it:04d}.pt", iteration=it, elapsed=elapsed)
        if it % 2 == 0:                          # the machine may be restarted at any time
            replay.save(buf_path + ".tmp.npz")
            os.replace(buf_path + ".tmp.npz", buf_path)
        with open(log_path, "a") as f:
            f.write(json.dumps(rec) + "\n")
        print(json.dumps(rec), flush=True)
    replay.save(buf_path)
    print("done", flush=True)


if __name__ == "__main__":
    main()
