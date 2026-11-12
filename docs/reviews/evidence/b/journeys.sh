#!/bin/sh
# Reviewer B: the three recorded journeys through the served production build.
#   sh journeys.sh <base url> <label> <folder with animation.zip, lesson-video.mp4, large-video.mp4>
# Writes walk-learner-<label>.log, walk-lessons-<label>.log, walk-admin-<label>.log next to this file.
B="$1"; L="$2"; U="$3"
cd "$(dirname "$0")"

# 1. Learner browsing: Home -> portal -> audience -> lesson list -> lesson, then the other portals and screens
node cdp-walk.mjs "$B" goto:/ "click:Child protection" "click:I am a child" "click:My body belongs" media \
  push:/portal/agriculture \
  push:/portal/agriculture/agriculture-feed-and-animal-health/agriculture-feed-and-animal-health-videos dump \
  push:/portal/primary push:/portal/primary/primary-class-4 push:/portal/primary/primary-class-4/primary-class-4-mathematics \
  push:/portal/jss push:/portal/climate push:/portal/climate/climate-floods-stay-safe/climate-floods-stay-safe-lessons \
  push:/save-progress "type:input[type=text]=Review Learner" "click:Learner" dump \
  push:/portal/child-protection/help push:/not/a/page heap \
  "eval:JSON.stringify(Object.keys(localStorage).map(function(k){return k+'='+localStorage.getItem(k).slice(0,300)}))" \
  width:800 goto:/ goto:/portal/agriculture width:1440 goto:/ goto:/portal/child-protection/cp-child/cp-child-staying-safe \
  > "walk-learner-$L.log" 2>&1

# 2. Every lesson type: nothing from /media/ before Play, then real taps
node cdp-walk.mjs "$B" \
  goto:/lesson/cp-child-staying-safe-1 media "tap:Play video" wait:2500 media "tap:Forward 10s" wait:1200 media "tap:Captions" "tap:Sound" "tap:Pause" \
  push:/lesson/cp-child-staying-safe-2 media "tap:Play" wait:2500 media \
  push:/lesson/cp-child-staying-safe-3 media "tap:1. Mr Koroma" wait:1500 media dump \
  push:/lesson/cp-child-staying-safe-4 "tap:Play video" wait:8000 media "tap:It is never the child" wait:800 dump \
  push:/lesson/cp-child-staying-safe-quiz "tap:A grown-up I trust" wait:600 dump \
  push:/lesson/cp-parent-keeping-children-safe-5 media "tap:Play the reading" wait:2000 media "tap:Bigger text" "tap:I have finished reading" wait:1000 dump \
  push:/lesson/climate-floods-stay-safe-lessons-1 "tap:Play animation" wait:4000 dump \
  push:/lesson/agriculture-chickens-and-quail-videos-2 "tap:Play video" wait:1500 media \
  push:/lesson/primary-class-4-mathematics-3 push:/lesson/nope push:/ wait:1000 media heap \
  > "walk-lessons-$L.log" 2>&1

# 3. Admin: guard -> sign in -> upload two videos (120 MB + 18 MB) -> animation package -> place -> publish
#    -> see it as a learner (package in the sandboxed frame) -> typed lesson draft -> sign out
node cdp-walk.mjs "$B" goto:/admin/library dump \
  "type:input[name=username]=admin" "type:input[name=password]=wrong" "click:Sign in" dump \
  "type:input[name=password]=sensebod" "click:Sign in" dump \
  "eval:JSON.stringify({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookieVisibleToScript: document.cookie })" \
  push:/admin push:/admin/add/upload heap "file:input[type=file]=$U/large-video.mp4,$U/lesson-video.mp4" heap \
  throttle:40000 "click:Next: choose where it goes" heap wait:8000 heap dump throttle:0 wait:6000 dump heap \
  push:/admin/add/animation "file:input[type=file]=$U/animation.zip" dump "click:Test it here" wait:1500 media \
  "click:Next: choose where it goes" "click:Climate" "clicksel:input[name=adm-group]" "clicksel:input[name=adm-series]" \
  "click:Next: check and publish" "click:Publish to learners" dump \
  "click:See it as a learner" dump "click:animation" dump "tap:Start" wait:2500 media dump \
  push:/admin/add/type "type:input[type=text]=Draft title typed by admin A" "type:textarea=Words of an unpublished lesson." wait:1200 \
  "eval:JSON.stringify(Object.keys(localStorage).map(function(k){return k+'='+localStorage.getItem(k).slice(0,160)}))" \
  push:/admin/library dump push:/admin/series push:/admin/lessons/draft-safe-touch-story/place \
  push:/admin/lessons/cp-child-staying-safe-4/questions push:/admin/lessons/cp-child-staying-safe-3/try-it \
  push:/admin/menu dump "click:Sign out" wait:800 dump \
  "eval:JSON.stringify(Object.keys(localStorage).map(function(k){return k+'='+localStorage.getItem(k).slice(0,160)}))" \
  push:/admin/library wait:800 dump \
  > "walk-admin-$L.log" 2>&1
grep -H -E "^TOTAL|EXCEPTION|CSP VIOLATION|NOT FOUND" "walk-learner-$L.log" "walk-lessons-$L.log" "walk-admin-$L.log"
