"""SahiSupply assistant: answers questions about the app and the current plan in plain language.

Two engines, same grounding (the stored plan document):
- "claude": used when Anthropic credentials are configured (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN).
  Claude Opus 5.5 answers using only the plan facts we pass in.
- "built-in": deterministic intent matching over the same plan facts; always available, no network.
"""
from __future__ import annotations

import logging
import os
import re

from app.modules.config_loader import get_config

log = logging.getLogger("sahisupply.assistant")

MODEL = "claude-opus-5-5"
MAX_HISTORY = 10

SUGGESTIONS = [
    "How does SahiSupply work?",
    "Which stores are short and why?",
    "What should I fix first?",
    "Why doesn't Nagpur supply the red stores?",
    "How is this better than manual planning?",
    "What do the lines on the map mean?",
]

GLOSSARY = {
    "fill rate": "Orders delivered (fill rate) = units we send ÷ units the stores need this week.",
    "orders delivered": "Orders delivered = units we send ÷ units the stores need this week.",
    "short": "Short = units a store needs this week that we cannot send.",
    "manual planning": "Manual planning (the baseline) is how a planner with a spreadsheet would split stock: biggest orders first, cheapest warehouse first, one at a time.",
    "baseline": "The baseline is the manual, spreadsheet-style plan: biggest orders first, cheapest warehouse first, one at a time. Both plans use exactly the same data.",
    "checker": "The safety check is a separate program that re-verifies every delivery (stock, expiry, fridge, truck space, closed roads). A plan that fails it is never shown as ready.",
    "safety check": "The safety check re-verifies every delivery independently: enough stock, not expiring, right storage, truck and fridge space, roads open.",
    "fingerprint": "The data fingerprint is a code computed from all the inputs. Both plans having the same fingerprint proves the comparison is fair.",
    "forecast": "The forecast predicts each store's demand from the last 6 months of sales. Three methods are tested and the most accurate one is used automatically.",
    "wape": "WAPE is the forecast error: total absolute error ÷ total actual sales. Lower is better.",
    "fefo": "FEFO = First Expired, First Out: send the batch that expires first, first.",
    "optimizer": "The optimizer is a maths engine (Google OR-Tools) that looks at all stores, warehouses and batches at once and finds the plan with the lowest cost and fewest shortages that follows every rule.",
    "expiry": "Expiry-risk units are units left in warehouses after the plan that will be too close to expiry by next week.",
}


def _pct(x) -> str:
    return "—" if x is None else f"{x * 100:.0f}%"


def _plain_alt(a: dict, names: dict) -> str:
    w = names.get(a["warehouse_id"], a["warehouse_id"])
    reason = a.get("reason", "")
    st = a.get("status")
    if st == "closed":
        return f"{w}: the road to this store is closed" if "Route" in reason or "route" in reason else f"{w} is closed this week"
    if st == "blocked":
        if "storage" in reason.lower():
            return f"{w}: the store has no suitable cold storage for it"
        return f"{w}: its stock expires too soon"
    if st == "allocated_elsewhere":
        to = ", ".join(x["outlet_id"] for x in a.get("allocated_to", []))
        return f"{w}: its stock already went to other stores ({to})"
    if st == "capacity_bound":
        return f"{w}: couldn't send more - {reason.split(':', 1)[-1].split('(')[0].strip()}"
    if st == "costlier":
        return f"{w}: costs ₹{a.get('delta_per_unit', 0):.2f} more per unit"
    if st == "no_stock":
        return f"{w} has none in stock"
    return f"{w}: not needed"


def _store_limit(reason: str | None) -> str | None:
    if not reason:
        return None
    if "cold capacity full" in reason:
        return "the store's fridge is already full"
    if "receiving capacity full" in reason:
        return "the store has no more receiving space"
    return None


def _why_short(e: dict, names: dict) -> str:
    parts = []
    if lim := _store_limit(e.get("shortage_reason")):
        parts.append(lim)
    parts += [_plain_alt(a, names) for a in e.get("alternatives", [])]
    if not parts:
        parts.append("no other warehouse stocks this product and the chosen one ran out")
    return "; ".join(parts)


def build_context(run: dict | None, module: str, warehouse_names: dict) -> dict:
    cfg = get_config(module)
    ctx: dict = {"module": cfg.display_name, "need_source": cfg.planning.need_source,
                 "rules": [r.description for r in cfg.rules if r.status == "active"], "has_plan": run is not None}
    if not run or not run.get("optimizer"):
        return ctx
    k, b = run["optimizer"]["kpis"], run["baseline"]["kpis"]
    shorts = sorted((e for e in run["explanations"] if e["shortage"] > 0),
                    key=lambda e: (e["criticality"] != "critical", -e["shortage"]))
    ctx.update({
        "scenario": run["scenario"]["name"], "status": run["status"],
        "network": run.get("network", {}).get("summary") if run.get("network") else None,
        "kpis": {"orders_delivered": _pct(k["fill_rate"]), "manual_orders_delivered": _pct(b["fill_rate"]),
                 "delivered_units": k["delivered_units"], "need_units": k["need_units"], "short_units": k["unmet_units"],
                 "manual_short_units": b["unmet_units"], "critical_short_units": k["critical_shortage_units"],
                 "manual_critical_short_units": b["critical_shortage_units"],
                 "delivery_cost_rs": round(k["transport_cost"]), "expiring_units": k["expiry_risk_units"],
                 "blocked_units_if_rules_off": (run.get("rules_off") or {}).get("kpis", {}).get("blocked_units_shipped")},
        "stores": {o: {"supplied": _pct(v["fill_rate"])} for o, v in k["by_outlet"].items()},
        "store_names": {e["outlet_id"]: e["outlet_name"] for e in run["explanations"]},
        "shortages": [{"store": e["outlet_name"], "store_id": e["outlet_id"], "product": e["product_name"],
                       "critical": e["criticality"] == "critical", "need": e["need"], "sent": e["delivered"],
                       "short": e["shortage"], "why": _why_short(e, warehouse_names)} for e in shorts[:25]],
        "suggestions": [i["statement"] for i in (run.get("insights") or {}).get("items", [])[:5]],
        "contested_pattern": run.get("contested_pattern", True),
    })
    return ctx


# ---------------------------------------------------------------- built-in engine
def _find_store(q: str, ctx: dict) -> list[str]:
    names = ctx.get("store_names", {})
    hits = []
    for sid, name in names.items():
        tokens = [t for t in re.split(r"[^a-z]+", name.lower()) if len(t) > 3 and t not in {"store", "clinic", "pharmacy", "hospital", "salon", "beauty", "kirana", "mart"}]
        if sid.lower() in q.lower() or any(t in q for t in tokens):
            hits.append(sid)
    return hits


def builtin_answer(question: str, ctx: dict) -> str:
    q = question.lower().strip()
    k = ctx.get("kpis")
    plan_hint = "" if ctx.get("has_plan") else " Make a plan first (Run plan, top right) and I can answer with your numbers."

    if re.search(r"\b(hi|hello|hey|namaste)\b", q) and len(q) < 25:
        return ("Hi! I explain your delivery plan in simple words. Ask me why a store is short, what to fix first, "
                "how SahiSupply works, or what anything on screen means." + plan_hint)

    if any(w in q for w in ("how does", "how it work", "how do you", "explain everything", "what is sahisupply", "what does this app")):
        return ("SahiSupply makes the weekly delivery plan in 4 steps:\n"
                "1. Predict - estimate how much each store will need this week from 6 months of sales.\n"
                "2. Plan - decide which warehouse and which batch goes to which store, looking at all stores at once "
                "(cheapest, freshest, and fair when stock is short).\n"
                "3. Check - a separate safety check re-verifies every delivery: stock, expiry, fridges, truck space, closed roads.\n"
                "4. Explain - every order has a 'Why?' button, and Smart suggestions tell you what would help most.")

    stores = _find_store(q, ctx) if ctx.get("has_plan") else []
    if stores and k:
        out = []
        for sid in stores[:2]:
            name = ctx["store_names"][sid]
            sup = ctx["stores"].get(sid, {}).get("supplied", "—")
            lines = [s for s in ctx["shortages"] if s["store_id"] == sid]
            if not lines:
                out.append(f"{name} gets {sup} of what it needs - no shortages this week.")
                continue
            items = "\n".join(f"- {s['product']}: {s['sent']} of {s['need']} sent ({s['short']} short). Why: {s['why']}."
                              for s in lines[:4])
            out.append(f"{name} gets {sup} of what it needs. Short items:\n{items}")
        return "\n\n".join(out)

    if any(w in q for w in ("nagpur", "not supply", "doesn't supply", "dont supply", "red store", "red dot", "contested", "remote")):
        return ("In the demo data the setting \"Remote stores share one warehouse\" is on. It closes the roads from every "
                "warehouse except Pune Hub to the far-away stores (Chandrapur, Gadchiroli, Amravati, Latur) - a deliberately hard test, "
                "because Pune Hub also has to supply the big city stores. That's why Nagpur sends them nothing. "
                "Open those roads in Network builder (click the red boxes), or switch the setting off in Rules & settings, then Run plan.")

    if any(w in q for w in ("map", "line", "dotted", "moving", "arrow")):
        return ("On the map: big dark circles are warehouses, small dots are stores (green = fully supplied, amber = mostly, "
                "red = short). Moving blue lines are deliveries flowing from a warehouse to a store - thicker means more units. "
                "Red dotted lines are closed roads, so those places are not connected. Lines are straight, not real road routes.")

    if any(w in q for w in ("weather", "rain", "live", "real time", "real-time", "monsoon")):
        return ("Live weather uses a real 7-day rain forecast (Open-Meteo) for every warehouse and store. If a city's forecast "
                "reaches the heavy-rain level (64.5 mm in a day, the IMD definition), roads touching it are closed and the plan is "
                "re-made. Find it on the What-if page under 'Live weather'. Only the weather is live - stock and demand are sample data.")

    if any(w in q for w in ("fix", "improve", "suggest", "invest", "fridge", "help most", "first")):
        if ctx.get("suggestions"):
            return "Top suggestions, each tested by re-making the plan:\n" + "\n".join(f"- {s}" for s in ctx["suggestions"][:3])
        return "No suggestions right now - none of the small changes we tested improved the plan." + plan_hint

    if any(w in q for w in ("manual", "baseline", "better", "compare", "spreadsheet", "excel")):
        if k:
            return (f"Our plan delivers {k['orders_delivered']} of what stores need; manual planning would deliver "
                    f"{k['manual_orders_delivered']} with the same stock. Units short: {k['short_units']:,} vs {k['manual_short_units']:,}."
                    + (f" Critical medicines short: {k['critical_short_units']:,} vs {k['manual_critical_short_units']:,}." if k["manual_critical_short_units"] else "")
                    + " The difference comes from looking at all stores at once instead of one warehouse at a time.")
        return "Manual planning goes biggest order first, cheapest warehouse first. Our optimizer looks at all stores at once." + plan_hint

    if any(w in q for w in ("short", "shortage", "why", "missing", "not sent", "attention")):
        if k and ctx.get("shortages"):
            top = "\n".join(f"- {s['store']}, {s['product']}: {s['short']} short. Why: {s['why']}." for s in ctx["shortages"][:4])
            return f"{k['short_units']:,} units are short this week. The biggest ones:\n{top}\nAsk me about any store by name for details."
        if k:
            return "Every store order is fully covered this week."
        return "I can tell you which stores are short and why." + plan_hint

    if any(w in q for w in ("what-if", "what if", "scenario", "festival", "closed warehouse", "outage")):
        return ("What-if lets you try a problem and re-plan instantly: Festival rush (+40% demand), Warehouse closed, "
                "Monsoon road closures, Fridge breakdown, or Live weather (real rain forecast). It shows what changes and which stores are hit hardest.")

    if any(w in q for w in ("network builder", "remove warehouse", "add warehouse", "close road", "open road", "number of")):
        return ("Network builder: 1) click warehouses and stores to include or remove them, 2) click any box in the road grid to "
                "open or close that road, 3) press 'Run plan with this network'. You'll see the new delivered %, a map with moving "
                "deliveries and red dotted closed roads, and how each store did.")

    if any(w in q for w in ("rule", "shelf", "days", "storage", "cold")):
        return f"Rules for {ctx['module']}:\n" + "\n".join(f"- {r}" for r in ctx["rules"])

    for term, text in GLOSSARY.items():
        if term in q:
            return text

    if k and any(w in q for w in ("summary", "overview", "status", "how are we", "result")):
        return (f"This week ({ctx['scenario']}): {k['orders_delivered']} of needs delivered ({k['delivered_units']:,} of "
                f"{k['need_units']:,} units), {k['short_units']:,} short, delivery cost ₹{k['delivery_cost_rs']:,}. "
                f"Manual planning would deliver {k['manual_orders_delivered']}. Every delivery passed the safety check.")

    return ("I'm not sure about that one. I can explain: how SahiSupply works, why a store is short (say its name), "
            "what to fix first, the map, what-if, live weather, the rules, or any term like 'fill rate'." + plan_hint)


# ---------------------------------------------------------------- Claude engine
SYSTEM_PROMPT = """You are the help assistant inside SahiSupply, a weekly delivery-planning app for Indian distributors \
(pharmacy, grocery and cosmetics). Users are planners and students who are not technical.

How the app works: it predicts each store's demand, works out how much each store needs, keeps only safe batch-to-store \
options (enough shelf life on arrival, right storage, open roads), then an optimizer chooses which warehouse and batch \
supplies each store, looking at all stores at once. A separate safety check re-verifies every delivery. It is compared \
with "manual planning" (biggest order first, cheapest warehouse first). Pages: Dashboard, Delivery plan (click a row for \
"Why?"), Network builder (switch warehouses/stores on or off, open or close roads), What-if (festival rush, warehouse \
closed, monsoon roads, fridge breakdown, live weather), Smart suggestions, Stock & expiry, Demand forecast, Map (moving \
blue lines = deliveries, red dotted = closed roads), Rules & settings. In the demo data the setting "Remote stores share \
one warehouse" closes roads from every warehouse except Pune Hub to the far-away stores. All stock and demand data is \
sample data; only the live weather is real.

Answer in simple, friendly English in at most about 120 words, using short sentences or a few bullets. Use only the \
facts in PLAN DATA for numbers, store names and reasons; if the answer is not in the data, say so and point to the page \
that shows it. Never invent numbers."""


def claude_available() -> bool:
    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def claude_answer(messages: list[dict], ctx: dict) -> str:
    import json

    import anthropic

    client = anthropic.Anthropic(timeout=60.0)
    history = [{"role": m["role"], "content": m["content"]} for m in messages[-MAX_HISTORY:]]
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low"},
        system=[
            {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": "PLAN DATA (JSON):\n" + json.dumps(ctx, ensure_ascii=False)},
        ],
        messages=history,
    )
    if response.stop_reason == "refusal":
        return "Sorry, I can't help with that. Try asking about your delivery plan."
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    return text or "Sorry, I couldn't produce an answer. Please try rephrasing."


def answer(messages: list[dict], ctx: dict) -> dict:
    question = messages[-1]["content"]
    if claude_available():
        import anthropic
        try:
            return {"reply": claude_answer(messages, ctx), "engine": "claude"}
        except anthropic.AuthenticationError:
            log.warning("assistant: Anthropic credentials rejected; using built-in engine")
        except anthropic.RateLimitError:
            log.warning("assistant: rate limited; using built-in engine")
        except anthropic.APIStatusError as exc:
            log.warning("assistant: API error %s; using built-in engine", exc.status_code)
        except anthropic.APIConnectionError:
            log.warning("assistant: cannot reach Anthropic; using built-in engine")
    return {"reply": builtin_answer(question, ctx), "engine": "built-in"}
