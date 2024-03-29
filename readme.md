# GET YOUR DIGITAL FUSE ON WITH 7JAM

https://7jam.io/

Online interactive jam session simulation. Check out our monthly jam sessions on the 7th of each month at 7pm CEST.

Feel free to join our [Discord](https://discord.gg/kkf9gQfKAd) to get the latest news, discussion, ask questions, meet musicians, learn about events.

## Features

- Multiple music rooms, each with different instrument sets
- Save your work via "room presets" (similar to a "song" or DAW project), or save presets in sequencers and synthesizers.
- Over 55 sample-based instruments are available, each with multiple variations
- Step sequencer for synchronized playing with or without a MIDI device.
  - Arpeggiator modes
  - Can link to other instruments
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


# Hotkeys

- <kbd>\\</kbd> cheer
- <kbd>ALT</kbd>+<kbd>M</kbd> toggle mute
- <kbd>ALT</kbd>+<kbd>1</kbd> Select sequencer pattern A
- <kbd>ALT</kbd>+<kbd>2</kbd> Select sequencer pattern B
- <kbd>ALT</kbd>+<kbd>3</kbd> Select sequencer pattern C
- <kbd>ALT</kbd>+<kbd>4</kbd> Select sequencer pattern D
- <kbd>ALT</kbd>+<kbd>5</kbd> show / hide sequencer window
- <kbd>ALT</kbd>+<kbd>9</kbd> show moderation controls
- <kbd>ALT</kbd>+<kbd>0</kbd> show error log window


## FAQ

### The site doesn't work, what's up?

- Firefox does not support midi (yet). It will work as a spectator, but it won't detect your MIDI devices.
- I test on Chrome, and a bit on Edge.

This is a labor of love and cobbled together, so please expect some bugs. I would love to hear about them though! Feel free to submit a github issue.

### How do you start jamming?

Just click an instrument to start playing. The step sequencer can be used by anyone, but to use a MIDI keyboard you'll need to be on Chrome or Edge. If this doesn't work, please tell someone on our [Discord](https://discord.gg/kkf9gQfKAd) or submit a github issue.

### Random tips on using the sequencer

- Click a cell to cycle through loud, soft, off states.
- Ctrl-click a cell to delete
- Ctrl+Shift click a cell to toggle between soft, off states.
- To change the length of a note, shift-click a cell where you want the new length.
- Do any of the above operations **while playing** to affect the notes you're playing.


### Where is the server located?

The server is hosted in Germany by Uberspace.

### How to deal with latency?

Latency causes funny things. It's actually not a deal-breaker if you learn how to cope with it. Fast, rhythmic funk music will probably never be a great hit on 7jam. But if you go for ambient synth styles, then I doubt you'll even notice latency.

- Tip #1: Use the step sequencer or quantizer. They ensure you'll be in sync with the room.
- Tip #2: Try not to expect DAW-like latency. try and find creative ways to accept latency, just as in a real-world jam session we have to deal with whatever limitations or constraints (insert story about the time they promised there would be a bass guitar but it only had 2 strings).
- Tip #3: Your system settings can hugely affect latency. For example in Windows, sound devices are often configured in surround configuration by default, which adds ~50ms latency (unbearable). Switch this to Stereo configuration to solve. Ask in our [Discord](https://discord.gg/kkf9gQfKAd) for the latest ideas.
- Tip #4: Use headphones. If you hear your fingers on the keyboard, it's harder to adjust your ears to the latent signal. Using headphones lets you focus more on the sound and less on the key noise.
- Tip #5: Use local monitoring in 7jam. By default, you hear yourself after a roundtrip to the server ("remote monitoring"). If you have a high ping this can be too much delay to be bearable.
- Tip #6: Play music that doesn't require tight rhythms. If everyone else is playing a tight funky groove, and you have too much latency to mix in, try playing a soft pad or other long-attack sfx.


# Browser Compatibility
This project aggressively uses latest tech in order to squeeze out features. I do all my development work an Chrome Windows, and smoke testing on Edge.

- Chrome Windows will work best simply because that's where I do development.
- Chrome Mac I expect full compatibility. I did not manage to get MIDI to work, but everything else looked fine.
- Edge Windows should work because I smoke-test there occasionally.
- Edge Mac I have never tested.
- Firefox does not support MIDI ([yet](https://bugzilla.mozilla.org/show_bug.cgi?id=836897)), so it only works for spectators.
- Safari does not support MIDI or ConstantSourceNode, so it's 100% incompatible.
- Opera has been reported to work
- Mobile iOS definitely doesn't work due to Safari incompatibility

Please report compatibility in our [Discord](https://discord.gg/kkf9gQfKAd).

# Dev stuff

## dev process

- `npm run build-dev` // or build-prod. @ http://localhost:8081/
- `npm run watch-dev` // or watch-prod to monitor & build changes live
- `npm run start` // to start local server (or just node index.js)
- `node --inspect index.js` // for chrome inspector debugging the server
- `node --inspect-brk index.js` // for chrome inspector debugging the server, but start broken to give time to attach debugger for startup.
- if using a CDN config (where static files have different host prefix than the app), you can use `node cdn.js` to serve.

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


## Internal features

* activity hooks
* stats (old)
* db
* admin console
* integrations
* authentication
* server state backups, import, export
* server configuration files
* sequencer configuration files
* graffiti uploads
* sfz importing
* ...




## How to: Graffiti

* `/g <content>`. Content can be a URL; if it's a URL then if it's an image it will be displayed as an image.
* You may also drag & drop images from your local computer to 7jam; they'll be imported.
* Supported formats: `GIF`, `JPEG`, `PNG`, `WEBP`. Webp is nice because it supports high-color animations.
* If you want to use giphy or whatever websites, search for stickers. They're typically in `.webp` format which is best.
* Everyone can place 1 graffiti at a time. If your graffiti gets pinned, then you can add another one.
* If you are using a "persistent account" (logged in with a google account), then your graffiti will stay for like 25 days.
  * otherwise, your graffiti will be removed as soon as you disconnect.
* Mods can change parameters of graffiti like position, size, random seed.
* Graffiti can also be pinned by moderators, so it never expires.

## Design guide

* Main GUI are based largely around cyan on cyan (`#00a`), with highlights or "more dynamic / unstable values" in yellow (`#aa0`)
* Moderation controls get orange
* Sequencer play indication green
* Sequencer play with "note swallow" = blue
* Sequencer play with sidechain enabled = red

