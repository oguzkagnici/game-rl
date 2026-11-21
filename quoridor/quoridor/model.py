"""Policy/value network: a small ResNet over the 9x9 board."""
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .engine import NA, NP


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


class QuoridorNet(nn.Module):
    def __init__(self, channels=48, blocks=5):
        super().__init__()
        self.channels, self.n_blocks = channels, blocks
        self.stem = nn.Conv2d(NP, channels, 3, padding=1, bias=False)
        self.stem_bn = nn.BatchNorm2d(channels)
        self.blocks = nn.ModuleList(Block(channels) for _ in range(blocks))
        # policy: 3 output planes = pawn destination / horizontal wall / vertical wall
        self.p_conv = nn.Conv2d(channels, 32, 1, bias=False)
        self.p_bn = nn.BatchNorm2d(32)
        self.p_out = nn.Conv2d(32, 3, 1)
        self.v_conv = nn.Conv2d(channels, 8, 1, bias=False)
        self.v_bn = nn.BatchNorm2d(8)
        self.v_fc1 = nn.Linear(8 * 81, 64)
        self.v_fc2 = nn.Linear(64, 1)

    def forward(self, x):
        x = F.relu(self.stem_bn(self.stem(x)))
        for b in self.blocks:
            x = b(x)
        p = self.p_out(F.relu(self.p_bn(self.p_conv(x))))
        logits = torch.cat([p[:, 0].flatten(1),
                            p[:, 1, :8, :8].flatten(1),
                            p[:, 2, :8, :8].flatten(1)], dim=1)
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


def _mirror_action_perm():
    perm = np.zeros(NA, np.int64)
    for a in range(81):
        perm[a] = (a // 9) * 9 + 8 - a % 9
    for base in (81, 145):
        for s in range(64):
            perm[base + s] = base + (s // 8) * 8 + 7 - s % 8
    return torch.from_numpy(perm)


MIRROR_PERM = _mirror_action_perm()


def mirror(feats, policy):
    """Left-right reflection of a batch (Quoridor is symmetric under it)."""
    f = feats.flip(-1)
    f[:, 2:4] = 0
    f[:, 2:4, :8, :8] = feats[:, 2:4, :8, :8].flip(-1)
    return f, policy[:, MIRROR_PERM]


def save(net, path, **extra):
    torch.save({"channels": net.channels, "blocks": net.n_blocks,
                "state": net.state_dict(), **extra}, path)


def load(path):
    ck = torch.load(path, map_location="cpu", weights_only=False)
    net = QuoridorNet(ck["channels"], ck["blocks"])
    net.load_state_dict(ck["state"])
    net.eval()
    return net, ck
