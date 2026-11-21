"""Build the playable page from a checkpoint.

    python web/build.py [runs/main/latest.pt]

Writes web/dist/index.html + weights.json (the page fetches the weights) and
web/dist/dara-standalone.html (weights inlined; open it straight from disk).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from web.export import export


def training_info(run, spec):
    recs = [json.loads(l) for l in open(f"{run}/log.jsonl")] if os.path.exists(f"{run}/log.jsonl") else []
    recs = [r for r in recs if r["iter"] <= spec["iteration"]]
    last_eval = next((r for r in reversed(recs) if "vs_greedy" in r), {})
    pct = lambda k: f"{100 * last_eval[k]:.0f}%" if k in last_eval else "n/a"
    return {
        "hours": round(recs[-1]["hours"], 1) if recs else 0,
        "games": sum(r["games"] for r in recs),
        "positions": recs[-1]["positions"] if recs else 0,
        "results": [
            ["Scripted bot that takes any three it can make", pct("vs_greedy")],
            ["Search with no network, 200 simulations", pct("vs_heuristic200")],
            ["Search with no network, 2,000 simulations", pct("vs_heuristic2000")],
        ],
        "eval_note": last_eval.get("iter"),
    }


def main(ckpt):
    os.makedirs(f"{HERE}/dist", exist_ok=True)
    _, spec = export(ckpt, f"{HERE}/dist/weights.json")
    info = training_info(os.path.dirname(ckpt), spec)
    page = open(f"{HERE}/template.html").read().replace("/*__ENGINE__*/", open(f"{HERE}/dara.js").read())
    data = f"window.DARA_INFO = {json.dumps(info)};"
    open(f"{HERE}/dist/index.html", "w").write(page.replace("/*__DATA__*/", data))
    standalone = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
                  '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">'
                  + page.replace("/*__DATA__*/", data + f"\nwindow.DARA_WEIGHTS = {json.dumps(spec)};") + "</body></html>")
    open(f"{HERE}/dist/dara-standalone.html", "w").write(standalone)
    print(f"built web/dist from iteration {spec['iteration']}", info)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else f"{ROOT}/runs/main/latest.pt")
