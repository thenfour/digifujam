
function DigifuUser() {
    this.Name = "tenfour";
    this.Color = "#ff00ff";
    this.UserID = null;
};

function DigifuInstrument()
{
    this.Name = "guitar";
    this.Color = "#00ff00";
    this.SynthInstrumentType = "synth";
    this.InstrumentID = null;
};

function DigifuApp() {
    this.InstrumentCloset = []; // list of DigifuInstrument instances
    this.Users = [];

    this.MyUser = new DigifuUser(); // filled in when we identify to a server and fill users

    this.Midi = new DigifuMidi();
    this.Synth = new DigifuSynth(); // contains all music-making stuff.
    this.Net = new DigifuNet();
};

// MIDI HANDLERS --------------------------------------------------------------------------------------
DigifuApp.prototype.MIDI_NoteOn = function(note, velocity) {
    log(`Note on ${note}`);
    // send to server immediately.
    // and update synth.
    this.Synth.NoteOn();
};

DigifuApp.prototype.MIDI_NoteOff = function(note) {
    log(`Note off ${note}`);
};



// NETWORK HANDLERS --------------------------------------------------------------------------------------
DigifuApp.prototype.NET_OnPleaseIdentify = function() {
    // send your details
    this.Net.SendIdentify(this.MyUser);
};
DigifuApp.prototype.NET_OnWelcome = function(data) {
    // get room state
};
DigifuApp.prototype.NET_OnUserEnter = function(data) {
    // update state
};
DigifuApp.prototype.NET_OnUserLeave = function(userID) {
    // update state
};
DigifuApp.prototype.NET_OnInstrumentOwnership = function(instrumentID, userID) {

};
DigifuApp.prototype.NET_OnUserPlay = function() {

};



// ENTRY POINT --------------------------------------------------------------------------------------
DigifuApp.prototype.Main = function()
{
    // init engines
    this.Midi.Init(this);
    //this.Synth.Init();
    this.Net.Connect("ws://localhost:8080", this);
};
