# GET YOUR DIGITAL FUSE ON WITH 7JAM

https://7jam.io/

Online jam space for digital fusion musicians. Users connect with their MIDI instruments and everyone can play music together remotely, simulating a physical jam session. Thanks https://www.openode.io/ for hosting.

Some notes:

- Nothing is stored on the server, period. Only 1 hour of chat log history is ever preserved; after that it vanishes into the void.
- Setting reverb to 0 disconnects it entirely, saving a bit of CPU
- Muting the audio also disconnects everything (TRUE BYPASS RITE?), again saving CPU
- Pitch bend does not work on sampled instruments.
- Sampled instruments also do not support loop points so they don't sustain very long.
- For synth instruments, click on a parameter value to be able to type it in. Hit "enter" to make sure it updates.
- ADSR parameters don't automate well; they don't take effect until the next note on.
- Sustain pedal supported.
- Synth patches can be exported & imported via the clipboard.
- If you are idle on your instrument for a while, it becomes available for others to take. Longer and it gets automatically released.

## FAQ

### The site doesn't work, what's up?

- Firefox does not support midi. Maybe it will work as a spectator, but not as a performer.
- I test on Chrome, and a bit on Edge.

Basically, this is a labor of love and cobbled together, so please expect problems unless you're on Chrome.

### How do you start jamming?

You must be using a MIDI-compatible browser (Chrome or Edge on Windows / Mac), and have a midi device connected and available. Hover over an instrument and click "play".

### Where is the server located?

The server is hosted in Amsterdam by openode.io.

### How to deal with latency?

Latency causes funny things. It's actually not a deal-breaker if you learn how to cope with it. For example fast, rhythmic funk music will probably never be a great hit on Digifujam. But if you go for ambient synth styles, then I doubt latency will ever cause an issue.

So, tip #1: Try not to expect millisecond latency, try and find creative ways to accept latency.

Tip #2 is to use Edge. Chrome I find adds a lot of latency for MIDI devices. But Edge feels significantly more responsive.



# tech stuff

## dev process

- npm run build // build & start local server (for dev)
- npm run start // to start local server without build (for openode deployment)
- npm run watch // simultaneously call this to monitor & build changes live

## deployment process

- if client & server are no longer compatible (for example a difference in room schema or in comm prototocol), then increment DFCommon.js  gDigifujamVersion = 1; to make clients have to reconnect.
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

## odds & ends & quirks

- /stats.html to see activity graphs
- /storage to view storage (feed, server state...)
- server environment variables:
  - DF_IS_OPENODE = 1 or 0
  - DF_ADMIN_PASSWORD
  - DF_GOOGLE_CLIENT_ID
  - DF_GOOGLE_CLIENT_SECRET
  - DF_MONGO_CONNECTIONSTRING

