"""Policy/value network: a small graph transformer over the bases of the terrain.

One token per base plus one global token.  Bases carry no position embedding: attention gets a
learned bonus between bases joined by a path and between bases around a common region, and the base
features hold distances to both H.Q., so the same weights play every terrain and both colours.
"""
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .engine import FB, FG, MB, NA, NT
from .terrains import static_masks


class Layer(nn.Module):
    def __init__(self, d, heads):
        super().__init__()
        self.h = heads
        self.n1, self.n2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv, self.out = nn.Linear(d, 3 * d), nn.Linear(d, d)
        self.f1, self.f2 = nn.Linear(d, 2 * d), nn.Linear(2 * d, d)

    def forward(self, x, bias):
        b, n, d = x.shape
        q, k, v = self.qkv(self.n1(x)).view(b, n, 3, self.h, d // self.h).permute(2, 0, 3, 1, 4)
        a = F.scaled_dot_product_attention(q, k, v, attn_mask=bias)
        x = x + self.out(a.transpose(1, 2).reshape(b, n, d))
        return x + self.f2(F.gelu(self.f1(self.n2(x))))


class ToyNet(nn.Module):
    def __init__(self, dim=96, layers=4, heads=4):
        super().__init__()
        self.dim, self.n_layers, self.heads = dim, layers, heads
        self.base_in, self.glob_in, self.glob_tok = nn.Linear(FB, dim), nn.Linear(FG, dim), nn.Linear(FG, dim)
        self.layers = nn.ModuleList(Layer(dim, heads) for _ in range(layers))
        self.rel = nn.Parameter(torch.zeros(layers, heads, 2))          # bonus for "path between" / "same region"
        self.norm = nn.LayerNorm(dim)
        self.p_base = nn.Linear(dim, NT + 1)       # per base: place type t here, or pick this base
        self.p_glob = nn.Linear(dim, 2 + 2 * NT + NT)   # draw, skip, place type t on enemy H.Q. 1/2, pick type t
        self.v1, self.v2 = nn.Linear(2 * dim, dim), nn.Linear(dim, 1)
        adj, share = static_masks()
        self.register_buffer("adj", torch.from_numpy(adj), persistent=False)
        self.register_buffer("share", torch.from_numpy(share), persistent=False)

    def forward(self, f):
        b = f.shape[0]
        base, glob = f[:, :MB * FB].view(b, MB, FB), f[:, MB * FB:]
        ter = glob[:, :8].argmax(1)
        exists = base[:, :, 0]
        x = torch.cat([self.glob_tok(glob)[:, None], self.base_in(base) + self.glob_in(glob)[:, None]], 1)
        pad = torch.cat([torch.zeros(b, 1), (1 - exists) * -1e9], 1)[:, None, None, :]      # nobody attends to absent bases
        rel = torch.stack([self.adj[ter], self.share[ter]], -1)                              # b, MB, MB, 2
        for i, layer in enumerate(self.layers):
            bias = torch.zeros(b, self.heads, MB + 1, MB + 1)
            bias[:, :, 1:, 1:] = torch.einsum("bijk,hk->bhij", rel, self.rel[i])
            x = layer(x, bias + pad)
        x = self.norm(x)
        g, t = x[:, 0], x[:, 1:]
        pb, pg = self.p_base(t), self.p_glob(g)
        place = torch.cat([pb[:, :, :NT].transpose(1, 2), pg[:, 2:2 + 2 * NT].view(b, NT, 2)], 2)   # b, type, 17 slots
        logits = torch.cat([pg[:, :2], place.reshape(b, NT * 17), pb[:, :, NT], pg[:, 2 + 2 * NT:]], 1)
        mean = (t * exists[:, :, None]).sum(1) / exists.sum(1, keepdim=True)
        v = torch.tanh(self.v2(F.gelu(self.v1(torch.cat([g, mean], 1))))).squeeze(1)
        return logits, v


class NetEvaluator:
    def __init__(self, net):
        self.net = net

    def __call__(self, feats):
        self.net.eval()
        with torch.inference_mode():
            logits, v = self.net(torch.from_numpy(feats))
        return logits.numpy(), v.numpy()


def save(net, path, **extra):
    torch.save({"dim": net.dim, "layers": net.n_layers, "heads": net.heads, "state": net.state_dict(), **extra}, path)


def load(path):
    ck = torch.load(path, map_location="cpu", weights_only=False)
    net = ToyNet(ck["dim"], ck["layers"], ck["heads"])
    net.load_state_dict(ck["state"])
    net.eval()
    return net, ck
