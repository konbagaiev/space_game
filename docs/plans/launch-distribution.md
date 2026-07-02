# Launch & distribution — where to post Vega Sentinels for feedback

> Self-contained brief for the **go-to-market / feedback-gathering** side of launch (NOT the technical
> build — that's `docs/plans/2026-07-01-1824-itch-html5-export.md`). This is the playbook for *where*
> to share the prototype, *how* to post, and in *what order*. English-only docs (project rule); the
> underlying discussion was in Russian, translated here. Feeds ROADMAP Phase 0's
> "Announce / share the link" item.

## Goal
Get **structured, actionable feedback** on the live itch.io prototype (guest-playable, ~15 min, browser
Three.js/WebGL space shooter with upgrades). The point of launching is feedback, not vanity installs —
so we roll out in **waves** we can actually process, starting Russian-speaking (fast, low-barrier) and
expanding to English communities, with **Yandex Games** held for a later content-update wave.

## Guiding principles
- **Waves, not a big-bang.** Post to 2–3 places, process the responses, then widen. Don't dump the link
  everywhere at once.
- **Every post needs a gameplay GIF + a "what is this" line + a direct channel for feedback.** A link
  with no explicit "where to tell me" yields almost nothing.
- **Ask narrow questions.** "What made you want to quit?" beats "how is it?". Vague asks get vague or no
  answers.
- **Match each platform's rules/etiquette** (see per-platform notes) — a mis-targeted post gets removed
  or ignored, and can burn the community.

---

## Phase 0 — Make itch.io ready for feedback (do this BEFORE inviting anyone)
The itch page must make leaving feedback trivial:
- [ ] **1 gameplay GIF** in the description (not just screenshots) — wins the first 3 seconds.
- [ ] **One "what is this" line**: genre + hook in ~10 seconds
      (e.g. "browser space shooter with ship upgrades, 4 missions, ~15 min").
- [ ] **Explicit feedback call + channel.** Enable **comments/community** on the itch page, and add a
      contact link (the Telegram community group — see `docs/plans/feedback-link.md`; EN
      `https://t.me/+DZfK9rUqmVpkYTZi`, RU `https://t.me/+BwclWW983-U5NWRi`).
- [ ] *(Optional)* a **3-question Google Form**, linked in the description and on the post-final-mission
      screen if easy to wire.

## Phase 1 — Russian-speaking communities (first wave, ~this week)
**Wave A (day 1–2)** — low-barrier, lively Telegram chats where showing WIP is normal:
- `@indiepocalypse` — large indie-dev community, WIP-friendly.
- `@gamedev_chat_rus` — indie-dev chat (ideas, problems, collaborators).
- `@gamedevtalk` — big general gamedev community.
- *(alternates)* `@gamedevcoffeeshop` (informal), `@gamedevdialog` (forum-style with topic threads).

  **Etiquette:** don't just drop a link — post "what it is / play it in 2 min / exactly what feedback I
  need" + a couple of screens or a GIF. Response rate is much higher.

**Wave B (day 3–5, if A landed)** — a **devlog on [DTF / Инди](https://dtf.ru/indie)** (also
[Gamedev](https://dtf.ru/gamedev)): the main RU platform, GIF-driven devlogs do well, comments are more
in-depth and "long-lived", and it doubles as groundwork for a future Yandex Games announcement.
Reference reading: [finding playtesters](https://dtf.ru/indie/26704-kak-iskat-pleitesterov),
[working with community feedback](https://dtf.ru/gamedev/1420925-kak-rabotat-s-fidbekom-igrovogo-komyuniti).
Also consider VK gamedev publics.

  **Post format (same everywhere, tune the tone):** 1 GIF → "made a browser prototype X, one click to
  play, ~15 min" → link → **3 specific questions**.

## Phase 2 — English-speaking communities
Note: in the Western indie scene **Telegram is barely used** — the ecosystem is Reddit + Discord.

- **Reddit — primary source of first feedback** ("play it and tell me"):
  - **r/playmygame** — literally built for this; ideal for a browser prototype.
  - **r/IndieDev**, **r/gamedev** — large, but feedback posts work on certain days/formats only.
  - **r/WebGames**, **r/incremental_games** and similar niche subs matching the genre.
  - Reddit rewards an honest tone + a real question ("I made X, what would make you quit?"), not ads.
  - ⚠️ **r/indiegames is NOT for feedback** — it's a *players'* sub. Rule 3 bans question/feedback posts;
    Rule 2 bans dev content/devlogs/marketing; Rule 4 bans A/B "capsule" tests & unfinished art; Rule 1/8
    require a gameplay image/GIF or automod removes it; Rule 7 caps at 2 posts/week; Rule 12 bans all
    gen-AI content. Usable as a **pure announcement** (gameplay GIF + short title, no questions, no word
    "feedback") — not as a feedback channel.
- **Discord — where continuous conversation lives** (the Western equivalent of the RU Telegram chats):
  - Large feedback/playtest servers (channels like `#feedback`, `#playtest`, `#showcase`).
  - Engine/tool servers (e.g. a three.js Discord).
  - Consider running **our own small Discord** and linking it from itch — community + feedback pools there.
- **itch.io community itself** — for EN audiences itch is also a community, not just hosting:
  enable comments/community on the page; use the [itch.io community forums](https://itch.io/community)
  "Get feedback / playtesting" sections; **game jams** are the most organic way to get players (jam
  participants are obligated to play others' entries).

## Phase 3 — Yandex Games (later)
Hold until we've processed the first feedback wave **and** shipped a content update (enemies that require
upgrades, new weapon, new map, missions 5–6). The content bump is a natural reason for a second wave and
a stronger Yandex debut.

---

## Automating updates & feedback digests (optional, discussed)
Claude is not a background daemon — it runs when invoked (by you or on a schedule). Two workable models:
- **On-demand (recommended to start):** you say "pull what people wrote this week" → Claude reads
  threads/channels via API, produces a **digest** (praise / complaints / recurring bugs / top requests),
  and on your OK **drafts an update → you confirm → it posts**.
- **Scheduled (routines / cron):** wake a session daily/weekly to pull discussions, drop a digest
  (file / email / Telegram), and post a pre-approved update. Cleanest variant: run the scripts on the
  existing Hetzner VPS.

**Technical access:**
- **Discord** — posting via **webhook** (one URL, `curl`, no bot). Reading/summarizing needs a **bot
  token** (bot in the server) to read channels via the API.
- **Reddit** — register a "script app" for client id/secret + token; read comments and post/reply via API
  (or PRAW). ⚠️ Reddit has **strict anti-spam/anti-bot rules** — post updates under *your* name, not too
  often, or risk a ban. Read-only summarizing is fine. A **subreddit you own** makes auto-posting updates
  fully legitimate (you're the mod).

## Note on "capsule comparison" posts
A **capsule** is the Steam store cover image (the card people click). A **capsule comparison post** ("A or
B?") is a common r/IndieDev format asking for A/B cover-art feedback. Practical takeaways: (1) if you ask
for **visual** feedback (itch cover, future Steam/Yandex capsule), do it in a themed feedback thread or
r/playmygame/Discord — **not** the main feed; many subs restrict these to a weekly "Feedback Friday"
megathread. (2) Cover art materially affects click-through, so it's worth testing — just in the right
place.

---

## Out of scope
- **The technical itch build** (online build, CORS, bearer auth) — `docs/plans/2026-07-01-1824-itch-html5-export.md`
  + the `/build-itch` and `/publish-itch` skills.
- **The in-game feedback link implementation** — `docs/plans/feedback-link.md`.
- **Steam / mobile app-store distribution** — far future, not covered here.

## Source
Distilled from session `e10be5ec` (2026-07-02): "where to post the prototype to get feedback".
