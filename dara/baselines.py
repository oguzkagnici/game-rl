"""Model-free baselines on the same environment and the same network body: DQN and PPO.

Both learn by self-play with no tree search. Because a capture is a second action by the same
player, every transition records whether the mover stays the same (sign +1) or changes (sign -1);
bootstrapped values are multiplied by that sign (negamax).

    python baselines.py dqn --hours 1
    python baselines.py ppo --hours 1
"""
import argparse
import copy
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from dara import model as M
from dara.arena import heuristic_agent, play_match
from dara.engine import COLS, NA, NP, ROWS, Pool


class VecEnv:
    """n games stepped together; finished games restart immediately."""

    def __init__(self, n, seed):
        self.n, self.pool, self.games = n, Pool(n, seed=seed), 0
        for i in range(n):
            self.pool.reset(i)

    def observe(self):
        feats = np.stack([self.pool.features(i) for i in range(self.n)])
        masks = np.stack([self.pool.legal(i) for i in range(self.n)]).astype(bool)
        return feats, masks

    def step(self, actions):
        """reward is from the mover's point of view; same = the mover acts again next."""
        reward = np.zeros(self.n, np.float32)
        done = np.zeros(self.n, bool)
        same = np.zeros(self.n, bool)
        for i, a in enumerate(actions):
            mover = self.pool.turn(i)
            w = self.pool.step(i, int(a))
            if w < 0:
                same[i] = self.pool.turn(i) == mover
            else:
                done[i] = True
                reward[i] = 0.0 if w == 2 else (1.0 if w == mover else -1.0)
                self.pool.reset(i)
                self.games += 1
        return reward, done, same


def evaluate(net, games=32):
    me = {"kind": "policy", "evaluator": M.NetEvaluator(net)}
    out = {}
    for name, opp in [("vs_random", {"kind": "random"}), ("vs_greedy", {"kind": "greedy"}),
                      ("vs_heuristic200", heuristic_agent(200))]:
        w, l, d, _ = play_match(me, opp, games=games, seed=1)
        out[name] = round((w + d / 2) / games, 3)
    return out


class Logger:
    def __init__(self, run, algo, hours, eval_minutes):
        os.makedirs(run, exist_ok=True)
        self.run, self.algo, self.budget = run, algo, hours * 3600
        self.every, self.t0, self.eval_time, self.next = eval_minutes * 60, time.time(), 0.0, 0.0
        self.f = open(os.path.join(run, "log.jsonl"), "w")

    def elapsed(self):                       # training time only; evaluation is not counted
        return time.time() - self.t0 - self.eval_time

    def maybe(self, net, force=False, **row):
        if not force and self.elapsed() < self.next:
            return
        self.next = self.elapsed() + self.every
        hours = round(self.elapsed() / 3600, 3)
        t = time.time()
        row = {"algo": self.algo, "hours": hours, **row, **evaluate(net)}
        self.eval_time += time.time() - t
        M.save(net, os.path.join(self.run, "latest.pt"), algo=self.algo, hours=hours)
        print(json.dumps(row), flush=True)
        self.f.write(json.dumps(row) + "\n")
        self.f.flush()


def train_dqn(args):
    """Double DQN: epsilon-greedy self-play, replay buffer, target network."""
    net = M.DaraNet()
    target = copy.deepcopy(net).eval()
    opt = torch.optim.Adam(net.parameters(), lr=5e-4)
    env = VecEnv(args.envs, args.seed)
    log = Logger(args.run, "dqn", args.hours, args.eval_minutes)
    cap, n, gamma, batch = 300_000, args.envs, 0.99, 256
    S = np.zeros((cap, NP, ROWS, COLS), np.float32)
    S2 = np.zeros((cap, NP, ROWS, COLS), np.float32)
    M2 = np.zeros((cap, NA), bool)
    A = np.zeros(cap, np.int64)
    R = np.zeros(cap, np.float32)
    D = np.zeros(cap, np.float32)
    SG = np.zeros(cap, np.float32)
    pos = size = steps = updates = 0
    loss_avg = 0.0
    rng = np.random.default_rng(args.seed)
    feats, masks = env.observe()
    log.maybe(net, steps=0, games=0)
    while log.elapsed() < log.budget:
        eps = max(0.05, 1.0 - 0.95 * (log.elapsed() / log.budget) / 0.3)
        net.eval()
        with torch.inference_mode():
            q = net(torch.from_numpy(feats))[0].numpy().copy()
        q[~masks] = -1e9
        act = q.argmax(1)
        explore = rng.random(n) < eps
        act[explore] = (rng.random((n, NA)) * masks).argmax(1)[explore]
        reward, done, same = env.step(act)
        feats2, masks2 = env.observe()
        idx = (pos + np.arange(n)) % cap
        S[idx], A[idx], R[idx], D[idx] = feats, act, reward, done
        SG[idx], S2[idx], M2[idx] = np.where(same, 1.0, -1.0), feats2, masks2
        pos, size, steps = (pos + n) % cap, min(cap, size + n), steps + n
        feats, masks = feats2, masks2
        if size < 5000:
            continue
        for _ in range(args.dqn_updates):
            b = rng.integers(0, size, batch)
            s, s2 = torch.from_numpy(S[b]), torch.from_numpy(S2[b])
            with torch.no_grad():
                net.eval()
                q2 = net(s2)[0].masked_fill(~torch.from_numpy(M2[b]), -1e9)
                best = q2.argmax(1, keepdim=True)                     # online net picks ...
                qt = target(s2)[0].gather(1, best).squeeze(1)         # ... target net scores
                y = torch.from_numpy(R[b]) + (1 - torch.from_numpy(D[b])) * gamma * torch.from_numpy(SG[b]) * qt
                y = y.clamp(-1, 1)
            net.train()
            qa = net(s)[0].gather(1, torch.from_numpy(A[b]).unsqueeze(1)).squeeze(1)
            loss = F.smooth_l1_loss(qa, y)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            opt.step()
            updates += 1
            loss_avg = 0.99 * loss_avg + 0.01 * loss.item()
            if updates % 500 == 0:
                target.load_state_dict(net.state_dict())
        log.maybe(net, steps=steps, games=env.games, updates=updates, eps=round(eps, 3), loss=round(loss_avg, 4))
    log.maybe(net, force=True, steps=steps, games=env.games, updates=updates, eps=0.05, loss=round(loss_avg, 4))


def train_ppo(args):
    """PPO: sample from the policy, estimate advantages with GAE, clipped policy-gradient update."""
    net = M.DaraNet()
    opt = torch.optim.Adam(net.parameters(), lr=3e-4)
    env = VecEnv(args.envs, args.seed)
    log = Logger(args.run, "ppo", args.hours, args.eval_minutes)
    n, T, gamma, lam, clip = args.envs, 64, 0.997, 0.95, 0.2
    steps = updates = 0
    feats, masks = env.observe()
    log.maybe(net, steps=0, games=0)
    while log.elapsed() < log.budget:
        Fs = np.zeros((T, n, NP, ROWS, COLS), np.float32)
        Ms = np.zeros((T, n, NA), bool)
        As = np.zeros((T, n), np.int64)
        Rs = np.zeros((T, n), np.float32)
        Ds = np.zeros((T, n), np.float32)
        Ss = np.zeros((T, n), np.float32)
        net.eval()
        for t in range(T):
            with torch.inference_mode():
                logits = net(torch.from_numpy(feats))[0].masked_fill(~torch.from_numpy(masks), -1e9)
                act = torch.distributions.Categorical(logits=logits).sample().numpy()
            Fs[t], Ms[t], As[t] = feats, masks, act
            Rs[t], done, same = env.step(act)
            Ds[t], Ss[t] = done, np.where(same, 1.0, -1.0)
            feats, masks = env.observe()
        steps += T * n

        X = torch.from_numpy(Fs).flatten(0, 1)
        MK = torch.from_numpy(Ms).flatten(0, 1)
        ACT = torch.from_numpy(As).flatten()
        with torch.no_grad():
            net.train()                                  # refresh batch-norm statistics only
            for chunk in X.split(2048):
                net(chunk)
            net.eval()                                   # everything below uses fixed statistics
            out = [net(chunk) for chunk in X.split(2048)]
            logits = torch.cat([o[0] for o in out]).masked_fill(~MK, -1e9)
            old_logp = F.log_softmax(logits, 1).gather(1, ACT.unsqueeze(1)).squeeze(1)
            V = torch.cat([o[1] for o in out]).view(T, n).numpy()
            next_v = net(torch.from_numpy(feats))[1].numpy()
        adv = np.zeros((T, n), np.float32)
        last = np.zeros(n, np.float32)
        for t in reversed(range(T)):                     # negamax GAE
            alive = 1.0 - Ds[t]
            delta = Rs[t] + gamma * Ss[t] * next_v * alive - V[t]
            last = delta + gamma * lam * Ss[t] * alive * last
            adv[t], next_v = last, V[t]
        RET = torch.from_numpy(adv + V).flatten()
        ADV = torch.from_numpy(adv).flatten()
        ADV = (ADV - ADV.mean()) / (ADV.std() + 1e-8)

        stats = np.zeros(3)
        for _ in range(3):
            for b in torch.randperm(T * n).split(1024):
                logits, v = net(X[b])
                logp_all = F.log_softmax(logits.masked_fill(~MK[b], -1e9), 1)
                logp = logp_all.gather(1, ACT[b].unsqueeze(1)).squeeze(1)
                ratio = (logp - old_logp[b]).exp()
                pg = -torch.min(ratio * ADV[b], ratio.clamp(1 - clip, 1 + clip) * ADV[b]).mean()
                v_loss = F.mse_loss(v, RET[b])
                entropy = -(logp_all.exp() * logp_all).sum(1).mean()
                loss = pg + 0.5 * v_loss - 0.01 * entropy
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
                opt.step()
                stats = 0.9 * stats + 0.1 * np.array([pg.item(), v_loss.item(), entropy.item()])
        updates += 1
        log.maybe(net, steps=steps, games=env.games, updates=updates,
                  v_loss=round(stats[1], 4), entropy=round(stats[2], 3))
    log.maybe(net, force=True, steps=steps, games=env.games, updates=updates,
              v_loss=round(stats[1], 4), entropy=round(stats[2], 3))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("algo", choices=["dqn", "ppo"])
    ap.add_argument("--hours", type=float, default=1.0)
    ap.add_argument("--run", default=None)
    ap.add_argument("--envs", type=int, default=None)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--eval-minutes", type=float, default=5.0)
    ap.add_argument("--dqn-updates", type=int, default=1)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    args.run = args.run or f"runs/{args.algo}"
    args.envs = args.envs or (128 if args.algo == "dqn" else 256)
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    (train_dqn if args.algo == "dqn" else train_ppo)(args)
    print("done", flush=True)
