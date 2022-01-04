# GET YOUR DIGITAL FUSE ON WITH 7JAM

https://7jam.io/

Online interactive jam session simulation. Check out our monthly jam sessions on the 7th of each month at 7pm CEST.

Feel free to join our [Discord](https://discord.gg/kkf9gQfKAd) to get the latest news, discussion, ask questions, meet musicians, learn about events.

## Features

- Multiple music rooms, each with different instrument sets
- Many sample-based instruments are available, each with multiple variations
- Two different synthesizer engines available
  - 4-oscilltors, each with pulse width modulation capability
  - Monophonic or polyphonic mode, with portamento
  - oscillator linking and copying for quick editing
  - FM algorithms
  - 2 modulation LFOs and an ADSR envelope
  - Automatable filters
  - MIDI CC mapping with MIDI Learn
  - Modulation of many parameters
  - Macro parameters which can be mapped to multiple parameters
  - Pitch bend
  - Vast preset library, and you can create your own presets!
- Configurable master effects chain
- Chat log and basic (but anonymous!) social features
- Room metronome so everyone is playing to the same tempo
- Quantization options
- Free and open to explore and play with


## FAQ

### The site doesn't work, what's up?

- Firefox does not support midi. It will work as a spectator, but not as a performer.
- I test on Chrome, and a bit on Edge.

This is a labor of love and cobbled together, so please expect problems unless you're on Chrome.

### How do you start jamming?

You must be using a MIDI-compatible browser (Chrome or Edge on Windows / Mac), and have a midi device connected. Just click an instrument to start playing. If this doesn't work, please tell someone on our [Discord](https://discord.gg/kkf9gQfKAd).

### Where is the server located?

The server is hosted in Germany by Uberspace.

### How to deal with latency?

Latency causes funny things. It's actually not a deal-breaker if you learn how to cope with it. For example fast, rhythmic funk music will probably never be a great hit on Digifujam. But if you go for ambient synth styles, then I doubt latency will ever cause an issue.

- Tip #1: Try not to expect DAW-like latency. try and find creative ways to accept latency.
- Tip #2: Your system settings can hugely affect latency. For example in Windows, sound devices are often configured in surround configuration by default, which adds ~50ms latency (unbearable). Switch this to Stereo configuration to solve. Ask in our [Discord](https://discord.gg/kkf9gQfKAd) for the latest ideas.
- Tip #3: Use headphones. If you hear your fingers on the keyboard, it's harder to adjust your ears to the latent signal. Using headphones lets you focus more on the sound and less on the key noise.
- Tip #4: Use local monitoring in 7jam. By default, you hear yourself after a roundtrip to the server ("remote monitoring"). If you have a high ping this can be too much delay to be bearable.
- Tip #5: Play music that doesn't require tight rhythms. If everyone else is playing a tight funky groove, and you have too much latency to mix in, try playing a soft pad or other long-attack sfx.


# Browser Compatibility
This project aggressively uses latest tech in order to squeeze out features. I do all my development work an Chrome Windows, and smoke testing on Edge.

- Chrome Windows will work best simply because that's where I do development.
- Chrome Mac I expect full compatibility. I did not manage to get MIDI to work, but everything else looked fine.
- Edge Windows should work because I smoke-test there occasionally.
- Edge Mac I have never tested.
- Firefox does not support MIDI ([yet](https://twitter.com/gabrielesvelto/status/1474097074253803521)), so it only works for spectators.
- Safari does not support MIDI or ConstantSourceNode, so it's 100% incompatible.
- Opera has been reported to work
- Mobile iOS definitely doesn't work due to Safari incompatibility

Please report compatibility in our [Discord](https://discord.gg/kkf9gQfKAd).

# Dev stuff

## dev process

- npm run build // build & start local server (for dev) @ http://localhost:8081/
- npm run start // to start local server without build
- npm run watch // simultaneously call this to monitor & build changes live
- node --inspect index.js // for chrome inspector debugging the server
- node --inspect-brk index.js // for chrome inspector debugging the server, but start broken to give time to attach debugger for startup.

You will need a `config2.yaml`.

## Importing SFZ

    node sfzimport.js sfzpath="C:\Users\carl\Desktop\Gospel_Voice_Set_Triton\Gospel Voice Set.sfz"

## Config, odds & ends & quirks

- IDs must be conservative wrt characters, because they are used in jq selectors and such.
- `/stats.html` to see activity graphs
- `/admin.html` with admin key for admin view / console
- `/activityHookInspector.html`
- `/storage` to view storage (feed, server state...)
- Uberspace does automatic SSL so no config is required there.
- `config.yaml` is required, and a default is included in the repo. Place a `config2.yaml` file next to `config.yaml` to override anything. It's git-ignored, useful for storing private keys etc.

### User sources

Discord users should have some properties that normal 7jam users do not:

* avatars are not visible in rooms
* cannot interact with room objects (naturally)
* joins/parts/changes are not shown in chat log or in notifications
* statistics are not collected for these users, and are not included in certain population counts



