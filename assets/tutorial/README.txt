How-to videos go here as <slug>.mp4: intro, editing, no-account, calendar, store, domain, notifications, team.
Register each in src/lib/learnVideos.ts (Metro needs a static require).
Made with scripts/make_tutorial_video.py from simulator recordings (.maestro/rec.sh + .maestro/flows/tut_*.yaml).
Polish pass 2026-10-25: re-cut from the kept raw recordings (/tmp/tut/raw) with specs in scripts/tutorial-specs/*.json
(app scaled to 92% with a caption band underneath, pointers aimed at the named element with a tap ripple, home-screen app name patched to "Prime Barber").
