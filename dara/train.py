"""AlphaZero-style training for Dara.

Loop:  self-play with MCTS guided by the current network  ->  train the network
to predict the search's move distribution and the game result  ->  repeat.

    python train.py --hours 3            # resumes automatically from runs/main
"""
import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from dara import model as M
from dara.arena import heuristic_agent, play_match
from dara.engine import COLS, NA, NP, ROWS, Pool


class SelfPlay:
    """Keeps `n` self-play games going and yields finished training positions.

    Uses playout-cap randomisation (KataGo): most moves get a cheap search just
    to keep the game moving; a random quarter get a full search with exploration
    noise, and only those are used as policy targets.  Every position is used
    as a value target.
    """

    def __init__(self, n, cfg, seed):
        self.cfg, self.n = cfg, n
        self.pool = Pool(n, seed=seed)
        self.rng = np.random.default_rng(seed)
        self.traj = [[] for _ in range(n)]
        self.ply = [0] * n
        self.full = [False] * n
        self.stats = {"games": 0, "plies": 0, "draws": 0, "p0_wins": 0}
        for i in range(n):
            self.pool.reset(i)
            self._begin(i)

    def _begin(self, i):
        c = self.cfg
        self.full[i] = self.rng.random() < c.p_full
        if self.full[i]:
            self.pool.begin(i, c.full_sims, c.noise_eps, c.noise_alpha)
        else:
            self.pool.begin(i, c.fast_sims)

    def play(self, evaluator, n_positions):
        out, pool = [], self.pool
        while len(out) < n_positions:
            m = pool.collect()
            if m:
                pool.apply(*evaluator(pool.feats[:m]))
            for i in pool.finished():
                turn = pool.turn(i)
                visits, q = pool.result(i)
                pi = visits / visits.sum()
                p = pi if self.ply[i] < self.cfg.temp_plies else pi ** 4
                a = int(self.rng.choice(NA, p=p / p.sum()))
                self.traj[i].append((pool.features(i), pi, turn, q, self.full[i]))
                winner = pool.step(i, a)
                self.ply[i] += 1
                if winner >= 0:
                    for feat, pi_, t, q_, full in self.traj[i]:
                        z = 0.0 if winner == 2 else (1.0 if t == winner else -1.0)
                        out.append((feat, pi_, z, q_, full))
                    s = self.stats
                    s["games"] += 1
                    s["plies"] += self.ply[i]
                    s["draws"] += winner == 2
                    s["p0_wins"] += winner == 0
                    self.traj[i], self.ply[i] = [], 0
                    pool.reset(i)
                self._begin(i)
        return out

    def pop_stats(self):
        s, self.stats = self.stats, {k: 0 for k in self.stats}
        return s


class Replay:
    def __init__(self, capacity):
        self.cap, self.size, self.ptr, self.total = capacity, 0, 0, 0
        self.feat = np.zeros((capacity, NP, ROWS, COLS), np.float32)
        self.pi = np.zeros((capacity, NA), np.float32)
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
        # train on the most recent half of everything ever generated (min 30k)
        window = int(min(self.size, max(30000, self.total * 0.5)))
        idx = (self.ptr - 1 - rng.integers(0, window, batch)) % self.cap
        return (torch.from_numpy(self.feat[idx]), torch.from_numpy(self.pi[idx]),
                torch.from_numpy(self.z[idx]), torch.from_numpy(self.q[idx]),
                torch.from_numpy(self.full[idx]))

    def save(self, path):
        n = self.size
        order = (self.ptr - n + np.arange(n)) % self.cap
        np.savez(path, feat=self.feat[order].astype(np.float16), pi=self.pi[order].astype(np.float16),
                 z=self.z[order], q=self.q[order], full=self.full[order], total=self.total)

    def load(self, path):
        d = np.load(path)
        n = len(d["z"])
        self.feat[:n], self.pi[:n], self.z[:n] = d["feat"], d["pi"], d["z"]
        self.q[:n], self.full[:n] = d["q"], d["full"]
        self.size, self.ptr, self.total = n, n % self.cap, int(d["total"])


def train_steps(net, opt, replay, steps, cfg, rng):
    net.train()
    pl = vl = 0.0
    for _ in range(steps):
        feat, pi, z, q, full = replay.sample(cfg.batch, rng)
        quarter = cfg.batch // 4                    # 3 quarters get a board symmetry
        for k in range(3):
            sl = slice(k * quarter, (k + 1) * quarter)
            feat[sl], pi[sl] = M.transform(feat[sl], pi[sl], k)
        logits, v = net(feat.contiguous(memory_format=torch.channels_last))
        ce = -(pi * F.log_softmax(logits, dim=1)).sum(1)
        w = full.float()
        p_loss = (ce * w).sum() / w.sum().clamp(min=1)
        target = (1 - cfg.q_mix) * z + cfg.q_mix * q
        v_loss = F.mse_loss(v, target)
        opt.zero_grad()
        (p_loss + v_loss).backward()
        opt.step()
        pl += p_loss.item()
        vl += v_loss.item()
    net.eval()
    return pl / steps, vl / steps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="runs/main")
    ap.add_argument("--hours", type=float, default=3.0)
    ap.add_argument("--games", type=int, default=256, help="parallel self-play games")
    ap.add_argument("--iter-positions", type=int, default=20000)
    ap.add_argument("--full-sims", type=int, default=200)
    ap.add_argument("--fast-sims", type=int, default=40)
    ap.add_argument("--p-full", type=float, default=0.25)
    ap.add_argument("--noise-eps", type=float, default=0.25)
    ap.add_argument("--noise-alpha", type=float, default=0.4)
    ap.add_argument("--temp-plies", type=int, default=24)
    ap.add_argument("--q-mix", type=float, default=0.3)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--reuse", type=float, default=4.0, help="times each position is trained on")
    ap.add_argument("--capacity", type=int, default=300000)
    ap.add_argument("--channels", type=int, default=64)
    ap.add_argument("--blocks", type=int, default=6)
    ap.add_argument("--eval-every", type=int, default=3)
    ap.add_argument("--eval-games", type=int, default=32)
    ap.add_argument("--eval-sims", type=int, default=100)
    cfg = ap.parse_args()

    os.makedirs(cfg.run, exist_ok=True)
    ck_path, buf_path = f"{cfg.run}/latest.pt", f"{cfg.run}/replay.npz"
    log_path = f"{cfg.run}/log.jsonl"
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
        net, ck = M.DaraNet(cfg.channels, cfg.blocks), None
    opt = torch.optim.AdamW(net.parameters(), lr=cfg.lr, weight_decay=1e-4)
    if ck:
        opt.load_state_dict(ck["opt"])
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
        rec = {"iter": it, "hours": round(elapsed / 3600, 3), "positions": replay.total,
               "games": s["games"], "avg_plies": round(s["plies"] / max(s["games"], 1), 1),
               "draws": round(s["draws"] / max(s["games"], 1), 3),
               "p0_winrate": round(s["p0_wins"] / max(s["games"], 1), 3),
               "p_loss": round(p_loss, 4), "v_loss": round(v_loss, 4),
               "selfplay_s": round(t1 - t0), "train_s": round(t2 - t1)}
        if it % cfg.eval_every == 0 or it == 1:
            me = {"kind": "mcts", "evaluator": evaluator, "sims": cfg.eval_sims}
            # score = (wins + draws / 2) / games
            w, l, d, _ = play_match(me, {"kind": "greedy"}, cfg.eval_games, seed=it)
            rec["vs_greedy"] = round((w + d / 2) / cfg.eval_games, 3)
            for sims in (200, 2000):
                w, l, d, _ = play_match(me, heuristic_agent(sims), cfg.eval_games, seed=it)
                rec[f"vs_heuristic{sims}"] = round((w + d / 2) / cfg.eval_games, 3)
            rec["eval_s"] = round(time.time() - t2)
            elapsed += time.time() - t2
        M.save(net, ck_path, iteration=it, elapsed=elapsed, opt=opt.state_dict())
        if it % 5 == 0:
            M.save(net, f"{cfg.run}/iter{it:04d}.pt", iteration=it, elapsed=elapsed)
            replay.save(buf_path)
        with open(log_path, "a") as f:
            f.write(json.dumps(rec) + "\n")
        print(json.dumps(rec), flush=True)
    replay.save(buf_path)
    print("done", flush=True)


if __name__ == "__main__":
    main()
