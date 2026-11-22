"""Belief tracking: guess the opponent's rack from how they play.

The plain search re-deals the opponent's hidden tiles uniformly at random.  Here each game keeps a set of
"particles" (possible opponent racks).  After every action of the opponent each particle is weighted by how
likely the policy network would have chosen that action holding that rack; racks that could not have made
the move drop out.  The particles then follow the action (hidden draws are sampled) and are resampled.
The search uses particles as its deals instead of uniform re-deals.
"""
import numpy as np

from .engine import DUMP, MAXH, NA, Pool
from .terrains import MB, NT

O_RACK = 16 + MB + MB * MAXH
O_POOL, O_DISC, O_KNOWN = O_RACK + 2 * NT, O_RACK + 4 * NT, O_RACK + 6 * NT
I_TURN, I_WINNER, I_PIN, I_RNG = 1, 3, 11, 15


def _cnt(raw, off, p):
    return raw[off + p * NT: off + (p + 1) * NT]


class Belief:
    def __init__(self, games, evaluator, particles=32, fresh=0.25, temp=1.0, floor=0.02, seed=0):
        self.P, self.fresh, self.temp, self.floor = particles, fresh, temp, floor
        self.ev = evaluator
        self.rng = np.random.default_rng(seed)
        self.scratch = Pool(games * particles, seed=seed + 7)
        self.part = {}            # game -> (racks [P, NT], pools [P, NT], pins [P])
        self.stats = {"updates": 0, "collapsed": 0, "kept": 0.0, "err_belief": 0.0, "err_uniform": 0.0}

    # -- sampling --------------------------------------------------------------------------------
    def _uniform(self, raw, me, n):
        """n uniform re-deals of everything `me` cannot see in the state `raw`."""
        op = 1 - me
        rack, pool, known = (_cnt(raw, o, op).astype(np.int64) for o in (O_RACK, O_POOL, O_KNOWN))
        bag = np.repeat(np.arange(NT), rack - known + pool)
        hidden = int((rack - known).sum())
        racks = np.tile(known, (n, 1))
        pins = np.zeros(n, np.int64)
        for j in range(n):
            if hidden:
                np.add.at(racks[j], self.rng.choice(bag, hidden, replace=False), 1)
            if raw[I_PIN + op]:
                pins[j] = self._pin(racks[j])
        return racks, (rack + pool)[None, :] - racks, pins

    def _pin(self, rack):
        return 1 + self.rng.choice(NT, p=rack / rack.sum()) if rack.sum() else 0

    def _dumps(self, raw, me, racks, pools, pins):
        op = 1 - me
        d = np.tile(raw, (len(racks), 1))
        d[:, O_RACK + op * NT: O_RACK + (op + 1) * NT] = racks
        d[:, O_POOL + op * NT: O_POOL + (op + 1) * NT] = pools
        d[:, I_PIN + op] = pins
        d[:, I_RNG] = self.rng.integers(1, 2**31 - 1, len(racks))   # never the game's own random state: it fixes the real draws
        return d

    def _get(self, g, raw, me):
        if g not in self.part:
            self.part[g] = self._uniform(raw, me, self.P)
        return self.part[g]

    def reset(self, g):
        self.part.pop(g, None)

    def deals(self, g, raw, me, n):
        """n particles as full states, ready for Pool.preset."""
        racks, pools, pins = self._get(g, raw, me)
        pick = self.rng.choice(self.P, n, replace=n > self.P)
        return self._dumps(raw, me, racks[pick], pools[pick], pins[pick])

    # -- update ----------------------------------------------------------------------------------
    def update(self, items):
        """items: (game, me, state before, action, state after) for every action just played."""
        P, sc = self.P, self.scratch
        theirs = [it for it in items if it[2][I_TURN] != it[1]]
        weights = {}
        if theirs:                                   # the opponent moved: how likely was that move from each rack?
            feats = np.zeros((len(theirs) * P, sc.feats.shape[1]), np.float32)
            legal = np.zeros((len(theirs) * P, NA), bool)
            for k, (g, me, before, a, after) in enumerate(theirs):
                d = self._dumps(before, me, *self._get(g, before, me))
                for j in range(P):
                    i = k * P + j
                    sc.set_raw(i, d[j])
                    feats[i] = sc.features(i)
                    legal[i] = sc.legal(i) > 0
            logits = np.concatenate([self.ev(feats[s:s + 4096])[0] for s in range(0, len(feats), 4096)])
            logits = np.where(legal, logits, -1e9)
            logits -= logits.max(1, keepdims=True)
            prob = np.exp(logits)
            prob /= prob.sum(1, keepdims=True)
            for k, (g, me, before, a, after) in enumerate(theirs):
                op = 1 - me
                racks, pools, pins = self.part[g]
                w = np.zeros(P)
                for j in range(P):
                    i = k * P + j
                    if not legal[i, a]:
                        continue
                    w[j] = (prob[i, a] + self.floor) ** self.temp
                    sc.step(i, a)                    # the particle follows the move; its hidden draws are sampled
                    r = sc.raw(i)
                    racks[j], pools[j], pins[j] = _cnt(r, O_RACK, op), _cnt(r, O_POOL, op), r[I_PIN + op]
                weights[g] = w
        for g, me, before, a, after in items:
            if after[I_WINNER] >= 0:
                self.part.pop(g, None)
                continue
            op = 1 - me
            racks, pools, pins = self._get(g, before, me)
            w = weights.get(g, np.ones(P))
            if before[I_TURN] == me:                 # my own move: did it change their rack, or pin a tile?
                change = (_cnt(after, O_RACK, op) + _cnt(after, O_POOL, op)
                          - _cnt(before, O_RACK, op) - _cnt(before, O_POOL, op))
                for x in np.nonzero(change < 0)[0]:  # XB-42 shot a random tile out of their rack
                    w = w * racks[:, x] / np.maximum(racks.sum(1), 1)
                    racks[:, x] = np.maximum(racks[:, x] - 1, 0)
                for j in range(P):
                    if not after[I_PIN + op]:
                        pins[j] = 0
                    elif not pins[j] or racks[j, pins[j] - 1] == 0:
                        pins[j] = self._pin(racks[j])
            # a particle must agree with everything public in the real state
            true_all = _cnt(after, O_RACK, op) + _cnt(after, O_POOL, op)
            ok = ((racks + pools == true_all).all(1) & (racks.sum(1) == _cnt(after, O_RACK, op).sum())
                  & (racks >= _cnt(after, O_KNOWN, op)).all(1) & (pools >= 0).all(1))
            w = w * ok
            self.stats["updates"] += 1
            if w.sum() <= 0:
                self.stats["collapsed"] += 1
                self.part[g] = self._uniform(after, me, P)
                continue
            self.stats["kept"] += (w > 0).mean()
            keep = P - int(round(self.fresh * P))
            pick = self.rng.choice(P, keep, p=w / w.sum())
            fr, fp, fn = self._uniform(after, me, P - keep)   # a few uniform re-deals guard against a wrong belief
            true = _cnt(after, O_RACK, op)           # diagnostics only: tiles wrong per guess, belief vs uniform
            self.stats["err_belief"] += np.abs(racks[pick] - true).sum(1).mean() / 2
            self.stats["err_uniform"] += np.abs(self._uniform(after, me, 8)[0] - true).sum(1).mean() / 2
            self.part[g] = (np.concatenate([racks[pick], fr]), np.concatenate([pools[pick], fp]),
                            np.concatenate([pins[pick], fn]))
