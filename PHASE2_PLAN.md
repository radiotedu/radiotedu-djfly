# Phase 2 implementation record

The updated Desktop brief authorizes the audio engine and public experience. The real MaleCNS artifact and preprocessing are preserved. Before changes, normal runtime was verified as `REAL_MALECNS` with SHA-256 `a04137cdf9bb8a3f50d2ff3bdc209205833b73cc4c0581ed39f90086e2eb206e`.

## Architecture decisions

- The existing repository has a standalone Node decision package, a loopback neural preview, a safety/controller interface, and an unrelated Express/Jukebox service. A dedicated DJ Fly service avoids coupling scheduling or audio to Spotify, WordPress, or ERP internals.
- Events, pools, settings and future operator commands have explicit domain/repository contracts. The current ERP is Laravel 13 with authenticated route/controller boundaries. Phase 3 can replace file repositories through an authenticated adapter; no ERP editor is implemented now.
- One server program coordinator prepares a shared event timeline and runs real decisions ahead of transitions. Clients join the current position, use compact telemetry, and never download the connectome.
- Two browser Web Audio decks share one AudioContext. Sources, gain, EQ, filters and echo automation use its clock. Rendering observes state and analyser output; it is not the audio clock.
- Offline FFmpeg `atempo` preparation renders approved tracks to the pool BPM while preserving pitch, limited to six percent correction. Playback remains at rate 1. This intentionally fixes a Phase 2 pool's tempo and avoids real-time time-stretch dependencies on phones. FFmpeg 8.1.2 is already installed on this host. Its binary is not bundled or committed.
- Locally authored synthesis provides clearly labeled, reproducible test audio. Commercial music is never bundled. A separate analysis/import command accepts authorized audio, produces reviewed metadata and normalized renders, and rejects unsafe or unreviewed beat/key information.
- Candidate and transition failures use explicitly labeled safety fallbacks, never fabricated neural output. Local deck failures do not grant a public client control over the shared event.

## Design read

A scheduled listening room for RadioTEDU's university audience, combining a music booth with a restrained classic spectrum display. ENERGY 3 / RHYTHM 2 / MOTION 2. Motion represents actual sound, scheduled transitions and neural state; reduced-motion and visualizer-off modes remain available.

- Use the site's Albert Sans, existing RadioTEDU wordmark, paper/ink neutrals and the brief's exact red `#E31E26`.
- A large visualizer and typographic DJ FLY title establish the listening focus; flat deck strips communicate the two real players and two thought decks without a dashboard of tiny cards.
- Dark surfaces support prolonged music listening and make the spectrum legible. Paper-colored navigation and credits connect the experiment with the main site.
- Red marks listening/active handoff; neutral values carry the rest. Borders separate controls; decorative glass, glow and artificial meters are unnecessary.
- Mobile places the visualization and now-playing first, then real decks, Fly state, and compact candidate rows. Controls have touch-sized targets and visible keyboard focus.

## Delivery evidence to collect

Preserve all existing tests; add domain, safety, scheduling, recovery, API and actual audio rendering tests. Run lint, typecheck, build and responsive browser validation. Exercise all seven transitions against real AudioContexts/OfflineAudioContexts, demonstrate analyser output and continued audio with failed rendering, and record honest limits for physical mobile interruptions and musical quality. Final results belong in `PHASE2_REPORT.md`.
