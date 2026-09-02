# Filtered Browser — Visual Design Spec

Owner: Claude (UI/UX & Visual Design)
Status: **[DESIGN_READY]**
Applies to: `/client/**` (implemented by GPT — this file contains no code
and this file's owner made no edits under `/client/**`)

Visual reference (all 7 states + full style guide, rendered):
**https://claude.ai/code/artifact/7f3d15bc-39e9-4daf-af21-2fc22e649362**

A static copy of the same mockup is committed at
`/design/browser-mockups.html` in case the link above isn't reachable from
your environment — open it directly in any browser.

This spec does not invent a new visual language. It applies the **existing**
"יהודי כשר" design system (already live in `admin-panel/*.css`,
`dpc-app`'s `CustomerActivity.kt`/`AppStoreActivity.kt`) to the filtered
browser. Every color, type choice, and spacing value below is either taken
directly from that existing system or extends it in a way consistent with
it — never a fresh palette.

---

## 1. Color

All values are exact hex, taken from the existing system (`admin-panel`'s
`:root`, `dpc-app`'s hardcoded color strings). Two additions, both
extending — not replacing — the existing set (marked *new*).

| Token | Hex | Use |
|---|---|---|
| `bg` | `#F2F1E6` | Screen background |
| `card` | `#FFFFFF` | Address bar, cards |
| `border` | `#EAE8DC` | Card/input borders |
| `accent` | `#4B6B45` | Primary actions, links, the one brand green |
| `accent-soft` | `#6B8A65` | Secondary borders (ghost buttons) |
| `accent-tint` | `#E7ECDD` | Subtle fills (allowed-state backgrounds, chips) |
| `text` | `#1C1C1C` | Primary text |
| `text-dim` | `#8C8C86` | Secondary/caption text |
| `ok` | `#328A52` | Allowed state |
| `ok-tint` | `#E7ECDD` | Allowed background fill |
| `warn` *(new)* | `#A5661D` | Review/pending state |
| `warn-tint` *(new)* | `#FBEEDD` | Review background fill |
| `danger` | `#B3432C` | Blocked state |
| `danger-tint` | `#F6E1DC` | Blocked background fill |
| `emblem-gold-1` / `emblem-gold-2` | `#E7C874` → `#B6862B` | Home-screen emblem only — never a UI color, matches the existing metallic-gold app icon/wallpaper emblem exactly |

`warn`/`warn-tint` are new to this file but not new to the product: they
match the `#A5661D`/`#FBEEDD` pair already established for the
"REVIEW"-equivalent status in `device-lab/admin-panel/styles.css` earlier
in this project. Reusing those exact values, not inventing new ones.

**Rule for state colors:** `ok` = system decided ALLOW. `warn` = system is
still deciding (REVIEW/pending) or a technical failure (offline/error) —
**never used to mean "safe."** `danger` = system decided BLOCK. A technical
error (§7) uses `warn`, not `danger` — it is not a policy decision, and
must not visually read as one.

## 2. Typography

**Implementation (Android, what GPT should actually ship):** reuse exactly
what `dpc-app` already does — no new font resource, no APK weight added,
visual consistency with the rest of the app suite:
- Headlines → `Typeface.create("sans-serif-black", Typeface.NORMAL)`
- Emphasized/UI labels → `Typeface.create("sans-serif-medium", Typeface.NORMAL)`
- Body/caption → system default (Roboto)

**Type scale:**

| Role | Weight | Size (sp) | Example |
|---|---|---|---|
| Screen title | black | 18–19 | "האתר אינו מאושר" |
| Wordmark | black | 17 | "דפדפן כשר" |
| Body strong | medium | 14.5–15 | button labels |
| Body | regular | 13–13.5 | explanatory text |
| Caption | regular | 11–12.5 | domain, timestamps |
| Label (uppercase) | medium | 11, +0.06em tracking | status pills |

In the reference mockup (a web page, not the Android app itself), **Rubik**
stands in for this scale since Android's native `sans-serif-black` isn't
renderable in a browser — the mockup's own note says so explicitly. Do not
bundle Rubik in the Android app; it exists only for this spec's visual
preview.

## 3. Spacing

8px-based scale, matching the rest of the codebase's CSS (`admin-panel`
consistently uses 8/10/14/16/20px steps):

`4` micro (icon-to-label gaps) · `8` tight (chip padding, button internal
gaps) · `14` card padding, address-bar padding · `20` gap between stacked
elements on a state screen · `32` outer screen margin (top safe area to
first element)

Corner radius: `12–14px` on buttons/inputs, `16–20px` on cards/state
containers, `999px` (full pill) on chips and status badges — same radius
vocabulary as `admin-panel`'s `.card`/`.badge`/`.stat`.

## 4. Components

- **Address bar**: white card, 14px radius, 1px `border`, leading icon
  (magnifier while idle, will hold a lock/shield glyph once HTTPS is
  connected — see §6), trailing status chip only in the Allowed state
  (§6). Never removable, never hidden — this is the one persistent piece
  of chrome (kiosk-style: no tab bar, no menu button, no bookmarks bar).
- **Primary button**: solid `accent` fill, white text, medium weight,
  12px radius, full width in state screens. Always the affirmative /
  forward action ("שלח לבדיקה", "נסה שוב") — never "cancel"/"dismiss".
- **Ghost button**: transparent fill, `accent` text, `accent-soft` 1.5px
  border. Always the secondary/exit action ("חזרה לדף הבית").
- **Status badge/chip**: pill, tinted background matching its state color
  (`ok-tint`+`ok` text, `warn-tint`+`warn` text, `danger-tint`+`danger`
  text) — never a solid fill on a small chip, that's reserved for buttons.
- **State card**: the full-bleed container used by Blocked/Review/
  Offline/Error (§7–10) — icon in a circular ring, title, optional domain
  line (monospace-ish, LTR, dimmed), body copy (max ~200px measure so
  Hebrew line length stays comfortable), action stack.
- **Icons**: keep them simple, geometric, single-color-on-tint (matches
  the existing emoji-as-icon convention already used throughout
  `admin-panel` and `dpc-app`'s own screens — e.g. ⚑/✓/⌂ in
  `CustomerActivity.kt`). The mockup uses emoji as icon placeholders for
  exactly this reason: they're a legitimate, already-used-in-this-project
  icon strategy, not just mockup shorthand. If GPT prefers real vector
  icons instead, keep them single-weight outline style at the same visual
  size, colored via the same ring-background convention shown in the
  mockup — the shape language matters more than emoji-vs-vector.

## 5. RTL

Hebrew is the only shipped language — the whole browser is RTL by default,
not a mirrored LTR layout:
- `layoutDirection="rtl"` (or the Compose/View equivalent) at the root,
  same explicit-force pattern already used in `CustomerActivity.kt`/
  `AppStoreActivity.kt` (manifest `supportsRtl` alone was found not to be
  reliably sufficient there — force it explicitly, don't rely on it).
- Address bar text reads RTL for the *label/placeholder*, but the URL
  itself is LTR content inside an RTL container (`android:textDirection="ltr"`
  on that one field, or `‎`-wrapped) — a URL split across a
  bidi boundary is unreadable. Same treatment for the domain line in state
  cards.
- Icons that imply directionality (back/forward arrows, if ever added)
  must mirror; icons that don't (shield, clock, warning triangle) must not.
- Numbers and status stepper dots (§9) read the same visual order
  regardless of RTL — don't mirror a 3-dot progress indicator.

## 6. Screen 1 — Home / Address bar (idle)

No page loaded yet. Address bar shows a placeholder ("הקלד כתובת אתר...")
in `text-dim`, magnifier leading icon. Center: the existing gold emblem
mark (small, 56–60dp) + "דפדפן כשר" wordmark + one line of reassurance
copy ("כל אתר נבדק ומאושר לפני שהוא נפתח אצלך"). Optional: a row of chips
for a few already-approved sites as a shortcut (not a new list to
maintain — reads from the same local allow-cache used for offline mode,
§9). No tab bar, no menu, no bookmarks — this is the entire home surface.

## 7. Screen 2 — Loading

Address bar now shows the real (LTR) URL being loaded. A 3px `accent`
progress bar directly under the address bar. The page content area shows
a skeleton (shimmer) placeholder, never real content — nothing renders
until a policy decision exists. If `prefers-reduced-motion`-equivalent
accessibility settings are on, drop the shimmer animation and show a
static skeleton instead.

## 8. Screen 3 — Allowed

Address bar keeps the URL, gains a small `ok`-tinted "מאושר" chip on the
trailing side. This is the **only** screen where real page content
renders. No other chrome change — the point is that "allowed" should feel
like a browser working normally, not like a special celebratory state.

## 9. Screen 4 — Blocked

Full-bleed state card, `danger-tint` background (not solid red — this
should read as "not yet approved," not as an alarm). Ring icon (⛔),
title "האתר אינו מאושר", the domain (LTR, dimmed), one line explaining why
("האתר הזה אינו ברשימת האתרים המאושרים למכשיר שלך"). Primary button
**"📨 שלח לבדיקה"** — always present, always the primary action; ghost
button "חזרה לדף הבית". Never a bare "OK"/dismiss-only screen — every
Blocked screen offers the request path forward.

## 10. Screen 5 — Review / בקשה נשלחה

Reached only after tapping "שלח לבדיקה" on the Blocked screen. Same
layout family as Blocked but `warn-tint`, ring icon ⏳, title "האתר
בבדיקה", body confirming the request was sent and that browsing other
(already-approved) sites still works. A 3-dot stepper (נשלח → בבדיקה →
הוחלט) gives a sense of progress without promising a timeframe. Only a
ghost "חזרה לדף הבית" action here — there's nothing left to "do" once a
request is filed.

## 11. Screen 6 — Offline (fail-closed)

Neutral (not `danger`, not `warn`) — this isn't a policy decision or an
error, it's an expected mode. Ring icon 📡, title "אין חיבור לאינטרנט",
body explicitly naming which sites *are* still reachable ("ניתן לגלוש רק
באתרים שכבר אושרו במכשיר הזה") followed by a chip row of 2–3 of them, so
the limitation reads as explained rather than arbitrary. Primary button
"נסה שוב". This screen only ever lists sites already present in the
signed local cache — never a live network call while explaining there's
no network.

## 12. Screen 7 — Error (couldn't check)

**Deliberately distinct from Blocked**, both visually (`warn` ring, not
`danger`) and in copy: this is a technical failure to reach the policy
server, not a decision that the site is disallowed. Title "לא ניתן היה
לבדוק את האתר", body must say plainly that the site is *not* opening
*because of* the failure ("מטעמי בטיחות, האתר לא נפתח כרגע") — this line
exists specifically so the fail-closed guarantee ("server/dependency
failure => non-ALLOW") is visible to the user, not just enforced silently.
Primary "נסה שוב", ghost "חזרה לדף הבית".

## 13. What this spec does not cover (left to GPT's implementation judgment)

- Exact dp/sp values beyond the scale in §3 (translate the scale to real
  Android dimens as fits the actual layout).
- Animation/transition curves between states (keep them brief and
  standard Material motion — nothing bespoke needed here).
- Tablet/large-screen layout (single form factor — phone — is in scope
  for Phase 0A/1).
- Real icon assets if emoji-as-icon (§4) is rejected — vector icon
  sourcing is an implementation decision, not a design-spec blocker.

---

## Process note

Per the client/server coordination protocol: this file and
`/design/browser-mockups.html` are the only changes in this update — no
`/client/**` file was touched, no backend/admin/worker code was touched.
Marking this **[DESIGN_READY]** and waiting for GPT's instruction before
any further work, per the standing rule.
