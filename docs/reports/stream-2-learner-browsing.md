# Stream 2 — Learner browsing: technical report

12 Nov 2026. Branch `worktree-agent-a04e819f8d2a99373`. Everything is in `app/src/features/learner/**`, plus this report and entries appended to `docs/team/REQUESTS.md`. No shared code, router, mock, contract or `package.json` was changed. No dependency was added.

Every number below was measured on the development Mac. **Nothing was run on a Raspberry Pi, on a physical Android device, or in the Chromium 58 floor browser.** Section 6 lists what that leaves open.

## 1. What was built

| Screen | URL | Board | File |
|---|---|---|---|
| Home (gateway to the 5 portals) | `/` | Main | `screens/Home.tsx` |
| Save my progress | `/save-progress` | V3-SignIn | `screens/SaveProgress.tsx` |
| Primary: choose class, then subjects | `/portal/primary`, `/portal/primary/:class` | V3-Primary | `views/PortalViews.tsx` (`ClassPortal`) |
| JSS: choose JSS 1–3, subjects, practice quiz entry | `/portal/jss`, `/portal/jss/:class` | V3-JSS | same |
| Agriculture: topics with counts, green theme | `/portal/agriculture` | AGB-Agriculture | `views/PortalViews.tsx` (`TopicPortal`) |
| Climate: topics | `/portal/climate` | CLB-Climate | same |
| Child protection: Who are you? | `/portal/child-protection` | CPB-Who, CPB-Who-Tab | `views/PortalViews.tsx` (`WhoAreYou`) |
| Child protection: Child, Parent, Elder lesson lists | `/portal/child-protection/:audience[/:series]` | CPB-Child, CPB-Child-Tab, CPB-Parent, CPB-Elder | `views/SeriesView.tsx`, `views/ChildProtectionExtras.tsx` |
| Child protection: Get help now | `/portal/child-protection/help` | CPB-Help | `screens/Help.tsx` |
| Lesson list of any other series (a subject, an Agriculture or Climate topic) | `/portal/:portal/:group/:series` | no board: the CPB-Child pattern | `views/SeriesView.tsx` |
| A group holding several series | `/portal/:portal/:group` | no board: the subject-card pattern | `screens/Browse.tsx` (`SeriesList`) |

Behaviour:

- **Lesson lists**: lessons in order, the Check always last, each card a link to `paths.lesson(id)` (stream 3's screen; nothing of the player is built here). Filter All · Watch · Listen · Read · Try it; the Check stays under every filter; a hidden live line announces what is shown.
- **Progress**: for a learner who saved a name, "You finished 1 of 4 lessons", one segment per lesson up to 8 lessons (one bar beyond that), the state chip on every card, "N of M done" on topic and subject cards, and "Continue where you stopped" on Primary, JSS, Agriculture and Climate. A guest has no saved progress: no progress panel, every chip "Not started", and a row offering "Add name".
- **Save my progress**: name (1–40 characters) + who you are; names used on this phone as a short list; skip as guest; remove a name after a confirmation (it deletes the learner and their progress from the bag). After saving, the learner returns to the screen they came from and sees "Your progress is saved in this bag, …".
- **Child protection**: every screen (including its loading, error and not-found states) has Leave this page, Back, Home and Listen. No learner name is shown or asked for on these screens. The audience choice is remembered for the "You chose" row and cleared by Leave this page. Pictures on these screens are only the Child protection scenes from the API and from `illustrations/child-protection/scenes` (drawn without trees by the designer; no other artwork is added).
- **Placeholders**: `[Emergency number — confirm]`, `[Child helpline number — confirm]`, `[Family Support Unit contact — confirm]`, `[Nearest police station — confirm]`, `[Local referral contact — confirm]` are shown exactly as on the boards, as text, never as `tel:` links. A test fails if a digit or a dial link appears in a contact box.
- **States**: loading, error with Try again, empty ("not in this bag") and success exist for every screen; a 404 from the API shows "This page is not in this bag" with a way Home.
- **Layouts**: phone (checked at 320 and 390), tablet (800), laptop (1440).

Local components (all composed from `@shared/components`): `Hero`, `LearnerStrip`, `GuestCard`, `ContinueCard`, `HelpCard`, `SectionHeading`, `ScreenState`, `NotInBag`, `AudienceCard`, `ClassPicker`, `ProgressPanel`, and 15 local icons redrawn from the boards' path data (`icons.tsx`).

## 2. Decisions and trade-offs

| Decision | Chosen | Rejected, and why | Cost |
|---|---|---|---|
| The three `/portal/…` routes | One component (`Browse`) on all three | One component per route: the router remounts on a route change, so tapping a class blanked the page, refetched and lost the scroll position | The three views share one chunk (6.3 KB gzip) |
| Class choice | It is the URL (`/portal/primary/primary-class-4`); tapping a class keeps the scroll position, then scrolls to and focuses "Class 4 subjects" | Local state only: lost on refresh and on Back from a subject | A module-level flag carries "scroll to the subjects" across the navigation |
| Lazy loading | Home is in the feature chunk (not lazy); Browse, Save my progress and Help are lazy | A lazy chunk per screen, as the folder README suggests: Home would need two round trips before first paint, and the screens share most code | Home's code (about 1 KB) is downloaded by a learner who deep-links elsewhere |
| Filter options | The types the series actually contains; hidden when there is only one | Always all five: three or four of the buttons would lead to a list holding only the quiz. The chosen rule reproduces both boards (CPB-Child shows four buttons, CPB-Parent five) | Buttons differ between series |
| Back from a lesson list | To the list of series when the group has several, else to the portal | Guessing from the group kind alone: wrong as soon as an admin starts a second series in a topic | One extra cached `GET /groups/{id}` per lesson list (request raised) |
| Progress for a guest | Not shown | "0 of 4" for someone who has in fact watched lessons | A guest sees no progress at all |
| Name gone from the bag (404) | The phone forgets the name and says so once | Keeping a name that can never save | — |
| Saving a name | One idempotency key per thing being saved, kept across "Try again", new when the name or role changes; the request is cancelled if the screen is left | The client's default (a new key per call) creates a second learner on retry | — |
| Return address after saving | `?from=` accepts only paths inside the app | Trusting the value: a crafted link could send a learner elsewhere | — |
| Icons per subject and topic | Chosen from English words in the title, portal icon as fallback | Matching seeded ids: breaks for content an admin adds | Breaks under translation (request raised) |
| Styling | One plain CSS file, `lrn-` prefix, loaded with the feature chunk | CSS Modules: no benefit at this size | — |

Coordinator's notes on foundation defects, as applied: (1) idempotency key kept per submission: applied. (2) `useQuery()` is never in a dependency list: only strings are. (3) `useApi` dependency lists and banned CSS were checked by hand (grep of `learner.css`: every `gap` is on a grid and follows `grid-gap`; no `inset`, `clamp()`, `aspect-ratio`, `:has()`, no weight 500, no animation or transition). (4) A stale answer is never treated as loaded: each route compares the loaded object's id with the URL; effects use ids from loaded objects. (5) `SeriesView`, `ClassPortal` and `TopicPortal` are keyed by their id, so the filter resets between series. (6) Loading and error states are inside `PageShell`. (7) 320px: see section 3 and the request. (8) No cached answer is sorted or edited; lists are filtered into new arrays.

## 3. Deviations from the design

1. **Subject, "Continue" and practice-quiz pictures (V3-Primary, V3-JSS) and the V3-SignIn picture are not shown**: the API has `picture: null` for them and the drawings exist only inside the boards. Cards show the tint.
2. **"Continue where you stopped" uses the lesson card of AGB-Agriculture on all four portals.** V3-Primary, V3-JSS and CLB-Climate draw an older card with a "Continue lesson" button; the shared card gives the tagged version (type, "Lesson 2 of 12", facts, the type's own button).
3. **Agriculture and Climate portal pages have no quiz entry card** (AGB-Agriculture "Quick quiz: keeping quail", CLB-Climate "Quick quiz: floods"): the contract cannot say which lesson it is without one request per topic. The quiz is the last card of the topic's lesson list.
4. **JSS practice quiz** is the shared lesson card: filled button "Start the quiz" (board: outlined "Start quiz"), under a heading "Check what you learned".
5. **Topic cards** use the shared `TopicCard`: state chip beside the badge and tag line under it (AGB-Agriculture has them the other way round), no "Needs sound" row, "Not in bag" (board: "Not in this bag"), no "Watch · Coming later" on Crops. The info strip reads "64 videos are in this bag." (board: "64 farm animal videos…").
6. **Climate topic cards** say "1 of 3 done" where the board says "On lesson 1 of 3".
7. **"You chose" row** uses the audience title as it comes from the API ("I am a parent or carer"; board: "Parent or carer").
8. **Tablet copy**: CPB-Child-Tab says "My lessons" and "1 finished · 1 started · 2 not started"; the phone wording is used at every width. The lesson-type sentence is built from the data ("Watch a video, listen or try it yourself."; CPB-Child: "…listen to a story or…").
9. **Hero card** on Primary, JSS, Agriculture and Climate uses the portal picture from the API; the Agriculture board's sentence "Animals, crops and selling your harvest." is the API's "Animals, crops and selling".
10. **Class tiles are links** with `aria-current`, not toggle buttons, so a class has an address.
11. **Guest states** are not on the boards: a "You are a guest · Add name" row on portal pages; on Home a learner sees the "Learning as … · Change" row in place of the guest card.
12. **Remove a name** asks for confirmation (the board shows only the entry button).
13. **Undesigned sizes and screens**, extended from the nearest pattern: all laptop layouts (3-column lists, 6 class tiles in a row, audience cards side by side); tablet layouts for Home, Save my progress (two columns), Primary, JSS, Agriculture, Climate, Parent, Elder and Help (two columns); lesson lists outside Child protection; the list of series in a multi-series group; long series (one progress bar above 8 lessons).
14. **Below 360px** the logo in the one-row header is hidden and the Listen row wraps (workaround for shared code, request raised).

## 4. Footprint (measured, `npm run build` then `npm run size`, gzip level 9)

| Chunk | Raw | gzip | Loaded when |
|---|---|---|---|
| `feature-learner` (routes, Home, shared local pieces, all learner CSS) | 16.8 KB | 4.9 KB | any learner URL |
| `Browse` (portal pages, lesson lists) | 20.5 KB | 6.3 KB | first `/portal/…` page |
| `SaveProgress` | 5.7 KB | 2.2 KB | Save my progress |
| `Help` | 5.6 KB | 2.0 KB | Get help now |
| `icons` (shared icons used only by lazy screens, split out by the bundler) | 6.0 KB | 2.2 KB | with the first lazy screen that needs one |
| `api` (shared learner calls, split out by the bundler) | 2.5 KB | 1.1 KB | with the learner feature |

- Largest lazy chunk: 6.3 KB of the 60 KB budget.
- Start JavaScript: **97.6 KB** gzip of 200 KB; critical resources for the first screen: **118.8 KB** of 350 KB. Stream 1's report gives 94.0 KB and 115.2 KB for the stub build; I did not re-measure that baseline. The growth is in the entry chunk and is shared components that the stubs did not use and the bundler now keeps there.
- Dependencies used: `react`, `react-dom`, and shared code. Added: none.
- Source: about 3,070 lines including tests and CSS.
- Requests to the bag by design: Home 1; a portal page 1 (guest) or 3 (learner: portal, progress, continue); a lesson list 2 (guest: series, group) or 3; a class page adds 1 for the class and 1 per subject that has a quiz. No polling, no retries.

## 5. Offline and compatibility

- **External requests: none.** Checked in headless Chrome on the production build: 218 requests at 390px and 220 at 800px across the journeys, all to the local origin. No external URL appears in the code; the build's own check ("no external URLs") passes.
- Pictures are loaded by URL through the shared `ScenePicture` / `Illustration` (lazy below the first one). Nothing is inlined.
- Browser features relied on beyond the shared code: `Map`, `Array.prototype.some/filter`, CSS grid with `grid-gap`, flexbox with margins and `order`, `scrollIntoView()` without options. `scroll-margin-top` (Chrome 69) is an enhancement only. `AbortController` is checked before use.
- Nothing animates. No `localStorage` use of my own: session data goes through `@shared/session`.
- Offline mode: Mode A only, as the architecture defines. No service worker.

## 6. Testing

| Check (in `app/`) | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass, no warnings |
| `npm test` | pass: 8 files, 96 tests (35 are this stream's: 28 screen and journey tests on the mock API, 7 unit tests) |
| `npm run build` | pass, including the post-build checks |
| `npm run size` | pass: all three budgets ok (section 4) |

Headless Chrome (the installed Google Chrome, driven over the DevTools protocol by a throwaway script kept outside the repository) against `vite preview` of the production build with the mock API:

- **Journeys at 390 and 800 wide: 37 checks each, all passed.** Home → Add name → save → back Home with confirmation; Agriculture → topic → lesson card opens `/lesson/…` → Back; Primary → class → subject → Back, without the page jumping to the top; JSS practice quiz; Climate; Child protection Who → child → filter keeps the quiz → Get help now → Back → Leave this page → browser Back does not return; deep link and refresh; a forced 503 → Try again recovers.
- Console: no errors or warnings apart from the browser's own line for the forced 503. Failed requests: none.
- **All 16 screen states at 320, 390, 800 and 1440: no sideways overflow** (measured `scrollWidth − clientWidth` = 0), after the 320px workaround.
- Looked at by eye against the boards (screenshots): Home, Save my progress, Primary class 4, Agriculture, Child lesson list and Get help now at 390; Who are you? and the Child lesson list at 800; JSS 2 at 1440; Elder at 320. The other combinations were checked for overflow only. No pixel comparison was made.

A defect the tests found and I fixed: class tiles were announced as "Class4" (two boxes with no space); they now carry a full name ("Class 4", "Class 4, your class").

**Not tested** (none of this may be assumed to pass):

- Raspberry Pi, nginx on a Pi, any physical Android phone or tablet, Android 8, old WebView.
- Chromium 58 (the floor browser stream 1 used in a container): not run by me. The CSS follows the floor rules by inspection only.
- Firefox, Safari, Edge.
- Screen readers (TalkBack) and switch access: roles, names and focus are unit-tested; no assistive technology was run.
- The virtual keyboard over the name field; touch behaviour; speed and memory with 27 lesson cards on a weak phone.
- Listen: no recording exists (`listenUrl` is `null` everywhere), so the buttons were only seen in their "No sound here yet" state.
- Several phones at once; Wi-Fi drop mid-save beyond the forced-error tests.

## 7. Cross-team notes

Requests appended to `docs/team/REQUESTS.md` (all to stream 1, each with its workaround):

1. Shared one-row header and `ListenBar` overflow at 320px. Workaround in `learner.css`; the header rule reaches a shared class and so affects other features' screens once learner styles are loaded.
2. Quiz lesson on `SeriesSummary` / `Group` (quiz entry cards).
3. `seriesCount` on `SeriesDetail.group` (correct Back with one request fewer).
4. Icon key for groups and series; pictures for Primary and JSS; the V3-SignIn picture.
5. `PortalCard` action label ("This is me"); `TopicCard` facts row and layout.
6. A stable key for Child protection audiences; marking quiz entries in progress.

For stream 3: lesson cards link with `paths.lesson(lesson.id)`; "Continue where you stopped" and the practice quiz link the same way. Back from a lesson to `paths.series(portal, group, series)` lands on the lesson list, which re-reads progress on every visit, so a state saved by the player shows at once. A series whose URL does not match its real portal and group is shown as not found.

For stream 1: `TODO(stream-1)` marks every workaround (7 places). The existing app test for `/portal/nowhere` still passes: the portal route answers a 404 with the same words as the app's "not found" screen.

## 8. Open items and risks

1. Real hardware and the floor browser (section 6) are the main risk.
2. Placeholders that must be filled by the content owner before any use with children: the five bracketed contacts above. Lesson titles containing `[confirm …]` and `[Sample]` come from the mock data.
3. Topic and subject cards can show "Finished" one lesson early when the quiz is finished (contract gap, request 6). The lesson list is exact.
4. A class is not remembered between visits: the learner taps it each time. The session store has no field for it.
5. Audience-specific Child protection sections depend on the seeded ids `cp-child`, `cp-parent`, `cp-elder`.
6. Krio: the language switch stores the choice; no text changes (no translations exist). Title-based icons will fall back to the portal icon under translation.
7. A very long series (Feed and animal health, 27 videos) renders 28 cards at once; pictures are lazy, but scrolling speed on an old phone is unmeasured. Paging would be the next step if it is slow.
8. Not designed and therefore only extended minimally: see deviation 13. A designer should look at the laptop layouts, the guest row and the remove-a-name confirmation.
