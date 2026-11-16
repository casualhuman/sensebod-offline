# Sensebod — design decisions and why they were made

Version 1 · 12 Nov 2026 · written by the design lead (the agent that ran the design rounds with the owner)

This document records the product and interface decisions behind the boards in `design/boards/`, why each one was taken, what was rejected, and what each decision **requires from the system** (backend, Pi, network). It is written for the system architect and the architecture verifier, so the architecture can be traced back to the product it serves. Where a choice came from the owner, it says so; the owner's word wins over anything here.

The design rounds are recorded in `briefs/ROUND2-BRIEF.md` … `briefs/ROUND13-BRIEF.md` (newest wins). The product summary and board map are in `HANDOFF.md`. The frontend's proposed API is in `docs/API-CONTRACT.md`; the frontend architecture is in `docs/ARCHITECTURE.md`.

---

## 1. Who it is for and where it runs

| Fact | Source | Consequence for the design | What it asks of the system |
|---|---|---|---|
| Learners in rural Sierra Leone: children, parents and carers, community elders, farmers, school pupils (Primary Class 1–6, JSS 1–3). Many have low literacy; some speak Krio more than English. | Owner brief | Icons with words on every control, one decision per screen, a gold **Listen** button that plays recorded narration, plain short sentences. | Audio files for narration (`listenUrl`) served from the bag. No speech synthesis (unreliable on old Android, and voices sound foreign). Room for Krio text and audio later. |
| Devices: old, cheap Android phones (Android 8 era, small screens down to 320 px), some tablets, a facilitator's phone, occasionally a laptop. | Owner brief, DLH kit notes | Big targets (≥48 px, primary buttons 64–72 px), body text 18 px, no hover-only actions, light pages, no heavy effects. | Small JSON answers, paged lists, video in a codec and bitrate old phones can decode, a "smaller copy for old phones". |
| The bag: Raspberry Pi 5 (hostname `easystem.local`, Debian 13), its own hotspot "Offline Library", an external access point, site `materials.sensebod.com`, phones connect over **plain HTTP**. No internet. | DLH kit, IIAB review | Nothing in the UI may depend on the internet: no web fonts from Google, no CDN, no maps, no sign-in with Google. | Everything — app, API, media, fonts, pictures — served from the Pi. HTTP only, so no service worker on most phones (not a secure context). |
| Power is unreliable; the bag may be switched off at any time, including mid-upload. | Owner, field reality | Status line "Saved on this bag · No internet needed"; "Keep this page open" on big uploads; nothing is presented as saved until the server confirms it. | Writes must survive sudden power loss; uploads must be resumable or safely retried; the database must come back consistent. |

## 2. Decisions about the learner side

### 2.1 Use without signing up; "Save my progress" is optional
- **Decision.** Anyone can open every lesson as a guest. "Save my progress" asks only for a first name and who you are (learner / teacher / other). No password, no phone number, no email.
- **Why.** The owner asked for a login that "shouldn't be long" and for use without signing up. Shared phones, children, low literacy and no SMS/internet make passwords and phone verification unworkable; a forgotten password with no reset path would lock people out for good.
- **Rejected.** Phone-number sign-up (needs SMS, collects personal data from children). PIN codes (forgotten, shared, and still not secure on a shared phone).
- **Changed by the owner, 2026-11-16: learners choose a 4-digit secret number.** Reason given: with a name only, two learners called "Abdul" (or "Abdul Koroma") cannot be told apart, and a learner cannot get back to their progress from another phone. So: name + 4-digit number identify one learner; "Sign in" asks for both; "Sign out" returns the phone to guest. Lessons stay open to guests. A full password was not chosen: young children and low-literacy users manage four numbers better, and there is still no SMS or internet to reset anything. **Open:** a learner who forgets the number has no way back yet (no staff reset screen); they must start a new name. The number is weak protection by design (10,000 possibilities, 5 wrong tries then a 5-minute pause): it tells learners apart, it does not guard secrets.
- **Trade-off accepted.** Anyone on the bag's Wi-Fi who knows a learner's id could read or delete that learner's progress. Mitigation asked of the system: unguessable ids; the phone remembers which names were used on it (at most 8, in `localStorage`), and the server deliberately has **no "list all learners" endpoint** for learners.
- **Asks of the system.** Learner records (name, role) and progress records stored on the Pi. These are personal data about children — see section 5.

### 2.2 Portals, then audience / class / topic, then series, then lessons
- **Decision.** Home shows five portals: Primary school, Junior secondary (JSS), Child protection, Agriculture, Climate. Then a group (a class, an audience or a topic), then a series, then numbered lessons ending with a Check quiz.
- **Why.** Each portal serves a different community programme; a fixed shallow tree is easier to learn than search for people who do not read well.
- **Asks of the system.** A simple content tree (`Portal ─< Group ─< Series ─< Lesson`), mostly read, rarely written; a group or series may be listed but marked "Not in this bag yet" (e.g. Agriculture → Crops).

### 2.3 Child protection asks "Who are you?" first, and always offers a quick exit
- **Decision.** Child protection starts with "I am a child / a parent or carer / a community elder" and shows different series. Every Child protection screen has **"Leave this page"** which jumps to a neutral screen. No trees in Child protection scenes (owner's request). Help screens show "[confirm local services]" placeholders.
- **Why.** The content and tone differ by audience; a child reading about abuse may be near the abuser, so leaving must be one tap.
- **Asks of the system.** Child protection progress is **sensitive**: knowing a named child opened "It is not my fault" can put the child at risk. The architecture must decide whether Child protection progress is recorded at all, who can see it, and whether it is ever exported. (Design recommendation: record it only as counts, or not tie it to a name in exports — the owner must confirm.)

### 2.4 Lesson types are tagged by what the learner does
- **Decision.** Watch (video), Listen (audio, with "Read along"), Read (typed text, PDF, Word, photos of notes; open-book icon), Try it (interactive animation), Check (quiz at the end of a series). Modifier "You take part" for anything that asks the learner to act; an interactive video is a Watch lesson whose button reads "Watch and answer". The type is set **automatically from the uploaded file** and can be changed by the admin. Filter on every lesson list: All · Watch · Listen · Read · Try it.
- **Why.** People with low literacy choose by action ("I want to watch"), not by format names like MP4 or PDF. Automatic typing removes a decision from the admin.
- **Asks of the system.** Server-side file inspection on upload (container, duration, pages); a fixed type rule; byte-range serving for media; animation packages (.zip with `index.html`) unpacked and served in a sandboxed iframe from the Pi; H5P only if an H5P player is installed on the bag.

### 2.5 Quizzes are for learning, not for marks
- **Decision.** No timer, no score shown as pass/fail, "Try again" allowed; feedback explains the right answer.
- **Why.** Fear of failing drives low-literacy learners away; the bag is not an exam system.
- **Asks of the system.** Correct answers can be sent to the phone (the quiz must keep working if the Wi-Fi drops mid-quiz). Quiz results are low-stakes: losing the last few seconds of results in a power cut is acceptable; corrupting the database is not.

### 2.6 Progress in words
- **Decision.** "2 of 5 done", "Continue where you stopped", state chips Not started / Started / Finished. A finished lesson never goes back to "Started".
- **Asks of the system.** A progress record per learner per lesson with a monotonic state; video position saved occasionally (not every second — every write costs an SD card).

### 2.7 Look: V3 "Scene + badge", light, two main colours
- **Decision.** Light page #F4F7FB (Agriculture #F3F8F4), white cards with visible edges (≥3:1), blue #085CAA primary, ink #15233B, slate #4A5568; green #1F7A3A only for Agriculture and success; gold #E4AA09 only on Listen; red #C41E2A only for errors, wrong answers and urgent help. Poppins. Bold "D-style" icons with labels. Style B cast — realistic cartoon people of Sierra Leone in village, school and clinic scenes.
- **Why.** The owner rejected many-coloured designs ("do not use more than two colors") and a heavy blue background ("the blue is not helping"). Red was brought back only where it carries meaning. A local, diverse cast makes people see themselves in the lessons.
- **Asks of the system.** Poppins must be **self-hosted** (it is under the SIL Open Font License; ~50 KB for five Latin weights). Illustrations are SVG files served from the Pi.

## 3. Decisions about the admin side

### 3.1 Admins are facilitators on their phones
- **Decision.** Phone-first admin (390 px boards `ADM-M-*`) with a jumbo menu (big tiles) and a bottom tab bar Home · Add · Library · Menu; a laptop version (`ADM-*`) is secondary.
- **Why.** Facilitators and teachers have phones, rarely laptops. Hidden hamburger menus are missed by new users.
- **Asks of the system.** Admin sign-in that works offline; a session that survives the phone sleeping during a long upload; protection against someone on the same Wi-Fi acting as admin.

### 3.2 Four ways to add content; no WhatsApp integration
- **Decision.** Upload files (videos, audio and voice notes, PDF/Word, photos already on the phone); Take photos of notes; Type it yourself (with optional "Record yourself reading it" → Read along); Upload an animation (.zip from EasySTEM, checked for "Opens without internet", "Starts with index.html", size). The owner decided there is **no WhatsApp integration** and it must not be mentioned.
- **Why.** Content usually reaches facilitators as files on their phone; the bag has no internet to talk to WhatsApp anyway.
- **Asks of the system.** Large uploads (a 34 MB video is normal; hundreds of MB possible) over weak Wi-Fi from a phone that may sleep, while the Pi may lose power. Uploads must stream to disk, show progress, survive retries without duplicates (`Idempotency-Key`), and leave no half-written file presented as complete. Background work after upload: voice note (.opus) conversion, smaller video copy, PDF/Word page rendering, animation package checks — on a Pi, without starving learners.

### 3.3 "Where does it go?", then a picture, then "Check and publish"
- **Decision.** One decision per screen: portal → audience/class/topic → series → position; then choose a picture from a small gallery (suggested first); then check and publish. Drafts that are not placed wait in "Waiting to be placed".
- **Why.** Facilitators are semi-technical; a single long form overwhelms on a phone.
- **Asks of the system.** Draft / published state; insert-at-position with renumbering; the quiz always last; two admins editing the same series must not corrupt the order (the contract uses a whole-list `PUT` with a 409 on mismatch).

### 3.4 Not designed yet
"Learners and progress", "Storage and backup", "Settings" tiles exist in the menu but have no boards. **The owner has now asked for a safe way for the admin to download learner data from the server, accounting for power loss** (section 4). The architecture should specify it; the screens will be designed from that specification.

## 4. New requirement from the owner: safe download of user data by the admin

Owner's words: *"it should also include way to download safely user data from the server by the admin accounting for powerloss also."*

What the design side needs from the architecture, so the screens can be drawn later:

1. **What is in the download.** Learners (name, role), progress per lesson, quiz results; possibly counts per portal for reporting to partners. The architect must say what is included by default, and whether Child protection activity is excluded, aggregated or included only with an explicit choice (section 2.3).
2. **Consistency.** The export must be a consistent snapshot even while learners keep using the bag (no half-updated rows, no copying a live database file).
3. **Power loss on the Pi during export.** After power returns there must be no corrupt or half-written export presented as complete; the admin sees a clear state ("The download was interrupted. Make it again.") and the live database is untouched.
4. **Power loss or Wi-Fi drop on the phone/laptop during download.** The admin can resume or restart the download; the downloaded file can be checked (size and checksum, or a self-checking format) so a truncated file is detected, not silently used.
5. **Where it goes.** Download to the admin's phone or laptop over the bag's Wi-Fi; possibly to a USB stick plugged into the Pi. The architect should say which is supported and why.
6. **Protection.** Only a signed-in admin can export; the file contains children's names, so consider encryption or a password, a record of who exported what and when, and what happens to old exports kept on the Pi (retention, cleanup, storage limits).
7. **Formats.** Something a partner can open (CSV in a .zip) and something the bag can restore from (a full backup); these may be different products ("Download learner data" vs "Back up the bag").
8. **Plain-language states for the UI.** Preparing · Ready to download (size, date) · Downloading · Downloaded and checked · Interrupted — make it again · Not enough space on the bag.

## 5. Constraints the design imposes that the architecture must respect

- **No internet, ever, for essential use.** Every learner and admin journey on the boards must work with the Pi's uplink unplugged.
- **Plain HTTP on old Android.** Do not depend on service workers, secure-context-only APIs or `Secure` cookies unless the architecture provides a realistic HTTPS story for these phones (see `docs/ARCHITECTURE.md` §10 "Mode A").
- **Sensitive data about children.** Names and Child protection activity. Minimise what is stored and exported.
- **Non-technical operators.** No command line in normal use. Backup, export, restore and update must be buttons with plain words, or a USB stick procedure that a facilitator can follow.
- **Unknowns stay unknown.** Lengths, sizes, storage totals and local service contacts are `[placeholders]` until measured or confirmed; do not invent figures.

## 6. Open product questions for the owner

1. Is Child protection progress recorded per named learner at all?
2. Who receives exported learner data (EasySTEM only, partners, schools), and what may they see?
3. How many admins per bag, and how is a forgotten admin password recovered without internet?
4. Is there ever a central server (cloud sync), or are bags updated and collected only by hand (USB / visiting technician)?
5. Krio: text, audio or both, and who records it?

## 7. Owner answers (13 Nov 2026)

1. **Child protection progress: option A.** Child protection lessons are never linked to a learner's name. The bag keeps only anonymous counts (e.g. "opened 37 times this month"). Accepted trade-off: no "Continue where you stopped" inside Child protection.
2. **Admin password.** Set by EasySTEM at deployment. Normal reset only when the bag is connected to the internet.
3. **Offline override.** When an admin is locked out offline, EasySTEM can send them an override code (like an authenticator code, but with a longer life) so they get back in without a technician visit. Owner's words: *"we should have an override password that we can send to them. same how an authenticator app works where you can share a code and then get someone in … but with longer ttl"*. Design lead's proposal for the architect: challenge-response, not clock-based (the Pi clock can be wrong) — the bag shows a request code; EasySTEM's tool derives a one-time override code from a per-bag secret set at deployment; valid ~72 h or until used; one bag, one use; attempt limits; logged; forces a new password.
4. **Data goes to EasySTEM.** The admin exports learner data and sends it to EasySTEM.
5. **Retention: two months.** Learner data is kept for two months. The admin or hub manager can also clean it. (Design lead's suggestion: before cleaning, show the date of the last export and warn if the data has not been exported yet.)
6. **Roles:** "admin" and "hub manager" are both mentioned; whether they differ is not yet confirmed.
7. **Unexported data at the end of the two months (O-16), 13 Nov 2026:** owner chose to hold it longer — **60 extra days** (about four months in all), then remove it even if never exported, with a hard stop so a hub that never exports does not keep data forever. During the hold, admins see an escalating reminder: "Learner data from [month] will be removed on [date]. Export it for EasySTEM now." (Supersedes the architect's 30-day recommendation; the architecture's retention figures need updating in the build.)
8. **Roles (O-15), 13 Nov 2026:** confirmed. Hub manager can do everything; admin adds content and exports but cannot clean data or manage accounts.
9. **Identity check before an override code is given (O-17), 13 Nov 2026:** owner chose **no formal identity procedure** — EasySTEM simply gives the override code to the person who asks. Accepted residual risk: someone who is at the bag (or on its Wi-Fi with the request code) and contacts EasySTEM pretending to be the admin can get in. Remaining safeguards, unchanged: the code only works for the request shown on that bag and that browser, once, within its validity; every admin sees the "override was used" banner until a hub manager acknowledges it; the override is logged on the bag; EasySTEM's tool keeps its own log of codes issued.
