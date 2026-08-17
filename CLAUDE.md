# ZEUS Protocol — working notes for Claude Code

Personal wellness app: daily agenda, routines, supplements, calendar
subscriptions, blood-panel tracking. Runs as **one self-contained HTML file**
served from GitHub Pages at `https://sax7sunny.github.io/Zeus-Protocol/`,
added to the iPhone home screen as a web app.

`ROADMAP.md` holds the plan for the backend/multi-user phase. Read it before
starting anything in that direction.

---

## Hard constraints

**One file, no build step.** Everything lives in `index.html` — markup, CSS,
JavaScript. No bundler, no npm dependencies, no separate `.js` or `.css`.
The only permitted runtime fetch is pdf.js from cdnjs, loaded lazily and only
when a PDF is opened. If a change seems to need a library, say so instead of
adding one.

**Colours come from CSS variables only.** `var(--bg)`, `--surface`, `--ink`,
`--muted`, `--faint`, `--line`, `--frost`, `--moss`, `--clay`, `--amber`,
`--rose`. Never write a hex value into a rule; the dark theme breaks in
patches when you do. Exception: the literal `#14201d` fallbacks in `html, body`
and the `theme-color` meta, which exist deliberately for iOS.

**Always run `node --check` before finishing.** Extract the script block and
check it:

```bash
python3 -c "
import re
s = open('index.html').read()
open('/tmp/a.js','w').write(re.search(r'<script>(.*?)</script>', s, re.S).group(1))"
node --check /tmp/a.js
```

A syntax error ships as a blank white page on the phone, far from any console.
Check the CSS braces balance too when you touch styles.

---

## Data model

`DEFAULT_ROUTINES` and `DEFAULT_SUPPS` are the shipped defaults. `ROUTINES` and
`SUPP_BLOCKS` are the working copies, restored from local storage on load.

**Never assume a change to the defaults reaches the user.** Saved data shadows
them completely. New defaults arrive through `mergeNewDefaults()`, which adds
anything whose id is not yet in `seenDefaults`. That is also why a routine the
user deleted on purpose stays deleted. When adding a default, give it a stable
id and let the merge do its work — do not bump `DB_KEY`, that wipes real data.

Storage key is `zeus.protocol.v2`. Every write goes through `saveAll()`, called
at the end of `render()`. Reads happen once in `loadAll()`. Both are wrapped in
try/catch and fall back to memory when storage is blocked, so the app still
runs inside sandboxed previews.

Routines carry `{id, title, time, dur, cat, days?, date?, optional?, streak?}`.
`days` holds JS weekday numbers (0 = Sunday) even though the pickers display
Monday first. `date` set means a single-date entry; `cat: 'event'` marks a
calendar event, which uses a simplified edit sheet without category or kind.

Per-day state is keyed by date string: `state[dateKey][routineId]` for ticks,
`optOn[dateKey][routineId]` for which optional routines are switched on that
day. Optional routines reset every day by design.

---

## Privacy

Biomarker panels are health data and stay on the device. They are never sent
anywhere, and must not be added to any sync payload without an explicit
decision recorded in `ROADMAP.md`.

Calendar feed URLs are secrets — anyone holding one can read the calendar
without authentication. They live in local storage only. Never commit one,
never write one into a comment or a test fixture.

---

## Style

Tone of the UI is calm and sparse: Georgia for headings, system sans for body,
generous spacing, colour used as signal rather than decoration. Match what is
already there rather than introducing a new pattern.

Text in the interface is English. Code comments explain *why*, not *what* —
the non-obvious constraint, the browser quirk, the reason a regex looks odd.

---

## Things that have already gone wrong

- Flex children need `min-width: 0`, or time and number inputs overlap on
  narrow screens.
- Safari reports a blocked fetch as `Load failed`, Chrome as `Failed to fetch`.
  Match both.
- Google and iCloud serve `.ics` without CORS headers. All calendar fetches go
  through the Cloudflare Worker proxy; a direct fetch always fails.
- Lab reports label rows like `Alpha-Globulin 1` and `CA 19-9`. Anchor value
  extraction on the unit token, not on the first number, or the label loses
  its trailing digit.
- Auto-scrolling the month grid to the current month pushed the subscription
  card out of reach. Keep controls above the scroll region reachable.
