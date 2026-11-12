# Cross-team requests

Append-only. Add a new entry at the bottom; never edit or delete another engineer's entry. Stream 1 answers by adding a `Status:` line under the entry.

Format:

```
## <date> — stream <n> → stream <m>: <short title>
What: <what is missing or wrong>
Why: <why you need it>
Where: <file or contract section>
Workaround: <what you did meanwhile, and where>
```

## 2026-11-12 — stream 2 → stream 1: shared header and Listen row are wider than a 320px screen
What: at 320px wide the one-row header (Back, Home, logo: `.sb-shell__header--single`) is 39px wider than the screen, and `ListenBar` (Listen + language switch) does not fit inside a card (it overflowed by 10 to 28px on our screens). Measured in headless Chrome on the production build; the "not found" screen shows the header overflow with only shared components on it.
Why: the coordinator asked for layouts that work at 320px; both cause a sideways scroll on every inner screen outside Child protection.
Where: `app/src/shared/shell/shell.css` (`.sb-shell__bar--nav`, `.sb-listen-bar`).
Workaround: `app/src/features/learner/learner.css`, `@media (max-width: 359px)`, marked `TODO(stream-1)`: the Listen row wraps (class `lrn-listen` on our `ListenBar`s) and the header logo is hidden below 360px. The header rule targets a shared class, so it also applies to other features' screens once the learner styles are loaded. Remove both when shared code handles 320px.
Status: done (stream 1, fix round 1, 12 Nov 2026; also review finding A-06). `shell.css` now handles narrow phones itself: below 376px the header row is tightened, below 360px the logo in the one-row header is hidden and the language switch drops under the Listen button (which may also shrink and wrap its words in a narrow card). Both workarounds in `learner.css` were removed by stream 1 with the coordinator's permission; the class `lrn-listen` is still on your `ListenBar`s and now does nothing. Measured in headless Chrome on the production build: no sideways scroll at 320, 360 or 390px on 16 pages (Home, Save my progress, every portal, class, topic and lesson-list kind, Get help now, lessons, not found, admin). Not checked on a real phone.

## 2026-11-12 — stream 2 → stream 1: quiz lesson on SeriesSummary (and quizzes per portal)
What: `SeriesSummary` has `hasQuiz` but not which lesson the quiz is; `Group` has neither. A quiz entry card (V3-JSS "Practice quiz", AGB-Agriculture "Quick quiz: keeping quail", CLB-Climate "Quick quiz: floods") cannot be linked without loading the whole series.
Why: the boards show a quiz entry on the portal or class page.
Where: `app/src/shared/api/types.ts` (`SeriesSummary`, `Group`), API-CONTRACT section 3. Suggested: `quiz: LessonSummary | null` on `SeriesSummary`, and on `Group` when it has one series.
Workaround: `views/PortalViews.tsx` `PracticeQuizzes` loads `GET /series/{id}` for each subject of the open class that has a quiz (one request in the seed). The Agriculture and Climate portal pages do not show the quiz entry card at all (it would cost one request per topic); the quiz is the last card of the topic's lesson list.
Status: done in the contract and the mock (fix round 1). `SeriesSummary.quiz: LessonSummary | null` and `Group.quiz: LessonSummary | null` (set when the group holds exactly one series) are sent by `GET /portals/{id}`, `GET /groups/{id}` and `GET /series/{id}`; API-CONTRACT section 3. They are optional in `types.ts` for now so in-flight branches compile; treat `undefined` like `null`. Your `PracticeQuizzes` workaround was left as it is (only its hook dependency list was touched, for the new lint rule): replacing it with `series.quiz`, and adding the Agriculture and Climate quiz cards from `group.quiz`, is yours to do.

## 2026-11-12 — stream 2 → stream 1: `seriesCount` on SeriesDetail.group
What: a lesson list needs to know whether its group has other series, to send Back to the list of series or straight to the portal. `SeriesDetail.group` only has `id`, `title`, `kind`.
Why: Back must be correct after a deep link from a lesson (stream 3 links back with `paths.series`).
Where: `app/src/shared/api/types.ts` (`SeriesDetail.group`), mock `GET /series/{id}`.
Workaround: `screens/Browse.tsx` `SeriesRoute` also requests `GET /groups/{groupId}` (cached 60 s; if it fails, Back assumes only classes hold several series). One extra small request per lesson list.
Status: done in the contract and the mock (fix round 1). `SeriesDetail.group.seriesCount` is sent by `GET /series/{id}` (optional in the type for now). Your extra `GET /groups/{groupId}` in `SeriesRoute` was left in place; it can go.

## 2026-11-12 — stream 2 → stream 1: icon key for groups and series; pictures for Primary and JSS
What: (a) the contract has no icon for a group or series, although the boards give each subject and Climate topic its own badge icon; (b) Primary and JSS subjects, and their lessons, have `picture: null`, while V3-Primary and V3-JSS draw a flat picture on each subject card, on "Continue where you stopped" and on the practice quiz; the V3-SignIn picture ("two people wave hello") is also not available as a file.
Why: fidelity to V3-Primary, V3-JSS, CLB-Climate, V3-SignIn.
Where: `types.ts` (`Group`, `SeriesSummary`), `app/mock/data/seed.ts`, `app/public/pictures/`.
Workaround: `features/learner/icons.tsx` `TopicIcon` picks the icon from English words in the title and falls back to the portal icon (so a renamed or translated title gets the fallback). Cards without a picture show the tint only.
Status: partly done (fix round 1). (a) Done: `Group.icon` and `SeriesSummary.icon` carry a key (`ContentIconKey`: `language`, `maths`, `science`, `social-studies`, `crops`, `seasons`, `floods`, `clean-water`, `heat`, or `null`; unknown or missing means the portal's icon); the seed sets them for the Primary and JSS subjects and the Climate topics; API-CONTRACT section 2. Your `TopicIcon` still reads the title; switching it to the key is yours to do. (b) Not done, needs the designer: pictures for Primary and JSS subjects and lessons, and the V3-SignIn picture, do not exist as files in `illustrations/` or `app/public/pictures/`, and stream 1 does not invent artwork. `picture` stays `null` for them (tint only) until the drawings are delivered; nothing in code needs to change when they are.

## 2026-11-12 — stream 2 → stream 1: PortalCard action label, TopicCard facts
What: (a) `PortalCard` always says "Open"; CPB-Who needs "This is me" and a one-row layout on tablets (CPB-Who-Tab). (b) `TopicCard` cannot show the "Needs sound" facts row that AGB-Agriculture has on every topic card, and puts the state chip beside the badge where AGB-Agriculture puts the tag line there.
Why: fidelity to CPB-Who, CPB-Who-Tab, AGB-Agriculture.
Where: `app/src/shared/components/Cards.tsx`.
Workaround: (a) a local `AudienceCard` in `views/PortalViews.tsx`, composed from the shared `Card`, `ScenePicture`, `Badge` and the shared `sb-open-pill` / `sb-portal-card__*` classes. (b) none: topic cards use the shared `TopicCard` as it is (recorded as a deviation).
Status: partly done (fix round 1). Done: `PortalCard` takes `actionLabel` (default "Open"), so CPB-Who can say "This is me"; `TopicCard` takes `facts` (a row under the detail line, for "Needs sound"). Not done: the one-row tablet layout of CPB-Who-Tab, and moving the tag line beside the badge with the state chip elsewhere on `TopicCard`. Both change the layout of a shared card that other boards draw differently, so they need a variant designed against the boards rather than a quick prop; your local `AudienceCard` stays the right answer for CPB-Who-Tab until then.

## 2026-11-12 — stream 2 → stream 1: key for Child protection audiences; quiz entries in progress
What: (a) the fixed text after the lesson list differs per audience (CPB-Child "Talk to someone you trust", CPB-Parent "Worried about a child?", CPB-Elder "What to do if a child tells you"), but the contract does not fix the audience ids; (b) `LessonProgress` does not say whether an entry is the Check quiz, while `lessonCount` leaves the quiz out, so a topic card built from `GET /learners/{id}/progress?portalId=` can count a finished quiz as a finished lesson.
Why: (a) correct audience content; (b) correct "N of M done" on topic and subject cards.
Where: API-CONTRACT sections 2 and 4, `types.ts`.
Workaround: (a) `views/ChildProtectionExtras.tsx` matches the seeded ids `cp-child`, `cp-parent`, `cp-elder`; any other audience gets the general "Need help now?" card. (b) `progress.ts` caps `done` at the lesson count; a learner who finished the quiz and all but one lesson is shown as finished on the card (the lesson list itself is exact).
Status: done in the contract and the mock (fix round 1). (a) `Group.audience` is `child`, `parent` or `elder` on the three Child protection audience groups and `null` elsewhere. (b) Every `LessonProgress` entry carries `lessonType`; `check` marks the quiz, so it can be left out of "N of M done". Both optional in the type for now; API-CONTRACT sections 2 and 4. Your id matching in `ChildProtectionExtras.tsx` and the cap in `progress.ts` were left in place; switching them to the new fields is yours to do.
