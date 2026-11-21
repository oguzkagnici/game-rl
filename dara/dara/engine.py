"""ctypes wrapper around the C++ Dara engine (engine.cpp)."""
import ctypes
import os
import subprocess

import numpy as np

ROWS, COLS = 5, 6
NC = 30           # cells
NA = 180          # 30 drops + 4*30 moves + 30 captures
NP = 10           # feature planes
MAX_PLY = 200     # after this many actions the side with more stones wins
PHASES = ("drop", "move", "capture")

_dir = os.path.dirname(os.path.abspath(__file__))
_so = os.path.join(_dir, "libdara.so")
_src = os.path.join(_dir, "engine.cpp")


def build(force=False):
    if force or not os.path.exists(_so) or os.path.getmtime(_so) < os.path.getmtime(_src):
        subprocess.check_call(["g++", "-O3", "-march=native", "-fopenmp", "-shared",
                               "-fPIC", "-o", _so, _src])


build()
_lib = ctypes.CDLL(_so)
_f32 = np.ctypeslib.ndpointer(np.float32, flags="C_CONTIGUOUS")
_i32 = np.ctypeslib.ndpointer(np.int32, flags="C_CONTIGUOUS")
_u8 = np.ctypeslib.ndpointer(np.uint8, flags="C_CONTIGUOUS")
_vp, _i, _f = ctypes.c_void_p, ctypes.c_int, ctypes.c_float
for name, res, args in [
    ("qp_new", _vp, [_i, ctypes.c_uint64]), ("qp_free", None, [_vp]),
    ("qp_set_params", None, [_vp, _f, _f]), ("qp_reset", None, [_vp, _i]),
    ("qp_step", _i, [_vp, _i, _i]), ("qp_legal", _i, [_vp, _i, _u8]),
    ("qp_turn", _i, [_vp, _i]),
    ("qp_state", None, [_vp, _i, _i32]), ("qp_features", None, [_vp, _i, _f32]),
    ("qp_greedy", _i, [_vp, _i]), ("qp_begin", None, [_vp, _i, _i, _f, _f]),
    ("qp_collect", _i, [_vp, _f32]), ("qp_apply", None, [_vp, _f32, _f32]),
    ("qp_finished", _i, [_vp, _i32]),
    ("qp_result", _f, [_vp, _i, _f32, ctypes.c_void_p]),
]:
    fn = getattr(_lib, name)
    fn.restype, fn.argtypes = res, args


class Pool:
    """`n` independent games, each with its own search tree, advanced in lock-step."""

    def __init__(self, n, seed=0, cpuct=1.5, fpu=0.25):
        self.n = n
        self._p = _lib.qp_new(n, seed)
        _lib.qp_set_params(self._p, cpuct, fpu)
        self.feats = np.zeros((n, NP, ROWS, COLS), np.float32)
        self._fin = np.zeros(n, np.int32)

    def __del__(self):
        if getattr(self, "_p", None):
            _lib.qp_free(self._p)
            self._p = None

    # --- game state -------------------------------------------------------
    def reset(self, i):
        _lib.qp_reset(self._p, i)

    def step(self, i, action):
        """Returns -1 while the game continues, 0/1 for a winner, 2 for a draw."""
        return _lib.qp_step(self._p, i, int(action))

    def legal(self, i):
        mask = np.zeros(NA, np.uint8)
        _lib.qp_legal(self._p, i, mask)
        return mask

    def turn(self, i):
        return _lib.qp_turn(self._p, i)

    def state(self, i):
        b = np.zeros(36, np.int32)
        _lib.qp_state(self._p, i, b)
        keys = ["turn", "phase", "winner", "ply", "hand0", "hand1"]
        d = {k: int(v) for k, v in zip(keys, b[:6])}
        d["board"] = b[6:].reshape(ROWS, COLS)
        return d

    def features(self, i):
        f = np.zeros((NP, ROWS, COLS), np.float32)
        _lib.qp_features(self._p, i, f)
        return f

    def greedy(self, i):
        return _lib.qp_greedy(self._p, i)

    # --- search -----------------------------------------------------------
    def begin(self, i, sims, noise_eps=0.0, noise_alpha=0.4):
        _lib.qp_begin(self._p, i, sims, noise_eps, noise_alpha)

    def collect(self):
        return _lib.qp_collect(self._p, self.feats)

    def apply(self, logits, values):
        _lib.qp_apply(self._p, np.ascontiguousarray(logits, np.float32),
                      np.ascontiguousarray(values, np.float32))

    def finished(self):
        m = _lib.qp_finished(self._p, self._fin)
        return self._fin[:m].tolist()

    def result(self, i, with_q=False):
        visits = np.zeros(NA, np.float32)
        q = np.zeros(NA, np.float32) if with_q else None
        v = _lib.qp_result(self._p, i, visits, q.ctypes.data if with_q else None)
        return (visits, v, q) if with_q else (visits, v)

    def run(self, evaluator):
        """Run all searches started with begin() to completion."""
        while True:
            m = self.collect()
            if m == 0:
                return
            logits, values = evaluator(self.feats[:m])
            self.apply(logits, values)


def heuristic_evaluator(feats):
    """No learning: uniform move priors, value = stone difference."""
    mine = (feats[:, 5, 0, 0] + feats[:, 7, 0, 0]) * 12
    theirs = (feats[:, 6, 0, 0] + feats[:, 8, 0, 0]) * 12
    pending_capture = feats[:, 4, 0, 0]
    value = np.tanh(0.5 * (mine - theirs + pending_capture)).astype(np.float32)
    return np.zeros((len(feats), NA), np.float32), value


# --- text helpers -----------------------------------------------------------
FILES = "abcdef"
DIRS = "nswe"


def cell_str(x):
    return f"{FILES[x % COLS]}{ROWS - x // COLS}"


def action_str(a):
    """c3 = drop; c3n = move the stone on c3 north (up); xc3 = capture on c3."""
    if a < 30:
        return cell_str(a)
    if a < 150:
        return cell_str((a - 30) % 30) + DIRS[(a - 30) // 30]
    return "x" + cell_str(a - 150)


def parse_action(text):
    text = text.strip().lower()
    try:
        if text.startswith("x"):
            return 150 + (ROWS - int(text[2])) * COLS + FILES.index(text[1])
        x = (ROWS - int(text[1])) * COLS + FILES.index(text[0])
        if not 0 <= x < NC:
            return None
        if len(text) == 2:
            return x
        if len(text) == 3:
            return 30 + DIRS.index(text[2]) * 30 + x
    except (ValueError, IndexError):
        pass
    return None


def render(st):
    """ASCII board. X = player 0 (moves first), O = player 1."""
    lines = []
    for r in range(ROWS):
        lines.append(f"{ROWS - r}  " + "  ".join(".XO"[v] for v in st["board"][r]))
    lines.append("   " + "  ".join(FILES))
    on = [(st["board"] == 1).sum(), (st["board"] == 2).sum()]
    lines.append(f"X: {on[0]} on board, {st['hand0']} in hand   "
                 f"O: {on[1]} on board, {st['hand1']} in hand   "
                 f"[{PHASES[st['phase']]}, action {st['ply']}/{MAX_PLY}]")
    return "\n".join(lines)
