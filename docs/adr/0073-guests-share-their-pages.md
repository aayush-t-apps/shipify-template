---
status: accepted (merged #687 and #688, task #679, 2026-11-06) and built in two parts after the owner's `go`: Drop's (task #689, Drop 0.6.0) and Shipify's (task #690); see [As built](#as-built-2026-11-06-shipifys-part-on-task-690)
date: 2026-11-06
amends: 0071 (a guest's run may ask for a tool's guest forms, and the box makes them; its words still approve nothing; guests sign in with Google, not the One-time PIN), 0072 (a guest's page goes to Drop too, only theirs until they share it), the tool contract (`tools.json`: a tool's `guest` forms), the Drop tool (`share` optional, Only me when left out), Drop's plan (a drop's `by`, "My drops" for guests, Google at `/in`, not the One-time PIN, a new drop Only me)
---

# 0073: Guests share their own pages through Drop, private until they ask

## The plan in short

**Your asks (task #679, 2026-11-06):**
- "claude like experience for everyone including guests": a guest makes a page, gets a link, and
  shares it, as you do. "not to make doc public by default unless asked".
- "specific and personal to their files", and "check security private to each".
- Guests manage their drops in Drop: "they can see their old drops, not create new", "manage their
  access from there", "only me an admin can upload".
- "no pin based but give them google sign in", "well secure and managed".
- "least complexity simple reliable changes".
- "allow all for anyone to login using google then restrict … or we restrict on the cloudflare
  access itself".
- "for drop what is default it should private to owner then they can add or make it public".
- "A Share button at the top of their own page this might not be needed … keep it similar modular
  clean … they can all manage access there … no specific requirements just works as expected".
- "how can stranger see drop or access if given how can guest with their manage drop compared to
  owners … simplify the process".

**The answer: the chat makes pages, and Drop manages them.**
- **In the chat**, a guest asks for a page, as you do. The box gives it to Drop as a drop that only
  they can open, marked as theirs (`by`). The reply is Drop's link, and "Manage it in Drop", which
  opens that drop's page in My drops. "Change it" puts a new page on the same drop, so the link
  stays.
- **In Drop**, the guest opens **My drops**: every drop their chats made, old ones too. It is your
  admin page's drop list and drop page, reused: the same drop page, with its files and **Share**
  panel, and only the guest options. They choose who can open it there. They can't upload, add
  files or make a new drop: only you and their chats make drops.
- **The link only opens the drop,** for everyone, guests too: no button on the page itself. Each
  drop is managed on its drop page, by you or by the guest whose it is.
- **Sign-in is Google only**, through Cloudflare Access, which both apps already use: no email
  codes and no PINs. Access lets only you into the admin pages. On the two sign-in pages it lets
  anyone with Google sign in, and the app decides what they get (section 2).
- **Every new drop is Only me,** yours and guests': its owner then adds people or makes it open to
  anyone with the link (section 3).

**Who sees what, and who manages:**

| | You | A guest | Someone given a drop | A stranger |
|---|---|---|---|---|
| Sign in | as now, or Google | Google | by email: Google; by a link: none | can sign in, and sees nothing |
| Make a drop | in a chat, or Drop's **New drop** | in a chat only | no | no |
| See drops | all, in Drop's admin page | their own, in **My drops** | only the drop they were given | none |
| Manage a drop | on its drop page | on the same drop page | no | no |
| Share options | all of Drop's | Only me, Anyone with the link (view), People (view), New link, 1 to 30 days, Delete | | |
| Change a page | ask in the chat | ask in the chat | no | no |
| Upload, add files | yes | no | only through your Add or Collect link | no |

**How someone who isn't you or the guest opens a drop:** only when its owner gives it to them, in
the Share panel.
- **By a link** (Anyone with the link): the link alone opens it, with no sign-in.
- **By email** (People): they open the drop's link, sign in with Google, and Drop checks that their
  email is on the drop.
- **Nothing else opens it.** A wrong, old or expired link shows one "This link doesn't work" page.
  A stranger who signs in sees nothing. On your drops, a stranger may tap **Ask for access**, and
  only your Allow lets them in; a guest's drop has no Ask, so nothing reaches you.

- **No key and no tool in a guest's run.** Your runs don't hold Drop's write key either: they ask,
  and the box makes the call. A guest's run asks the same way, for two calls only. ADR 0071's walls
  stay.
- **The rules for sharing live in one place: Drop**, where the Share panel is.
- **Nothing new to run:** no new service, store, key or Access application. Google is one login
  method, set once.
- **The build is two PRs** after your merge and `go`: Drop first, then Shipify (section 12).

## 1. How it works for a guest

1. **Ask.** "Make a page of our trip plan." The run makes the page, as for you (`skills/drop`, "A
   page"). The box makes the drop at once: only the guest can open it, for 30 days. The reply is
   Drop's link and "Manage it in Drop" (that drop's page in their **My drops**).
2. **Open it.** The link → Drop asks them to sign in → **Continue with Google** → the page, on a
   phone too. The page also stays in their chat as a file.
3. **Share it, in Drop.** "Manage it in Drop", or **My drops** → the drop: the same drop page as
   in your admin page, with its files and the **Share** panel:

| Share option | What happens |
|---|---|
| Only me | only they can open it (the default) |
| Anyone with the link | anyone with the link can view it |
| People | the emails they add; each signs in to open it |
| New link | a new link; the old one stops at once |
| Expires | 1, 7 or 30 days from now |
| Delete | the drop and its links go |

4. **Change the page, in the chat.** "Add Tuesday's dinner" in the chat that made it → a new page on
   the same drop: the same link, the same people. From another chat: paste the page's link.
5. **They send the link themselves.** Drop sends no email (not checked, section 14).

## 2. Sign-in: Google only, through Cloudflare Access

Your words: "no pin based but give them google sign in", and "for drop sign in and shipify guest
… allow Google sign in simply".

- **Access signs people in for both apps,** before either app runs. Today its login method is an
  email code (Access calls it "One-time PIN"). Google takes its place, on two applications:
  Shipify's guests (`guest/*`) and Drop's sign-in (`/in`). No email code is left on them.
- **Both apps read the email from Access's token,** whatever the login method: Shipify's
  `edge/src/access.ts`, and Drop's copy of it (not checked). So the sign-in needs no code change.
- **Google proves who the person is. The apps still decide what they get:** Shipify's guest list
  says who is a guest; a drop's `by` and its people say who can manage it and open it.
- **One click:** when Google is an application's only login method, Access skips its own page and
  goes straight to Google (Instant Auth).
- **One sign-in for both apps,** when Shipify and Drop are in the same Access team (likely, as both
  are yours: not checked).
- **Free:** Access's free plan has Google login, and the same 50 seats.
- **More secure than codes:** no codes in email to phish or wait for, and the person's own Google
  protection (2-step check, passkeys) applies.
- **A person with no Google account** (a work email, say) makes a free one for the email they
  already have, with no Gmail (Google's "use your existing email"). Or the guest shares by a link,
  which needs no sign-in.
- **Your People in Drop:** those in Sign-in mode sign in with Google too. Easy mode needs no
  sign-in, as now.

**Where Access restricts, and where the app does.** Your words: "allow all for anyone to login
using google then restrict … or we restrict on the cloudflare access itself". Both, each where it
fits. Access proves who the person is; the app decides what they get, on every request.

| Access application | Who Access lets sign in | Then the app decides |
|---|---|---|
| Shipify's `/admin` | your email only (as now) | |
| Drop's `/admin` and `/api` | your email, and Shipify's service token on `/api` only (as now) | |
| Shipify's guests (`guest/*`) | anyone who signs in with Google | Shipify's guest list: an email not on it sees nothing |
| Drop's sign-in (`/in`; `/mine` and people links go through it) | anyone who signs in with Google | each drop: its owner (`by`) and its people; a stranger sees nothing |

- **Your admin pages are closed at Access itself:** nobody else even reaches them.
- **The two sign-in pages let anyone with Google sign in,** because the lists that decide change
  inside the apps: you add a guest in Setup → Guests, and a guest adds Sam's email in My drops. To
  list them in Access too, you would add each email twice by hand, or an app would hold a
  Cloudflare key that could also open your `/admin` (refused in ADR 0071). Drop's people change
  each time someone shares, so Access can't list them.
- **An extra wall, if you want it:** list each guest's email in the guests' policy in place of
  Everyone (ADR 0071). Shipify works the same, and you add each guest in two places. Not for
  Drop's sign-in: sharing by email would stop working.
- **Seats** (Cloudflare's docs, read 2026-11-06): each person who signs in takes a seat, and
  "once the total amount of seats … has been consumed, additional users who attempt to log in are
  blocked". The free plan has 50. You, guests, your family in Sign-in mode, each person a guest
  shares with by email, and a stranger who tries a sign-in page each take one. A link needs no
  sign-in and takes no seat. **Remove inactive users from seats** (Zero Trust → Settings → Admin
  controls; one month at the shortest) frees them by itself, and you can remove a user by hand to
  free one at once.

**You set it up once (about 10 minutes, easier on a PC):**
1. Google Cloud: an OAuth client (web app) that asks for name and email only, with its consent
   screen published, and Cloudflare's return address
   `https://<your team>.cloudflareaccess.com/cdn-cgi/access/callback`.
2. Cloudflare Zero Trust → Settings → Authentication → Login methods → Add → **Google**: its client
   ID and secret.
3. On the two applications (Shipify's guests, Drop's `/in`): tick Google and untick One-time PIN.
   Their policies stay: Allow, Include **Everyone**. Your own applications may use Google too, and
   their policies stay your email.
4. If it isn't on: **Remove inactive users from seats** (above).

Until you switch, the email code works as now: the build doesn't wait for it.

## 3. Private by default, for every drop

Your words: "for drop what is default it should private to owner then they can add or make it
public".

- **Every new drop starts as Only me:** only its owner can open it. You for your drops; the guest
  for theirs.
- **Then its owner opens it, in Drop's Share panel:** **People** (by email; each signs in with
  Google to open it), or **Anyone with the link** (view). Back to Only me at any time; **New link**
  stops the old link at once.
- **"Public" in Drop is anyone with the link.** Drop has no public list or search: its pages are
  marked noindex, a link preview shows only "Drop: a shared folder", and a link holds a 128-bit
  secret. Without the link, nobody finds the drop.

| Who makes the drop | It starts as | What changes |
|---|---|---|
| You, in Drop's admin page (**New drop**) | Only me | likely as now, as the form has no Share choice (not checked): Drop's PR checks it, and makes it so |
| You, in a chat ("make a page", "put the report in Drop") | Only me, unless your words say who ("anyone can view", "with Mom") | the Drop tool's `share` becomes optional, and Only me when left out; `skills/drop` says no who is `me` |
| A guest, in a chat | Only me, always (the guest form fixes it) | as in section 1 |

**Which to pick:** **People** for anything personal: a forwarded link opens nothing for someone not
on the list. **Anyone with the link** for what may spread, like a trip plan for a group: it needs
no sign-in, so set an expiry, and make a **New link** if it spreads too far. Your own drops also
have Anyone can add, Collect files, a PIN and Never expires; a guest's don't.

**What keeps a drop secure** (Drop's code as task #681 read it, and this ADR's additions):

| Wall | What it stops |
|---|---|
| One private R2 bucket; every file passes through Drop's Worker and its checks | a file read around the gate |
| The Worker checks each Access sign-in itself: its signature, audience, team and expiry, never a header alone | a forged sign-in |
| Your admin page and API: your email only; Shipify's service token on `/api` only | anyone else managing drops |
| Link secrets of 128 random bits; one "This link doesn't work" page for every failure | guessing a link, or learning why it failed |
| Changes only from Drop's own page (Origin), for you and for guests | another site acting in a signed-in browser |
| Pages in a sandbox with no same origin and no `connect-src` (ADR 0072) | a page reading Drop or sending data out |
| noindex, no referrer, a plain link card, logs with no tokens | a drop found by search, a preview or a log |
| Expiry: R2's rules and Drop's daily job; 30 days at most for a guest | old links that stay open |
| Google sign-in, with the person's own 2-step check and passkeys | phished or forwarded codes |

## 4. What changes in Drop

One PR. Drop's own store and Share panel do the work: nothing new to run.

| Change | What |
|---|---|
| A drop's `by` | `{ email, name }`: set only by `POST /api/drops`, with the service token; kept in `drop.json`; answered by `GET /api/drops` and `GET /api/drops/:id`; `PATCH` never changes it |
| **My drops** (`/mine`, `/mine/d/:address`) | behind the `/in` sign-in (the Worker checks its token, as on `/d` and `/h`; `/in`'s `next` also takes `/mine`). Your admin page's drop list and drop page, reused: the same UI, with only the drops whose `by` is the signed-in email, only the options of section 1, and no upload. One UI, two doors |
| Two guest routes | `PATCH` and `DELETE` `/mine/drops/:address`: the signed-in email must be the drop's `by`, the request must come from Drop's own page (Origin), and the change must be a guest option; then the same store code as the admin API |
| No "Ask for access" on a guest's drop | the page says that only the people its owner chose can open it, so no request goes to you |
| Your admin page | "for Ana" on a guest's drop; a filter by guest; **Revoke all for Ana** |
| Only me first | **New drop**, and `POST /api/drops` with no gate, make an Only me drop (section 3) |
| Its docs | `/in` signs in with Google; the Access policies of section 2 |
| Tests | each of these, and each refusal |

## 5. What changes in Shipify

One PR, after Drop's merges.

| Where | What |
|---|---|
| `tools.json` | Drop's `guest` forms: `publish` (fixed `share: "me"`; `title` capped; `files`, `expiry`) and `update` (`drop`, `title`, `files`, `delete_files`); 5 calls a run at most. `publish`'s `share` is no longer required |
| `cli/lib/plugins/tool.ts` | a tool's `guest` forms: `pre`'s shape (`call`, `fixed`, `caps`, `any`, `max`), with no fixed target, as the tool's guest mode checks whose the target is (its conformance test proves it) |
| `cli/kernel/decide.ts` | `guestsOnly` keeps the calls that fit a guest form, to make at once; the reply names the rest |
| `cli/kernel/apply.ts`, `cli/kernel/mcp-client.ts` | a guest's calls with `SHIPIFY_GUEST` from the door; their files from the run's folder or the door; the page stays in their chat |
| `cli/kernel/door.ts`, `edge/src/app.ts`, `edge/src/guests.ts` | `GET /door/guest/<id>`: `{ email, name }`, for the box's job only (its OIDC token, as `/door/file/<ref>`) |
| `tools/drop/server.ts` | `publish` with no `share` makes an Only me drop (section 3). The guest mode: `publish` sets `by` and only the guest, 30 days at most; `update` reads the drop's `by` first and changes only its title and files; answers say "you", never the email, and end with "Manage it in Drop" (`/mine/d/<address>`), never your admin link |
| `playbooks/guest.md`, `skills/drop` | a guest's page; sharing is in Drop's **My drops**; no who said is `share: "me"`, for any drop |
| Docs | `docs/tools.md` (a tool's guest forms; Only me first), `docs/channels.md` (Guests: Google sign-in in place of One-time PIN; the policies and seats of section 2), `docs/door.md`, `docs/troubleshooting.md`, `docs/security.md`, the setup page's guests line, ADR 0071 and 0072 notes |
| Tests | each form: a call that fits, and one that doesn't; a `publish` with no `share` is Only me; the guest mode on a drop not `by` that guest; no guest email in an answer; the door route's whose rule |

## 6. How it works inside

```
Guest (chat): "make a page of our trip plan"
  │
  ▼
Guest's run (no key, no tool) ── result: the page + publish ──▶ the box (decide: a guest form)
  │
  ▼
the box (apply) ── GET /door/guest/<id> ──▶ edge: { email, name } from the guest list (R2)
  │
  ▼
Drop tool (write key, on the box), SHIPIFY_GUEST ──▶ Drop's POST /api/drops (by, only the guest)
  │
  ▼
the reply: the link, and "Manage it in Drop"

Guest (Drop): /mine ── Access sign-in (Google) ──▶ Drop's Worker
  │  lists drops whose `by` is the signed-in email
  ▼
Share ── PATCH /mine/drops/:address ──▶ Drop checks `by`, Origin and the guest options
```

## 7. The rules

| Rule | Who checks | Why |
|---|---|---|
| A new drop is Only me, yours too, unless the words say who | the Drop tool and Drop | your ask: private to its owner first |
| Your admin pages: your email only, at Access | Access, then Drop and Shipify | nobody else reaches them |
| Only their own drops: `by` is their email | the Drop tool (the chat's calls); Drop (My drops) | they can't touch your drops, or another guest's |
| Only files from the chat they're in | the box | nothing of yours, or of another guest |
| A new drop is only theirs | the guest form (`share: "me"`) and the Drop tool | your ask: not public by default |
| Who can open it changes only in Drop, signed in as them | Drop | one place for sharing rules |
| People by email, view only; no upload, `add`, `collect`, PIN or `keep` | Drop | only you upload; nothing goes into your bucket through a guest |
| 30 days at most | the Drop tool and Drop | a removed guest's links end by themselves |
| Their email never shows in the chat: answers say "you" | the Drop tool | replies are kept on GitHub, which never holds a guest's email (ADR 0071) |
| A removed guest's run makes no call | the box | the door answers "not a guest" |
| Up to 5 calls a run | the guest forms | the same kind of cap as your forms' `max` |

**No web rule for guests.** A guest's run can only make a private drop, or put a new page on a drop
whose link or id is in that chat. It can't share anything, and it has no list of other drops. So a
web page that tricks the run can't open a drop to anyone: at most it changes a page from that
chat, which the run makes from the web anyway. Your runs keep ADR 0049's rule, as they can share.

## 8. Security: private to each guest

The walls of ADR 0071 stay: a guest's run holds no GitHub key, notebook or tool of yours, its
caches are its own, its files stay in R2, and its words approve nothing. Drop's own walls are in
section 3.

**Step by step** (your ask: "check security private to each"). Each step that exists today was read
in the code; the new steps are tests (sections 4 and 5).

1. **Who the guest is, in the chat:** the task's from-line, which only the door writes (ADR 0071),
   then their email from the door's list in R2. Guest ids come from emails, so one email is one
   guest. A guest's run can't ask the door for anyone: the box gives it a small, fixed set of
   variables (`runEnv`, `cli/kernel/think.ts`, and its own folders), and the door's token isn't
   one. Only the box's job has it.
2. **Who the person is, in Drop:** Access's sign-in (Google). Drop checks the
   token (its audience and team) and reads the email.
3. **Their drops:** `by` is set only by the box, through Drop's API, from the door's answer. It is
   no argument of a call, and `PATCH` never changes it. My drops shows only the drops `by` the
   signed-in email; each change checks it again, and its Origin.
4. **Their files:** only from the chat they're in, checked by the box. Each run has its own folder,
   removed before the next run on its slot (`cli/lib/sandbox.ts`), and its prompt goes on stdin.
5. **Who can open a drop:** only the guest, until they share it in Drop; then only the emails they
   add, or anyone with the link they made.
6. **Their email:** in R2 and in Drop only. Never in a call's arguments, an answer, a reply or
   GitHub.

| Risk | Wall |
|---|---|
| A guest changes your drops, or another guest's | `by`, checked by the Drop tool and by Drop |
| A guest sees another guest's drops, or yours | My drops shows only `by` the signed-in email; their run has no key and no list |
| A drop made to look like a guest's | only the box sets `by`; `PATCH` never changes it |
| A stranger signs in to Drop's My drops, or to Shipify's guests | they see nothing: no drop is `by` them, and they aren't on the guest list; at most they take a seat for a while (section 2) |
| A guest's run asks the door for another guest's email or file | it holds no door token |
| A guest shares your files | only files from the chat they're in; no upload in Drop |
| A guest's email reaches GitHub | answers say "you"; the email is never a call's argument |
| A web page tricks a guest's run | the run can't share or list: nothing opens to anyone |
| Another site makes a signed-in guest's browser change a drop | Drop's Origin check on the guest routes |
| A guest's page attacks you, or the people they share it with | Drop's page sandbox (ADR 0072): no same origin, no `connect-src` |
| An older Drop with no `by` | the Drop tool's `update` finds no `by` and changes nothing; a new drop is still only the guest's |
| A removed guest | their runs make no call; in Drop, their drops end within 30 days, or at once with **Revoke all for Ana** |

## 9. Least complexity: what is left out on purpose

- No new service, store, key or Access application; no sign-in code of our own.
- No Cloudflare key in either app to keep Access's lists in step: the apps keep the lists.
- No list of drops in a guest's prompt, no sharing calls from the chat, and no web rule for guests.
- No PIN, requests, upload or new drop for guests in Drop.
- No UI of their own for guests, and no button on a page: My drops reuses your drop list and drop
  page, and a link only opens the drop.
- No second copy of the sharing rules: Drop has them, next to its Share panel.
- No sync between the two apps: the email joins them.
- No script for the Google setup: it is four steps, once.

## 10. Options not taken

| Option | Why not |
|---|---|
| Guests share by asking in the chat (this ADR's earlier revision) | the sharing rules in Shipify, a list of drops before each run, and a web rule |
| A **Share** button on a guest's own page, when they open its link (this ADR's earlier revision) | your ask: keep it simple. The drop page in My drops does it, the same as yours, and the link only opens the drop |
| Both the chat and Drop share | the rules in two places, each with tests |
| The box keeps the ids each chat made (`own`, `made`) | whose a drop is belongs with the drop |
| Google, with the email code as a backup | your ask: no codes. A person with no Google account makes one for their own email, or gets a link |
| Our own sign-in (Auth.js, Clerk, Firebase) | sessions, a user store, keys and more code to secure; Access does it before either app runs |
| A secret "manage" link for each guest | a forwarded link gives control |
| Guests as People in Drop, with home pages | Drop would need your guest list: two lists to keep in step |
| Guests in Drop's own admin page | that page is yours: all drops, People and Requests |
| The box revokes a guest's drops when you remove them | it couples the apps; **Revoke all** is one tap, and their drops end within 30 days |
| Each sign-in page restricted at Access, to a list of emails | the lists change inside the apps: two places by hand, or a Cloudflare key in an app that could open `/admin`; Drop's people can't be listed there at all. Your guests may be listed too, as an extra wall (section 2) |
| Any drop open to anyone with the link, by default (yours or a guest's) | your ask: private to its owner first |
| A Drop tool in a guest's run | a key in a guest's run |

## 11. Edge cases

- **Drop not set up, or it doesn't answer:** the page stays a file in their chat, and the reply
  says why.
- **"Who can open it?" or "what have I shared?" in the chat:** the reply points to My drops, where
  each drop shows it.
- **"Share it with Sam" in the chat:** the reply says how, in My drops (Share → People).
- **"Change it" in another chat:** they paste the page's link, or drag the page in from Files.
- **You change a guest's drop in your admin page:** they see it in My drops.
- **You remove a guest:** their runs make no call. In Drop, they can still manage their drops until
  each expires (30 days at most); **Revoke all for Ana** ends them at once.
- **You add a guest again:** with the same email, they get the same id and their drops back (those
  not expired). With a new email, they are a new guest, and their old drops stay `by` the old one.
- **Someone a guest shared with signs in to My drops:** they see nothing there; they open the
  drop by its link.
- **You ask "make a drop link of the report" and say nothing about who:** the drop is Only me.
  The reply says so, and how to share it: on its drop page in Drop, or say "anyone with the link"
  or a name.
- **The 50 seats are full:** a new person can't sign in; Access says so. Remove a user on Zero
  Trust's Users page, or wait for removing inactive users. A link needs no seat.

## 12. The build, after `go`

Two parts, in order (a `split`):

1. **drop:** section 4. Done when a drop made through the API with `by` shows "for Ana" in the admin
   page; a new drop with no gate is Only me; Ana, signed in at `/mine`, sees only her drops, on
   the same drop list and drop page as yours, and shares one with a link, with an email, and back
   to only her; a change on a drop not `by` her, or from another site, is refused; and **Revoke all
   for Ana** works.
2. **shipify:** section 5, after Drop's merges. Done when a guest asks for a page in a chat and gets
   a link that only they can open, with "Manage it in Drop"; "change it" keeps the same link; a
   call on a drop not `by` them is refused; and your own `publish` with no `share` is Only me.

**Your part, any time:** Google sign-in (section 2). Until you switch, the email code works.

## 13. Complications, and the answer to each

| Complication | The answer |
|---|---|
| A guest's words approve nothing (ADR 0071) | two fixed forms, approved once by your merge, made at once |
| A guest's run must hold no key or tool | the box makes the calls |
| Two apps with separate sign-ins | one Access team and one email; Google for both |
| A person with no Google account | a free Google account for the email they have, or a link |
| Which drops are theirs | Drop's `by`: one field, kept with the drop |
| Private needs the guest's email on the drop | the box asks the door; the email stays in R2 and Drop |
| Their files aren't on `shipify-files` | from the run's folder or from R2, by ref |
| A removed guest still in Drop | 30 days at most, or **Revoke all** |
| Access seats | each person who signs in takes one of Access's 50 free seats, strangers who try too (section 2: remove inactive users; a link takes none) |
| Drop's space | guests' drops count in your Drop and its R2 space |

## 14. Not checked

- Drop's repo can't be read with this run's key. Its facts come from ADR 0072, `plans/drop.plan.md`
  and the Drop tool. The build checks first: Drop takes an email it doesn't know on a drop's
  people; a change from people to `view` makes a link, and one back stops it; where Drop writes
  `drop.json`; and that its drop list, drop page and Share panel can be reused with only some
  options.
- That Drop's copy of `access.ts` reads the email for any login method.
- That Shipify and Drop are in the same Access team (one sign-in for both).
- That Drop sends no email (its plan leaves notifications out).
- That a Google consent screen asking only for name and email needs no review by Google.
- That a Google account made for a non-Gmail email signs in through Access with that email.
- That `/door/file/<ref>` gives a run's reply file by its ref, as it gives a file sent in a chat.
- That Drop's **New drop** starts as Only me today (its form has no Share choice).
- Whether a person Access refuses (not on a policy's list) takes a seat: Cloudflare's docs don't
  say.

## 15. Consequences

- **Easier:** a guest gets a Claude-like flow: ask, get a private page, and share it on its drop
  page in My drops, the same page you use, signed in with Google. They see all their drops in one
  place. You approve nothing, you see whose each drop is, and one tap revokes a guest's drops.
- **Harder:** Drop gains a second kind of user (a guest, for their own drops), with its own routes
  and tests. Two PRs, Drop's first. You set up Google sign-in once.

**Confirmation:** the tests of sections 4 and 5; and by hand, a guest's page that only they open,
shared from My drops with a link, then back to only them, and "for Ana" in your admin page.

## Later, only if you ask

- Guests answer requests to open their drops in My drops.
- A change to your own page in a chat with no Yes.

## As built (2026-11-06, Shipify's part on task #690)

Built as section 5 says, on Drop 0.6.0 (task #689: `by` on `POST /api/drops`, a guest's link
`/d/<address>` that opens to them signed in, My drops at `/mine/d/<address>`), with these facts
found in the code:

- **The guest forms are `pre`'s shape, one schema for both** (`Form`, `cli/lib/plugins/tool.ts`):
  `call`, `fixed`, `caps`, `any`, `max`, with no `after` and no fixed target. Drop's: `publish` with
  `share` fixed to `me` (so a guest's run writes `share: "me"`; one that leaves it out fits no
  form), `title` capped at 120, `files` and `expiry`; `update` with `drop`, `title`, `files` and
  `delete_files`. `max` counts each call, as `pre`'s does: 5 `publish` and 5 `update` a run at most.
- **Decide** (`guestsOnly`, `guestForm`): a guest's calls that fit a form stay in their answer, and
  are made at once, after the web too; each other call is named in the reply's "Left out". The
  files check is the one your calls have: each file is one this answer shares, or one sent on
  the task by its ref.
- **A guest's prompt** lists each connected tool's guest forms, one line each, made from
  `tools.json` (`guestCalls`, `cli/kernel/agent.ts`); with Drop not connected it has no `calls`
  line, and the page stays a file.
- **Apply** asks the door for the guest (`doorGuest`, `cli/kernel/door.ts`) right before their
  calls, and makes none when the door doesn't know them. `makeCalls` takes the run's out folder's
  files by name (`local`), as a guest's are never on `shipify-files`, and starts the server with
  `SHIPIFY_GUEST`. A file a guest's call took stays in their reply and chat: it has no other copy.
- **The door's route** `GET /door/guest/<id>` takes task.yml's OIDC token alone (`guestOut`,
  `edge/src/guests.ts`), reads the list as Setup → Guests keeps it (10 s cache), and answers 404
  for an id not on it.
- **The Drop tool:** `publish` with no `share` sends `gate: "me"`, and its answer says how to share
  it. In guest mode, `publish` refuses any other `share`, `people` or `pin`, takes `1d`, `7d` or
  `30d` (`30d` when none), and sends `by`; `update` refuses any argument but the four, reads the
  drop first and refuses one whose `by` isn't the guest (no `by` too), and sends no `limits` back
  for a drop with `by`; `list` and `revoke` refuse. Its answers end with "Manage it in Drop" at
  `/mine/d/<address>`, and name the guest's link `/d/<address>`, never their email. Your `list`
  shows "only Ana" on a guest's drop that is still Only me, and "for Ana" once she shared it.
- **The setup page** names Google sign-in for the guests' application; Setup → Guests is
  unchanged.
