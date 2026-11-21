"""Build the playable page from a checkpoint.

    python web/build.py [runs/main/latest.pt]

Writes web/dist/index.html + weights.json (the page fetches the weights) and
web/dist/toybattle-standalone.html (weights inlined; open it straight from disk).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from web.export import export_net, export_terrains


def about(run, spec):
    recs = [json.loads(l) for l in open(f"{run}/log.jsonl")] if os.path.exists(f"{run}/log.jsonl") else []
    recs = [r for r in recs if r["iter"] <= spec["iteration"]]
    if not recs:
        return f"Round {spec['iteration']} of self-play training."
    ev = next((r for r in reversed(recs) if "vs_greedy" in r), None)
    text = (f"One network for all 8 terrains, after {recs[-1]['hours']:.1f} hours of self-play on 4 CPU cores: "
            f"{spec['iteration']} rounds, about {round(sum(r['games'] for r in recs), -3):,} games. ")
    if ev:
        text += (f"In its last check it scored {100 * ev['vs_greedy']:.0f}% against a scripted one-move-ahead bot and "
                 f"{100 * ev['vs_search800']:.0f}% against a search with a hand-written evaluation (64 games each). ")
    return text + "It has not been measured against people."


def main(ckpt):
    os.makedirs(f"{HERE}/dist", exist_ok=True)
    _, spec = export_net(ckpt)
    json.dump(spec, open(f"{HERE}/dist/weights.json", "w"))
    data = {"terrains": export_terrains(), "about": about(os.path.dirname(ckpt), spec)}
    page = open(f"{HERE}/template.html").read().replace("/*__ENGINE__*/", open(f"{HERE}/toybattle.js").read())
    head = f"window.TB_DATA = {json.dumps(data)};"
    open(f"{HERE}/dist/index.html", "w").write(page.replace("/*__DATA__*/", head))
    standalone = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
                  '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">'
                  + page.replace("/*__DATA__*/", head + f"\nwindow.TB_WEIGHTS = {json.dumps(spec)};") + "</body></html>")
    open(f"{HERE}/dist/toybattle-standalone.html", "w").write(standalone)
    print(f"built web/dist from round {spec['iteration']}:", data["about"])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else f"{ROOT}/runs/main/latest.pt")
