/* Coach lessons for the sparring drill. Each lesson fires once, when the situation first comes up.
 * `when(ctx)` gets { g, s, user, ev } where ev are the log entries since the last check.
 * `body(user)` returns HTML; `table` is how the idea carries over to Star Wars: Rebellion. */
(function (root) {
  "use strict";
  var D = root.Drill;
  function evOf(ctx, kind, side) { return ctx.ev.some(function (e) { return e.kind === kind && (!side || e.side === side); }); }
  function gap(s) { return s.rep - s.time; }

  var L = [
    {
      id: "clock", title: "The clock decides how long the hunt lasts",
      when: function (c) { return c.s.phase === "setup" || (c.s.round === 1 && c.s.phase === "assign"); },
      body: function (u) {
        return "<p>Time is on 1 and reputation on 14, so the Dominion has <b>13 rounds</b> if the Insurgents never score. Each objective the Insurgents complete moves reputation one or two spaces closer. An Insurgent who scores every round closes the gap twice as fast.</p>" +
          (u === "I" ? "<p><b>Your plan:</b> objectives are your real army. Every mission and fight should either move an objective forward or keep the base hidden one more round.</p>"
                     : "<p><b>Your plan:</b> check the gap every round and ask whether your search can finish inside it. A plan that needs more rounds than the gap is not a plan.</p>");
      },
      table: "Identical: the time marker starts on 1, reputation on 14, and Rebel objective cards pull reputation toward time."
    },
    {
      id: "base", title: "Hide where the hunt is expensive",
      when: function (c) { return c.s.phase === "setup" && c.user === "I"; },
      body: function () {
        return "<p>Units move one jump per activation, and the leader you activate with pins those units for the rest of the round. So every jump between the Dominion and your base costs it a round of work with that fleet.</p>" +
          "<ul class='tight'><li><b>Far</b> from the Dominion home systems on the left.</li><li><b>Remote</b> (dashed) systems have no loyalty and no production, so nobody has a reason to fly there.</li><li><b>Away from your fleet</b> at Quessa. The hunter watches your fleet and searches around it.</li></ul>";
      },
      table: "Same reasoning. In the first game you pick from 26 systems not next to Imperial units. Pick one far from Coruscant and away from where your fleet will fight."
    },
    {
      id: "base-d", title: "Start by counting the candidates",
      when: function (c) { return c.user === "D" && c.s.phase === "assign" && c.s.round === 1; },
      body: function () {
        return "<p>The base cannot start in or next to a system that holds your units, which leaves <b>" + D.hunterCandidates(window.__g).length + " candidates</b> (dashed gold rings). Two tools shrink that list:</p>" +
          "<ul class='tight'><li><b>Probe cards</b>: certain, one per round for free, two more with a Probe mission.</li><li><b>Troops on the ground</b>: every system you land troops in is ruled out for good and, if populous, builds for you.</li></ul><p>Use both every round. Probes alone run out of time.</p>";
      },
      table: "Same two tools: probe cards (two per round) and Imperial ground units. Keep a written list of the systems still possible."
    },
    {
      id: "assign", title: "Leaders are your actions",
      when: function (c) { return c.s.phase === "assign"; },
      body: function (u) {
        return "<p>Each leader does exactly one thing per round. Send it on a <b>mission</b> now (face down), or keep it in <b>reserve</b> to activate a system or oppose an enemy mission later. You only have three to start, so the split is the most important decision of the round.</p>" +
          (u === "I" ? "<p><b>Typical Insurgent split:</b> two on missions (they build loyalty and score objectives), one in reserve to oppose a Probe or a Hunt, or to strike a weak target.</p>"
                     : "<p><b>Typical Dominion split:</b> one on a Probe mission, the rest in reserve. Troops find bases, and moving troops takes reserve leaders. Keep one spare to oppose a mission that hurts.</p>") +
          "<p>Match the leader to the job: <b>intrigue</b> is mission dice, <b>tactics</b> is extra battle dice.</p>";
      },
      table: "The same economy. Leaders go on mission cards whose skill icons they match, or stay in the pool to move units and oppose."
    },
    {
      id: "oppose", title: "Opposing: a dice duel the opposer wins on ties",
      when: function (c) { return c.s.pending && D.other(c.s.pending.side) === c.user; },
      body: function () {
        return "<p>An unopposed mission succeeds automatically. If you oppose, both leaders roll their intrigue dice and the attempt needs <b>more</b> successes, so even one die gives you a real chance. The odds are shown on each button.</p>" +
          "<p>The cost: your opposer is placed in the target system. It is spent for the round and <b>pins</b> your units there. Oppose missions that cost you something real, and let cheap ones go.</p>";
      },
      table: "Same rule: the opposing player wins ties, an unopposed mission just happens, and the opposing leader moves to that system."
    },
    {
      id: "pin", title: "Pinned: a leader freezes its own units",
      when: function (c) {
        return c.ev.some(function (e) {
          if ((e.kind !== "oppose" && e.kind !== "mission") || !e.data) return false;
          var id = e.data.opposer || e.data.leader, Ld = id && D.leader(window.__g, id);
          return Ld && Ld.side === c.user && typeof Ld.loc === "number" && D.anyUnits(window.__g, Ld.loc, c.user);
        });
      },
      body: function () {
        return "<p>Your leader just landed in a system that holds your own units. Those units cannot leave this round.</p><p><b>Use it as a weapon:</b> attempt missions in systems where the enemy fleet sits. If they oppose, their leader freezes their own fleet. If they don't, your mission succeeds for free.</p>";
      },
      table: "This is the real pinning rule, and the bait play is a standard tactic for both sides."
    },
    {
      id: "probe", title: "Probe cards: certain information every round",
      when: function (c) { return evOf(c, "probe"); },
      body: function (u) {
        return u === "D" ? "<p>Each card names a system the base is <b>not</b> in, and the map has greyed it out for you. Cards are certain but slow: one free card a round will not finish the job in time. Combine them with landings.</p><p>Draw cards early in the round, so later activations use what you learned.</p>"
          : "<p>The Dominion just ruled out more systems. Turn on <b>Show what the hunter knows</b> to see its exact list of candidates; it uses the same public information you can see.</p><p>Watch that number. When it gets small, have a Relocate ready. The new site must come from systems whose probe card has not been drawn, so relocating late leaves few good places to go.</p>";
      },
      table: "The Empire draws two probe cards per round, and Rapid Mobilization picks the new base from the probe deck: the same squeeze."
    },
    {
      id: "search", title: "Troops on the ground: the other half of the search",
      when: function (c) { return evOf(c, "search"); },
      body: function (u) {
        return u === "D" ? "<p>Every landing rules a system out for good, and a populous system you hold builds for you every round. Your fleets move one jump per round, so plan two rounds ahead: which systems will these troops search next round?</p><p>Ships alone never reveal a base. Bring troops, and remember each ship carries only two.</p>"
          : "<p>Dominion troops just searched a system. Ships alone cannot find you; only troops or Dominion loyalty can. Watch where its troop ships are and how far they are from your base.</p>";
      },
      table: "Same: only Imperial ground units (or Imperial loyalty) reveal the base, and TIE Fighters and troops need transport capacity."
    },
    {
      id: "leak", title: "Moving units out of the base gives it away",
      when: function (c) { return evOf(c, "leak"); },
      body: function (u) {
        return u === "I" ? "<p>Units left the hidden base, so the Dominion now knows the base is in that system or right next to it. The gold rings on the map just shrank.</p><p>Fight with a separate fleet and keep base units still unless the payoff is huge: an objective, or saving the base itself.</p>"
          : "<p>Units came out of the hidden base. The base must be in the activated system or next to it, and your candidate list has shrunk to match. Send troops there now.</p>";
      },
      table: "The same leak: units moving to or from the Rebel Base space tell the Empire the base is in or next to that system."
    },
    {
      id: "battle", title: "Fight only when the fight pays",
      when: function (c) { return evOf(c, "battle"); },
      body: function (u) {
        return u === "I" ? "<p>You cannot out-trade the Dominion: it builds more every round. Take a battle when it scores an objective (Hit and Run, Supply Raid, Ambush, Liberation), retakes a system, or protects the base. Otherwise move away from big stacks.</p><p>Bring your best tactics leader to the fights you pick: each point is an extra die every battle round.</p>"
          : "<p>Battles thin the Insurgents, but the clock matters more than the body count. A fight that costs you the troops you needed for next round's search is a loss even if you win it.</p><p>Watch for Insurgent strikes that score objectives: a small fleet sitting alone is an invitation for Hit and Run.</p>";
      },
      table: "Same priorities. In the real game you also choose tactic cards and can retreat if a leader is present, which makes picking your fights even more important."
    },
    {
      id: "objective", title: "Every objective is a round taken from the hunter",
      when: function (c) { return evOf(c, "objective"); },
      body: function (u) {
        return "<p>Reputation just moved. The gap is now <b>" + gap(c_s()) + "</b>.</p>" +
          (u === "I" ? "<p>Plan the next one now: look at your hand and pick the objective you can finish soonest. Later cards (stage II) are worth 2.</p>"
                     : "<p>You cannot see the Insurgents' hand, but you can see their opportunities. Undefended small stacks invite Hit and Run, unguarded home systems invite sabotage, and a string of loyal systems means a loyalty objective is close.</p>");
      },
      table: "The Rebels hold objective cards and draw more each round. Deck order is stage I, then II, then III, and the later cards are worth more."
    },
    {
      id: "sabotage", title: "Sabotage makes the hunter spend actions at home",
      when: function (c) { return evOf(c, "sabotage", "I"); },
      body: function (u) {
        return u === "I" ? "<p>A sabotaged system builds nothing until the Dominion activates it. Every leader it spends clearing sabotage is a leader that is not searching for you. Time it before the Refresh and aim at systems that make the troops it needs.</p>"
          : "<p>A sabotaged system builds nothing until you activate it. Clearing it costs a leader, so weigh it: lost production every round versus one round of search.</p>";
      },
      table: "Sabotage stops a system from building. Forum veterans aim it at stormtrooper systems right before a build, because ground units are the Empire's bottleneck."
    },
    {
      id: "exposed", title: "Your leader is standing next to the enemy",
      when: function (c) {
        if (c.user !== "I" || c.s.phase !== "command") return false;
        var g = window.__g;
        return D.leadersOf(g, "D", "mission").length > 0 && g.s.leaders.some(function (L) { return L.side === "I" && L.status === "placed" && typeof L.loc === "number" && D.anyUnits(g, L.loc, "D"); });
      },
      body: function () {
        return "<p>One of your leaders is in a system with Dominion units, and the Dominion still has a hidden mission. If it is a Hunt, that leader can be captured and miss two rounds. Keep a reserve leader with good intrigue to oppose it.</p>";
      },
      table: "Capture missions in the real game target Rebel leaders in systems with Imperial units, so know where your mission leaders end up."
    },
    {
      id: "net-i", title: "The net is closing: relocate before contact",
      when: function (c) { return c.user === "I" && !c.s.baseRevealed && c.s.phase !== "setup" && D.hunterCandidates(window.__g).length <= 4; },
      body: function () {
        var g = window.__g, after = window.DrillBots.Ins.candidatesAfterRelocation(g);
        return "<p>The Dominion is down to <b>" + D.hunterCandidates(g).length + "</b> possible systems. Relocate must be assigned during Assignment, so decide now.</p>" +
          "<ul class='tight'><li>After a relocation it would have about <b>" + after + "</b> candidates again: every undrawn probe card without Dominion units.</li><li>Units in the old base are left there and exposed, and the new base starts empty.</li><li>Move <b>before</b> its troops are one jump away. Moving with them at the door is often too late.</li></ul>";
      },
      table: "Rapid Mobilization works the same way: the new site comes from the probe deck, and units in the base space are stranded at the old location."
    },
    {
      id: "net-d", title: "Close the net",
      when: function (c) { return c.user === "D" && !c.s.baseRevealed && c.s.phase !== "setup" && D.hunterCandidates(window.__g).length <= 4; },
      body: function () {
        return "<p>Only <b>" + D.hunterCandidates(window.__g).length + "</b> systems remain. Two things matter now:</p><ul class='tight'><li>Get troops next to every remaining candidate, so one activation can land on any of them.</li><li>Relocation can only go to systems with no Dominion units and an undrawn probe card. Parking units on those systems blocks the escape routes.</li></ul>";
      },
      table: "Experienced Imperial players spread small forces onto likely relocation targets right before the Rebels can move."
    },
    {
      id: "decree", title: "A Decree searches without landing troops",
      when: function (c) { return evOf(c, "loyalty", "D"); },
      body: function (u) {
        return u === "D" ? "<p>Dominion loyalty in the base system reveals the base, so a successful Decree on a candidate either finds the base or rules the system out, and it adds production either way.</p>"
          : "<p>Dominion loyalty in your base system would reveal it. Oppose Decrees aimed at your base, but oppose some others too: if you only ever oppose one system, that is a tell.</p>";
      },
      table: "Same rule: Imperial loyalty in the base's system forces the Rebels to reveal it."
    },
    {
      id: "recruit", title: "The Dominion gets more actions as the game goes on",
      when: function (c) { return evOf(c, "recruit", "D"); },
      body: function (u) {
        return u === "I" ? "<p>The Dominion just gained a leader: one more activation or opposition every round from now on. Your best rounds for scoring are the early ones, when it is short of actions.</p>"
          : "<p>A new leader means one more search every round. Use the extra action to search, not to chase small Insurgent fleets.</p>";
      },
      table: "New leaders join both sides as the game goes on, and the Empire's action count usually grows faster."
    },
    {
      id: "tempo", title: "The last word",
      when: function (c) {
        if (c.s.phase !== "command" || c.s.pending) return false;
        var g = window.__g; return !D.canAct(g, D.other(c.user)) && D.canAct(g, c.user);
      },
      body: function () {
        return "<p>Your opponent has no leaders left this round. Everything you do now happens with full information and no chance of a reply. Keeping one more leader in reserve than your opponent buys you this moment.</p>";
      },
      table: "Same: when one player runs out of leaders, the other takes all remaining actions in a row."
    },
    {
      id: "reveal", title: "The base is revealed",
      when: function (c) { return evOf(c, "reveal"); },
      body: function (u) {
        return u === "I" ? "<p>Every Insurgent troop in that system now defends it, and they hit on 3+. Your options: reinforce from next door, or Relocate next round if a leader with intrigue 2+ is free. Each round you survive is still a round off the clock.</p>"
          : "<p>The base is found. Bring every troop that can reach it, and bring a high-tactics leader. Defenders hit on 3+, so attack with a clear majority. If you wait, a Relocate can take it away again.</p>";
      },
      table: "The units in the Rebel Base space move onto the board in that system and fight there; the base also has its own defenses."
    },
    {
      id: "endgame", title: "Endgame: three rounds or fewer",
      when: function (c) { return c.s.phase === "assign" && gap(c.s) <= 3 && !c.s.winner; },
      body: function (u) {
        return u === "I" ? "<p>Survive. Keep leaders in reserve to oppose Probes and Decrees, keep the base still, and only score if it is safe. You no longer need to win anything else.</p>"
          : "<p>All in. Any mission that cannot find the base this round is wasted. Every reserve leader should move troops onto a candidate.</p>";
      },
      table: "The late game in Rebellion has the same shape: the Rebels turtle and the Empire throws everything at its best guesses."
    }
  ];

  function c_s() { return window.__g.s; }
  root.DrillLessons = L;
})(typeof self !== "undefined" ? self : this);
