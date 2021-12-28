# GET YOUR DIGITAL FUSE ON WITH 7JAM

https://7jam.io/

Online jam space for digital fusion musicians. Users connect with their MIDI instruments and everyone can play music together remotely, simulating a physical jam session.

Some notes:

- There are multiple rooms; move between them by clicking on the doors (marked as a big blue outlined rectangle).
  - Rooms have their own instrument closets, own preset banks.
- Synth instruments of the same kind share a preset bank. So if you save a preset in FM4a, it will also be available in FM4b.
- Nothing is stored on the server, period. Only 1 hour of chat log history is ever preserved; after that it vanishes into the void.
- Muting the audio disconnects everything (TRUE BYPASS), saving CPU if you're just idling
- Limitation of the sampled instruments:
  - Pitch bend not supported for sampled instruments
  - Sampled instruments also do not support loop points so they don't sustain very long.
- For synth instruments, click on a parameter value to be able to type it in. Hit "enter" to make sure it updates.
- ADSR parameters don't automate well; they don't take effect until the next note on, and have quirks largely due to the odd nature of Web Audio modulation.
- If you are idle on your instrument for a while, it becomes available for others to take. Longer and it gets automatically released.

## FAQ

### The site doesn't work, what's up?

- Firefox does not support midi. Maybe it will work as a spectator, but not as a performer.
- I test on Chrome, and a bit on Edge.

Basically, this is a labor of love and cobbled together, so please expect problems unless you're on Chrome.

### How do you start jamming?

You must be using a MIDI-compatible browser (Chrome or Edge on Windows / Mac), and have a midi device connected and available. Hover over an instrument and click "play".

### Where is the server located?

The server is hosted in Germany by Uberspace.

### How to deal with latency?

Latency causes funny things. It's actually not a deal-breaker if you learn how to cope with it. For example fast, rhythmic funk music will probably never be a great hit on Digifujam. But if you go for ambient synth styles, then I doubt latency will ever cause an issue.

So, tip #1: Try not to expect millisecond latency, try and find creative ways to accept latency.

Tip #2 is to use Edge. Chrome I find adds a lot of latency for MIDI devices. But Edge feels significantly more responsive.


# Browser Compatibility
This project aggressively uses latest tech in order to squeeze out features. I do all my development work an Chrome Windows, and smoke testing on Edge.

- Chrome Windows will work best simply because that's where I do development.
- Chrome Mac I expect full compatibility. I did not manage to get MIDI to work, but everything else looked fine.
- Edge Windows should work because I smoke-test there occasionally.
- Edge Mac I have never tested.
- Firefox does not support MIDI (yet), so it only works for spectators.
- Safari does not support MIDI or ConstantSourceNode, so it's 100% incompatible.

Feel free to report compatibility issues anyway.

# tech stuff

## dev process

- npm run build // build & start local server (for dev) @ http://localhost:8081/
- npm run start // to start local server without build
- npm run watch // simultaneously call this to monitor & build changes live
- node --inspect index.js // for chrome inspector debugging the server
- node --inspect-brk index.js // for chrome inspector debugging the server, but start broken to give time to attach debugger for startup.

## deployment process

- openode deploy
- openode logs
  - check that latest server state backup was loaded
  - check mongo connection
  - check google config
  - no exceptions
- smoke test
  - play synth, samples, drums
  - load a preset
  - cheer
  - message
  - rooms
  - check for exceptions

## Importing SFZ

    node sfzimport.js sfzpath="C:\Users\carl\Desktop\Gospel_Voice_Set_Triton\Gospel Voice Set.sfz"

## Config, odds & ends & quirks

- IDs must be conservative wrt characters, because they are used in jq selectors and such.
- /stats.html to see activity graphs
- /storage to view storage (feed, server state...)
- Uberspace does automatic SSL so no config is required.
- `config.yaml` is required, and a default is included in the repo. Place a `config2.yaml` file next to `config.yaml` to override anything. It's git-ignored, useful for storing private keys etc.



## Dev stuff

- if client & server are no longer compatible (for example a difference in room schema or in comm prototocol), then increment DFCommon.js  gDigifujamVersion = 1; to make clients have to reconnect.


### User sources

Discord users should have some properties that normal 7jam users do not:

* avatars are not visible in rooms
* cannot interact with room objects (naturally)
* joins/parts/changes are not shown in chat log or in notifications
* statistics are not collected for these users, and are not included in certain population counts



