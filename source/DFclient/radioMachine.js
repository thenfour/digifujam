const DFSynthTools = require("./synthTools");
const EventEmitter = require('events');

// STREAM   CLIENT
// offline  offline = "stream offline"
// offline  online  = "stream offline" but you're playing from cache. or maybe timing wrt our pings. call it connected state.
// online   online  = "connected" to stream (playable)
// online   offline = "disconnected" from stream
const eConnectionStatus = {
  Offline : "Offline",
  Disconnected : "Disconnected",
  Connected : "Connected",
}

// an icecast client which acts as an audio node.
// handles metadata, reconnections, client transport.
class IcecastClientNode {

  #addEvent(e) {
    e = `[${new Date().toISOString()}] ${e}`;
    //console.log(e);
    this.eventLog.push(e);
  }

  constructor(audioCtx, id, parentEl, streamURL, metadataURL, refreshIntervalMS) {
    this.alive = true;
    this.parentEl = parentEl;
    this.events = new EventEmitter();
    this.streamURL = streamURL;
    this.metadataURL = metadataURL;
    this.refreshIntervalMS = refreshIntervalMS;

    this.eventLog = [];

    this.icestats = null;

    // we also need to track like, does the user "expect" that the stream is playing, while it's down?
    // playing -> disconnected -> stream up & canplay = PLAY
    // playing -> pause -> disconnect -> stream up & canplay = NO PLAY
    this.isVirtuallyPlaying = true; // <-- auto-play

    this.audioEl = document.createElement('audio');
    this.audioEl.id = id;
    this.audioEl.crossOrigin = "anonymous";

    // to provide comfortable status, we need to compare server status (easy)
    // against whether the client is "connected" to it. it's not so easy to know this though.
    // we know this is true on events 'canplay' and 'canplaythrough'.
    // but knowing when it's false is a different story.
    // https://www.w3schools.com/tags/av_event_error.asp gives a list of interruption events. And we also know about "ended" when the stream ends.
    this.clientPlayable = false;

    this.audioEl.onabort = () => { this.#setClientPlayable(false, `<audio> : abort`); };
    this.audioEl.onemptied = () => { this.#setClientPlayable(false, `<audio> : emptied`); };
    this.audioEl.onended = () => { this.#setClientPlayable(false, `<audio> : ended`); };
    this.audioEl.onerror = () => { this.#setClientPlayable(false, `<audio> : error`); };
    this.audioEl.onstalled = () => { this.#setClientPlayable(false, `<audio> : stalled`); };
    this.audioEl.oncanplay = () => { this.#setClientPlayable(true, `<audio> : canplay`); };
    this.audioEl.oncanplaythrough = () => { this.#setClientPlayable(true, `<audio> : canplaythrough`); };

    parentEl.appendChild(this.audioEl);

    this.audioEl.onplay = () => {
      audioCtx.resume(); // make sure audio doesn't get cockblocked by ctx
      this.events.emit("streamStateChange");
    }

    this.audioEl.onpause = () => {
      this.events.emit("streamStateChange");
    }

    this.audioCtx = audioCtx;

    this.sourceNode = this.audioCtx.createMediaElementSource(this.audioEl);

    this.pingTimer = setTimeout(this.#streamPing, 10);
  }

  #setClientPlayable(b, reason) {
    const wasPlayable = this.clientPlayable;
    this.clientPlayable = b;
    this.events.emit("streamStateChange");
    if (!wasPlayable && b && this.isVirtuallyPlaying) {
      this.#addEvent(`clientPlayable=true due to [${reason}] => and virtually playing; auto-play. `);
      this.audioEl.play();
      return;
    }
    this.#addEvent(`clientPlayable=${b} due to [${reason}]`);
  }

  get Node() {
    return this.sourceNode;
  }

  play() {
    this.#addEvent(`isVirtuallyPlaying = true and calling audioEl.play()`);
    this.isVirtuallyPlaying = true;
    this.events.emit("streamStateChange");
    this.audioEl.play();
  }

  pause() {
    this.isVirtuallyPlaying = false;
    this.#addEvent(`isVirtuallyPlaying = false and calling audioEl.pause()`);
    this.events.emit("streamStateChange");
    this.audioEl.pause();
  }

  playOrPause() {
    const a = this.playOrPauseAction;
    if (a === 'virtualPlay') { // don't call play() because it will take the player out of paused state
      this.#addEvent(`isVirtuallyPlaying = true because playOrPause()`);
      this.events.emit("streamStateChange");
      this.isVirtuallyPlaying = true;
      return;
    }
    if (a === 'play') {
      this.play();
      return;
    }
    this.pause(); // pause or none does this.
  }

  // allows callers to know what actions are allowed
  get playOrPauseAction() {
    const isPlaying = this.IsClientPlaying;
    if (isPlaying)
      return 'pause';
    if (this.clientPlayable)
      return 'play';
    return this.isVirtuallyPlaying ? 'virtualPause' : 'virtualPlay';
  }

  get volume() { return this.audioEl.volume; }
  set volume(v) { this.audioEl.volume = v; }
  get muted() { return this.audioEl.muted; }
  set muted(m) { this.audioEl.muted = m; }

  refresh() {
    // reloads the stream; a way to re-sync to the realtime stream if you've paused.
    this.#addEvent(`calling audioEl.load()`);
    this.audioEl.load();
  }

  get IsStreamOnline() {
    return !!(this.icestats?.source);
  }

  get IsClientPlaying() {
    return !this.audioEl.paused;
  }

  get ConnectionState() {
    const streamOnline = this.IsStreamOnline;
    const clientConnected = this.clientPlayable;
    if (clientConnected)
      return eConnectionStatus.Connected;
    // client not connected.
    return streamOnline ? eConnectionStatus.Disconnected : eConnectionStatus.Offline;
  }

  get StreamInfo() {
    // https://www.w3schools.com/tags/ref_av_dom.asp
    // https://www.icecast.org/docs/icecast-trunk/server_stats/#json-stats
    const isStreamOnline = this.IsStreamOnline;
    return {
      connectionState : this.ConnectionState,
      client : {
        isPlaying : this.IsClientPlaying,
        isPlayable : this.clientPlayable,
        playheadSeconds : this.audioEl.currentTime,
        // you could specify how far behind the stream you are by looking into audioEl.buffered
        decodedBytes : this.audioEl.webkitAudioDecodedByteCount,
      },
      stream : {
        isOnline : isStreamOnline,
        startedDate : isStreamOnline ? new Date(this.icestats.server_start_iso8601) : undefined,
        name : this.icestats?.source?.server_name,
        description : this.icestats?.source?.server_description,
      },
      nowPlaying : {
        title : this.icestats?.source?.title,
        artist : this.icestats?.source?.artist,
      }
    };
  }

  #integrateNewIcestats(icestats) {
    // if stream is transitioning from offline to online, reload automatically.
    const wasStreamOnline = this.IsStreamOnline;
    this.icestats = icestats;
    if (!wasStreamOnline && this.IsStreamOnline) {
      this.#addEvent(`Stream is back up... reloading...`);
      // why is this not set once in ctor? because that will preload the stream if it's already running, which
      // interferes with our state tracking, because we think the stream is offline. this forces us to fetch server metadata first,
      // and we have accurate stuff.
      this.audioEl.src = this.streamURL;
      this.events.emit("streamStateChange");
      this.refresh();
    } else if (wasStreamOnline && !this.IsStreamOnline) {
      this.#addEvent(`Stream went down`);
      this.events.emit("streamStateChange");
    }
    this.events.emit("streamInfo");
  }

  #streamPing = () => {
    this.pingTimer = null;
    fetch(this.metadataURL)
        .then(response => response.json())
        .then(data => {
          this.#integrateNewIcestats(data.icestats);
          if (!this.pingTimer) {
            this.pingTimer = setTimeout(this.#streamPing, this.refreshIntervalMS);
          }
        })
        .catch(e => {
          //console.log(`error`);
          this.#integrateNewIcestats(null);
          if (!this.pingTimer) {
            this.pingTimer = setTimeout(this.#streamPing, this.refreshIntervalMS);
          }
        });
  };

  destroy() {
    this.#addEvent(`Destroy`);
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }

    // disconnect nodes
    this.sourceNode.disconnect();
    this.sourceNode = null;

    // remove audio from doc
    this.audioEl.pause();
    this.audioEl.src = null;
    this.parentEl.removeChild(this.audioEl);
    this.audioEl = null;

    this.alive = false;
  }
}

class RadioMachine {
  constructor(app, audioCtx) {
    this.destNode = app.synth.masterGainNode;
    this.events = new EventEmitter();
    this.audioCtx = audioCtx;
    this.IcyNode = new IcecastClientNode(
        audioCtx,
        "_7jamRadioAudioSource",
        document.getElementById("body"),
        app.roomState.radio.streamURL,     // "https://radio.7jam.io/maj7",
        app.roomState.radio.streamInfoURL, //"https://radio.7jam.io/status-json.xsl?mount=/maj7",
        app.roomState.radio.streamInfoRefreshIntervalMS);

    this.AnalyserNode = this.audioCtx.createAnalyser();

    this.FilterNode = audioCtx.createBiquadFilter();
    this.FilterNode.type = app.roomState.radio.type;
    this.FilterNode.frequency.value = app.roomState.radio.filterFrequency;
    this.FilterNode.Q.value = app.roomState.radio.filterQ;

    this.Reverb = audioCtx.createConvolver();
    this.ReverbGain = audioCtx.createGain();
    this.ReverbGain.gain.value = 0;

    DFSynthTools.gLoadSample(this.audioCtx, app.roomState.radio.reverbImpulseURL,
                             (buffer) => {
                               //console.log(`Loaded reverb impulse.`);
                               this.Reverb.buffer = buffer;
                               this.ReverbGain.gain.value = app.roomState.radio.reverbGain;
                             },
                             (e) => {
                               console.log(`Error loading radio reverb impulse`);
                               console.log(e);
                             });

    this.fxEnabled = app.roomState.radio.fxEnabled;
    this.connect();
  }

  disconnect() {
    this.ReverbGain.disconnect();
    this.Reverb.disconnect();
    this.AnalyserNode.disconnect();
    this.FilterNode.disconnect();
    this.IcyNode.Node.disconnect();
  }

  connect() {
    /*
        [source] -> [analyzer] -> [filter] ------------------------------> [dest]
                                           `'---> [reverb] --> [gain] ---> 
        .
    */
    this.IcyNode.Node.connect(this.AnalyserNode);

    if (this.fxEnabled) {
      this.AnalyserNode.connect(this.FilterNode);
      this.FilterNode.connect(this.destNode);
      this.FilterNode.connect(this.Reverb);
      this.Reverb.connect(this.ReverbGain);
      this.ReverbGain.connect(this.destNode);
    } else {
      this.AnalyserNode.connect(this.destNode);
    }
  }

  get FXEnabled() {
    return this.fxEnabled;
  }

  set FXEnabled(v) {
    this.fxEnabled = v;
    this.disconnect();
    this.connect();
  }

  get ReverbLevel() { return this.ReverbGain.gain.value; }
  set ReverbLevel(v) { this.ReverbGain.gain.value = v; }
  get FilterFrequency() { return this.FilterNode.frequency.value; }
  set FilterFrequency(v) { this.FilterNode.frequency.value = v; }
  get FilterQ() { return this.FilterNode.Q.value; }
  set FilterQ(v) { this.FilterNode.Q.value = v; }
  get FilterType() { return this.FilterNode.type; }
  set FilterType(v) { this.FilterNode.type = v; }

  stop() {
    this.events.emit("stop");
    this.disconnect();
    this.IcyNode.destroy();
  }
}

module.exports = {
  RadioMachine,
  eConnectionStatus
}
