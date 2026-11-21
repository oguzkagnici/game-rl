"""Policy/value network: a small ResNet over the 5x6 board."""
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .engine import COLS, NA, NC, NP, ROWS


class Block(nn.Module):
    def __init__(self, ch):
        super().__init__()
        self.c1 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.b1 = nn.BatchNorm2d(ch)
        self.c2 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.b2 = nn.BatchNorm2d(ch)

    def forward(self, x):
        y = F.relu(self.b1(self.c1(x)))
        return F.relu(x + self.b2(self.c2(y)))


class DaraNet(nn.Module):
    def __init__(self, channels=64, blocks=6):
        super().__init__()
        self.channels, self.n_blocks = channels, blocks
        self.stem = nn.Conv2d(NP, channels, 3, padding=1, bias=False)
        self.stem_bn = nn.BatchNorm2d(channels)
        self.blocks = nn.ModuleList(Block(channels) for _ in range(blocks))
        # policy: 6 planes = drop here / move from here N,S,W,E / capture here
        self.p_conv = nn.Conv2d(channels, 32, 1, bias=False)
        self.p_bn = nn.BatchNorm2d(32)
        self.p_out = nn.Conv2d(32, 6, 1)
        self.v_conv = nn.Conv2d(channels, 8, 1, bias=False)
        self.v_bn = nn.BatchNorm2d(8)
        self.v_fc1 = nn.Linear(8 * NC, 64)
        self.v_fc2 = nn.Linear(64, 1)

    def forward(self, x):
        x = F.relu(self.stem_bn(self.stem(x)))
        for b in self.blocks:
            x = b(x)
        logits = self.p_out(F.relu(self.p_bn(self.p_conv(x)))).flatten(1)
        v = F.relu(self.v_bn(self.v_conv(x))).flatten(1)
        v = torch.tanh(self.v_fc2(F.relu(self.v_fc1(v)))).squeeze(1)
        return logits, v


class NetEvaluator:
    """Wraps a network as a `features -> (logits, values)` numpy callable."""

    def __init__(self, net):
        self.net = net

    def __call__(self, feats):
        self.net.eval()
        with torch.inference_mode():
            x = torch.from_numpy(feats).contiguous(memory_format=torch.channels_last)
            logits, v = self.net(x)
        return logits.numpy(), v.numpy()


def _action_perm(flip_lr, flip_ud):
    """perm[a] = index of action a after reflecting the board."""
    def cell(x):
        r, c = divmod(x, COLS)
        return (ROWS - 1 - r if flip_ud else r) * COLS + (COLS - 1 - c if flip_lr else c)
    dmap = [1 if flip_ud else 0, 0 if flip_ud else 1, 3 if flip_lr else 2, 2 if flip_lr else 3]
    perm = np.zeros(NA, np.int64)
    for x in range(NC):
        perm[x] = cell(x)
        perm[150 + x] = 150 + cell(x)
        for d in range(4):
            perm[30 + d * 30 + x] = 30 + dmap[d] * 30 + cell(x)
    return torch.from_numpy(perm)


# (dims to flip, action permutation) for the 3 non-trivial board symmetries
SYMMETRIES = [((-1,), _action_perm(True, False)),
              ((-2,), _action_perm(False, True)),
              ((-2, -1), _action_perm(True, True))]


def transform(feats, policy, k):
    """Apply symmetry k (0..2) to a batch of features and policy targets."""
    dims, perm = SYMMETRIES[k]
    out = torch.empty_like(policy)
    out[:, perm] = policy
    return feats.flip(dims), out


def save(net, path, **extra):
    torch.save({"channels": net.channels, "blocks": net.n_blocks,
                "state": net.state_dict(), **extra}, path)


def load(path):
    ck = torch.load(path, map_location="cpu", weights_only=False)
    net = DaraNet(ck["channels"], ck["blocks"])
    net.load_state_dict(ck["state"])
    net.eval()
    return net, ck
