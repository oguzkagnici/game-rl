"""Builds web/dist/story.html (the learning-curve page) from whatever result files exist under runs/."""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "..", "runs")


def rows(*parts):
    path = os.path.join(RUNS, *parts)
    if not os.path.exists(path):
        return []
    out = []
    for line in open(path):
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


DAKA_NOTE = ("Network searching 300 simulations per move. Daka Dara has no blockade rule: a side without a move passes. "
             "The network was trained with \"no legal move = loss\", so those games were stopped at the blockade and are "
             "counted separately rather than as wins. The abandoned game stood at 10 stones to 7 for the network when the "
             "game left a captured stone in its internal board and the driver could not continue. Two changes were needed "
             "to run the game outside Windows: it is told it is a web build, and its first-launch tutorial is skipped.")


def main():
    log = rows("main", "log.jsonl")
    games, az = 0, []
    for r in log:
        games += r["games"]
        az.append({"h": r["hours"], "games": games, "greedy": r.get("vs_greedy"),
                   "h200": r.get("vs_heuristic200"), "h2000": r.get("vs_heuristic2000")})
    hours = {r["iter"]: r["hours"] for r in log}
    story = {"az": az}

    ladder = []
    for r in rows("main", "ladder.jsonl"):
        m = re.match(r"iteration (\d+)", r["opponent"])
        if m:
            ladder.append({"h": hours[int(m.group(1))], "score": r["score"],
                           "w": r["wins"], "l": r["losses"], "d": r["draws"]})
    story["ladder"] = ladder

    arc = [r for r in rows("main", "arcadia.jsonl") if "game" in r]
    if arc:
        wins = sum("VICTORY" in r["end"] for r in arc)
        story["arcadia"] = {
            "games": len(arc), "wins": wins, "losses": len(arc) - wins,
            "avg_mine": sum(r["network_stones"] for r in arc) / len(arc),
            "avg_bot": sum(r["bot_stones"] for r in arc) / len(arc),
            "avg_turns": sum(r["actions"] for r in arc) / len(arc) / 2,
            "blockades": sum(r["bot_stones"] >= 3 for r in arc),
            "note": "Most games ended early by blockade: the network arranged its drops so that, after its first "
                    "capture, the bot had no legal move left, which is a loss under both rule sets (confirmed on the two games "
                    "whose final boards were recorded). Network searching 300 simulations per move and always moving first (the site gives the "
                    "human side the first move). One rule differs: the site allows a line of four but does "
                    "not count it, while the network was trained with lines of four forbidden."}

    daka = [r for r in rows("main", "dakadara_series1.jsonl") + rows("main", "dakadara.jsonl") if "game" in r]
    if daka:
        won = [r for r in daka if r["win_flag"] == 1]
        lost = [r for r in daka if r["win_flag"] != 1 and r["network_stones"] < 3]
        block = [r for r in daka if r not in won and r not in lost and r["bot_legal_moves"] == 0]
        decided = won + lost
        story["daka"] = {
            "games": len(daka), "wins": len(won), "losses": len(lost), "blockades": len(block),
            "abandoned": len(daka) - len(won) - len(lost) - len(block),
            "avg_mine": sum(r["network_stones"] for r in decided) / max(1, len(decided)),
            "avg_bot": sum(r["bot_stones"] for r in decided) / max(1, len(decided)),
            "note": DAKA_NOTE}

    curve = rows("main", "policy_curve.jsonl")
    dqn, ppo = rows("dqn", "log.jsonl"), rows("ppo", "log.jsonl")
    if curve and dqn and ppo:
        story["algos"] = {
            "az": [[r["core_hours"], r["vs_greedy"]] for r in curve],
            "ppo": [[r["hours"] * 2, r["vs_greedy"]] for r in ppo],
            "dqn": [[r["hours"] * 2, r["vs_greedy"]] for r in dqn],
            "xmax": 12,
            "note": "32 games per point. AlphaZero trained for 3 hours on 4 cores (12 core-hours); PPO and DQN "
                    "trained for 1.5 hours on 2 cores each (3 core-hours), so their curves stop early. "
                    "AlphaZero's training used search; only this measurement switches it off."}

    tpath = os.path.join(RUNS, "tournament.json")
    if os.path.exists(tpath):
        story["tournament"] = json.load(open(tpath))

    html = open(os.path.join(HERE, "story_template.html")).read()
    html = html.replace("/*__STORY__*/null", json.dumps(story, separators=(",", ":")))
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    out = os.path.join(HERE, "dist", "story.html")
    open(out, "w").write(html)
    print("built", out, {k: (len(v) if isinstance(v, list) else "yes") for k, v in story.items()})


if __name__ == "__main__":
    main()
