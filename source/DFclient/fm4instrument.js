const DF = require("../DFcommon/DFCommon");
const DFU = require('../DFcommon/dfutil');

const GLOBAL_FM4_GAIN = 0.2;


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class FMPolySynth {
    constructor(audioCtx, dryDestination, verbDestination, delayDestination, instrumentSpec, createVoiceFn, noteOnHandler, noteOffHandler) {
        this.noteOnHandler = noteOnHandler;
        this.noteOffHandler = noteOffHandler;

        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.verbDestination = verbDestination;
        this.delayDestination = delayDestination;
        this.instrumentSpec = instrumentSpec;

        this.minGlideS = DF.ClientSettings.InstrumentParamIntervalMS / 1000;

        this.voices = [];
        for (let i = 0; i < instrumentSpec.maxPolyphony; ++i) {
            this.voices.push(createVoiceFn(audioCtx, instrumentSpec));
        }
        this.isSustainPedalDown = false;
        this.isConnected = false;

        this.isPoly = true; // poly or monophonic mode.

        this.physicallyHeldNotes = []; // array of [midiNote, velocity, voiceIndex] in order of note on.
        this.nodes = {};
    }

    restartLFO1() {
        if (this.nodes.lfo1) {
            this.nodes.lfo1.stop();
            this.nodes.lfo1.disconnect();
            this.nodes.lfo1 = null;
        }
        this.nodes.lfo1 = this.audioCtx.createOscillator("inst>LFO");
        this.nodes.lfo1.frequency.value = this.instrumentSpec.GetParamByID("lfo1_speed").currentValue;
        this.nodes.lfo1.start();
        this.nodes.lfo1.connect(this.nodes.lfo1Gain);
    }

    restartLFO2() {
        if (this.nodes.lfo2) {
            this.nodes.lfo2.stop();
            this.nodes.lfo2.disconnect();
            this.nodes.lfo2 = null;
        }
        this.nodes.lfo2 = this.audioCtx.createOscillator("inst>LFO");
        this.nodes.lfo2.frequency.value = this.instrumentSpec.GetParamByID("lfo2_speed").currentValue;
        this.nodes.lfo2.start();
        this.nodes.lfo2.connect(this.nodes.lfo2Gain);
    }

    connect() {
        if (this.isConnected) return;
        this.audioCtx.beginScope(this.instrumentSpec.getDisplayName());

        this.isSustainPedalDown = false;
        // [LFO1] ----->[lfo1Gain] -------------------------------> (voices)  --> [masterDryGain] -> (dryDestination)
        //                                                                    --> [masterVerbGain] -> (reverbDestination)
        //                                                                    --> [masterDelayGain] -> (delayDestination)
        // [LFO2] ----->[lfo2Gain] ------------------------------->
        //                        

        /*
        
     [detuneLFO1amt]                 
    +[detuneLFO2amt] --> [detuneSemis] ----------------------> (osc group x)
    +[detuneBaseSemis]->               --->[detuneVar1]------> (osc group x)
                                       --->[detuneVar2]------> (osc group x)
                                       --->[detuneVar3]------> (osc group x)
        
                                       [pitchbendSemis]------> (voices)
        
        */

        // lfo1
        this.nodes.lfo1 = this.audioCtx.createOscillator("inst>LFO");
        //this._setLFOWaveforms();
        this.nodes.lfo1.frequency.value = this.instrumentSpec.GetParamByID("lfo1_speed").currentValue;
        this.nodes.lfo1.start();

        // lfo1Gain
        this.nodes.lfo1Gain = this.audioCtx.createGain("inst>LFO");
        this.nodes.lfo1Gain.gain.value = 1.0;
        this.nodes.lfo1.connect(this.nodes.lfo1Gain);

        // lfo2
        this.nodes.lfo2 = this.audioCtx.createOscillator("inst>LFO");
        this._setLFOWaveforms();
        this.nodes.lfo2.frequency.value = this.instrumentSpec.GetParamByID("lfo2_speed").currentValue;
        this.nodes.lfo2.start();

        // lfo2Gain
        this.nodes.lfo2Gain = this.audioCtx.createGain("inst>LFO");
        this.nodes.lfo2Gain.gain.value = 1.0;
        this.nodes.lfo2.connect(this.nodes.lfo2Gain);

        // SET UP DETUNE GRAPH

        // detuneLFO1amt
        this.nodes.detuneLFO1amt = this.audioCtx.createGain("inst>detune");
        this.nodes.detuneLFO1amt.gain.value = this.instrumentSpec.GetParamByID("detuneLFO1").currentValue;
        this.nodes.lfo1.connect(this.nodes.detuneLFO1amt);

        // detuneLFO2amt
        this.nodes.detuneLFO2amt = this.audioCtx.createGain("inst>detune");
        this.nodes.detuneLFO2amt.gain.value = this.instrumentSpec.GetParamByID("detuneLFO2").currentValue;
        this.nodes.lfo2.connect(this.nodes.detuneLFO2amt);

        // detuneBaseSemis
        this.nodes.detuneBaseSemis = this.audioCtx.createConstantSource("inst>detune");
        this.nodes.detuneBaseSemis.start();
        this.nodes.detuneBaseSemis.offset.value = this.instrumentSpec.GetParamByID("detuneBase").currentValue;

        // detuneSemis
        this.nodes.detuneSemis = this.audioCtx.createGain("inst>detune");
        this.nodes.detuneSemis.gain.value = 1.0;
        this.nodes.detuneLFO1amt.connect(this.nodes.detuneSemis);
        this.nodes.detuneLFO2amt.connect(this.nodes.detuneSemis);
        this.nodes.detuneBaseSemis.connect(this.nodes.detuneSemis);

        // detuneVar1
        this.nodes.detuneVar1 = this.audioCtx.createGain("inst>detune");
        this.nodes.detuneVar1.gain.value = 1.0;// set later in setting up algo.
        this.nodes.detuneSemis.connect(this.nodes.detuneVar1);

        // detuneVar2
        this.nodes.detuneVar2 = this.audioCtx.createGain("inst>detune");
        this.nodes.detuneVar2.gain.value = 1.0;// set later in setting up algo.
        this.nodes.detuneSemis.connect(this.nodes.detuneVar2);

        // detuneVar3
        this.nodes.detuneVar3 = this.audioCtx.createGain("inst>detune");
        this.nodes.detuneVar3.gain.value = 1.0;// set later in setting up algo.
        this.nodes.detuneSemis.connect(this.nodes.detuneVar3);

        this.nodes.pitchbendSemis = this.audioCtx.createConstantSource("inst>pb");
        this.nodes.pitchbendSemis.start();
        const pb = this.instrumentSpec.GetParamByID("pb");
        if (pb) {
            this.nodes.pitchbendSemis.offset.value = pb.currentValue;
        } else {
            this.nodes.pitchbendSemis.offset.value = 0;
        }

        // masterDryGain
        this.nodes.masterDryGain = this.audioCtx.createGain("inst>master");

        // masterVerbGain
        this.nodes.masterVerbGain = this.audioCtx.createGain("inst>master");

        // masterVerbGain
        this.nodes.masterDelayGain = this.audioCtx.createGain("inst>master");

        let gainLevels = this.getGainLevels();
        this.nodes.masterDryGain.gain.value = gainLevels[0];
        this.nodes.masterVerbGain.gain.value = gainLevels[1];
        this.nodes.masterDelayGain.gain.value = gainLevels[2];

        // set up algo
        let algo = parseInt(this.instrumentSpec.GetParamByID("algo").currentValue);

        const algoSpec = this.instrumentSpec.GetFMAlgoSpec();
        let detuners = [null, null, null, null]; // maps oscillator to detune variation node.
        let oscVariationMap = [0, 0, 0, 0]; // factors for spreadable parameters

        let applyDetune = (oscGroup, detuneSrc, variationFactor) => {
            if (variationFactor !== undefined) {
                detuneSrc.gain.value = variationFactor;
            }
            algoSpec.oscGroups[oscGroup].forEach(oscIndex => {
                detuners[oscIndex] = detuneSrc;
                oscVariationMap[oscIndex] = variationFactor;
            });
        };


        // detuneSemis is always the detune value
        // use detuneVar1, 2, 3 for variations of this, including "0" for center if needed.
        switch (algoSpec.oscGroups.length) {
            case 0:
                break; // nothing to do.
            case 1:
                applyDetune(0, this.nodes.detuneVar1, 0);// no detuning, single osc group. give all oscillators the same "0" detune value.
                break;
            case 2:
                applyDetune(0, this.nodes.detuneSemis, 1);
                applyDetune(1, this.nodes.detuneVar1, -1); // 2 osc groups = + and - detune amt
                break;
            case 3:
                applyDetune(0, this.nodes.detuneVar2, 0);// 3 osc groups = +, 0, - detune amt
                applyDetune(1, this.nodes.detuneVar1, -1);
                applyDetune(2, this.nodes.detuneSemis, 1);
                break;
            case 4:
                applyDetune(0, this.nodes.detuneVar1, 0); // 4 oscillator groups = +detune, 0, +detune*.5, -detune
                applyDetune(1, this.nodes.detuneVar2, 0.5);
                applyDetune(2, this.nodes.detuneSemis, 1);
                applyDetune(3, this.nodes.detuneVar3, -1);
                break;
            default:
                console.warn(`invalid osc tuning group amt`);
                break;
        }

        this.isPoly = (this.instrumentSpec.GetParamByID("voicing").currentValue == 1);
        if (this.isPoly) {
            this.voices.forEach(v => {
                v.connect(this.nodes.lfo1Gain, this.nodes.lfo2Gain, this.nodes.masterDryGain, this.nodes.masterVerbGain, this.nodes.masterDelayGain, algoSpec, this.nodes.pitchbendSemis, detuners, oscVariationMap);
            });
        } else {
            this.isPoly = false;
            this.voices[0].connect(this.nodes.lfo1Gain, this.nodes.lfo2Gain, this.nodes.masterDryGain, this.nodes.masterVerbGain, this.nodes.masterDelayGain, algoSpec, this.nodes.pitchbendSemis, detuners, oscVariationMap);
        }

        this.nodes.masterDryGain.connect(this.dryDestination);
        this.nodes.masterVerbGain.connect(this.verbDestination);
        this.nodes.masterDelayGain.connect(this.delayDestination);

        this.isConnected = true;
        this.audioCtx.endScope();
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;

        Object.keys(this.nodes).forEach(k => {
            let n = this.nodes[k];
            if (n.stop) n.stop();
            n.disconnect();
        });
        this.nodes = {};

        this.voices.forEach(v => { v.disconnect(); });

        this.isConnected = false;
    }



    // sent when there's a MIDI note on event.
    NoteOn(user, midiNote, velocity, isFromSequencer) {
        if (!this.isConnected) this.connect();

        if (this.instrumentSpec.GetParamByID("lfo1_trigMode").currentValue == 1) {
            this.restartLFO1();
        }

        if (this.instrumentSpec.GetParamByID("lfo2_trigMode").currentValue == 1) {
            this.restartLFO2();
        }

        this._setLFOWaveforms();

        // find a free voice and delegate.
        //let suitableVoice = null;
        let suitableVoiceIndex = -1;

        if (this.isPoly) {
            for (let i = 0; i < this.voices.length; ++i) {
                let v = this.voices[i];
                if (!v.IsPlaying) {
                    suitableVoiceIndex = i;// found a free voice; use it.
                    break;
                }

                // voice is playing, but in this case find the oldest voice.
                if (suitableVoiceIndex == -1) {
                    suitableVoiceIndex = i;
                } else {
                    if (v.timestamp < this.voices[suitableVoiceIndex].timestamp) {
                        suitableVoiceIndex = i;
                    }
                }
            }
            if (this.voices[suitableVoiceIndex].IsPlaying) {
                this.noteOffHandler(user, this.instrumentSpec, this.voices[suitableVoiceIndex].midiNote, isFromSequencer);
            }
            this.physicallyHeldNotes.push([midiNote, velocity, suitableVoiceIndex]);
            this.voices[suitableVoiceIndex].physicalAndMusicalNoteOn(midiNote, velocity, false);
            this.noteOnHandler(user, this.instrumentSpec, midiNote, isFromSequencer);
        } else {
            // monophonic always just uses the 1st voice.
            suitableVoiceIndex = 0;

            let isLegato = this.physicallyHeldNotes.length > 0;
            if (this.voices[0].midiNote) {
                this.noteOffHandler(user, this.instrumentSpec, this.voices[0].midiNote, isFromSequencer);
            }
            this.physicallyHeldNotes.push([midiNote, velocity, suitableVoiceIndex]);
            this.voices[suitableVoiceIndex].physicalAndMusicalNoteOn(midiNote, velocity, isLegato);
            this.noteOnHandler(user, this.instrumentSpec, midiNote, isFromSequencer);
        }
    }

    NoteOff(user, midiNote, isFromSequencer) {
        if (!this.isConnected) this.connect();

        this.physicallyHeldNotes.removeIf(n => n[0] == midiNote);

        if (this.isSustainPedalDown) return;

        if (this.isPoly) {
            let v = this.voices.filter(v => v.midiNote == midiNote && v.IsPlaying);
            if (!v.length) return;
            v.forEach(x => x.musicallyRelease(midiNote));
            this.noteOffHandler(user, this.instrumentSpec, midiNote, isFromSequencer);
            return;
        }

        // mono...

        this.noteOffHandler(user, this.instrumentSpec, midiNote, isFromSequencer);

        // monophonic doesn't need a search.
        if (this.physicallyHeldNotes.length == 0) {
            this.voices[0].musicallyRelease(midiNote);
            return;
        }

        // if the note off isn't the one the voice is currently playing then nothing else needs to be done.
        if (midiNote != this.voices[0].midiNote) {
            return;
        }

        // for monophonic here we always act like "triller" triggering. this lets oscillators pop the queue of freqs, 
        // and decide whether to trigger envelopes based on trigger behavior.
        let n = this.physicallyHeldNotes[this.physicallyHeldNotes.length - 1];
        this.voices[0].physicalAndMusicalNoteOn(n[0], n[1], true);
        this.noteOnHandler(user, this.instrumentSpec, n[0], isFromSequencer);
    }

    PedalDown() {
        if (!this.isConnected) this.connect();
        this.isSustainPedalDown = true;
    }

    VoiceIsPhysicalyHeld(voiceIndex) {
        return this.physicallyHeldNotes.find(x => x[2] == voiceIndex) != null;
    }

    PedalUp(user) {
        if (!this.isConnected) this.connect();
        this.isSustainPedalDown = false;
        // for each voice that's NOT physically held, but is playing, release the note.
        this.voices.forEach((v, vindex) => {
            if (v.IsPlaying && !this.VoiceIsPhysicalyHeld(vindex)) {
                //console.log(`musically release note ${v.midiNote}`);
                this.noteOffHandler(user, this.instrumentSpec, v.midiNote);
                v.musicallyRelease(v.midiNote);
            }
        });
    }

    AllNotesOff() {
        this.physicallyHeldNotes = [];
        this.isSustainPedalDown = false;
        this.voices.forEach(v => v.AllNotesOff());
    }

    _setLFOWaveforms() {
        const shapes = ["sine", "square", "sawtooth", "triangle", "sine"];
        this.nodes.lfo1.type = shapes[this.instrumentSpec.GetParamByID("lfo1_wave").currentValue];
        this.nodes.lfo2.type = shapes[this.instrumentSpec.GetParamByID("lfo2_wave").currentValue];
    }

    // returns [drygain, verbgain, delaygain]
    getGainLevels() {
        const mainMul = GLOBAL_FM4_GAIN * this.instrumentSpec.GetParamByID("masterGain").currentValue * DFU.DBToLinear(this.instrumentSpec.GetParamByID("mixerGainDB").currentValue);
        let verbMul = this.instrumentSpec.GetParamByID("verbMix").currentValue;
        let delayMul = this.instrumentSpec.GetParamByID("delayMix").currentValue;
        // when verb mix is 0, drygain is the real master gain.
        // when verb mix is 1, drygain is 0 and verbmix is mastergain
        return [
            (1.0 - verbMul) * mainMul, // not-verb, scaled by master gain
            verbMul * mainMul, // verb, scaled by master gain
            delayMul * mainMul,
        ];
    }

    SetParamValues(patchObj) {
        if (!this.isConnected) return; // mixing desk can change params when it's not even connected.
        let keys = Object.keys(patchObj);
        keys.forEach(paramID => {
            switch (paramID) {
                case "pb":
                    this.nodes.pitchbendSemis.offset.value = patchObj[paramID];
                    break;
                case "mixerGainDB":
                case "delayMix":
                case "masterGain":
                case "verbMix":
                    let levels = this.getGainLevels();
                    this.nodes.masterDryGain.gain.value = levels[0];
                    this.nodes.masterVerbGain.gain.value = levels[1];
                    this.nodes.masterDelayGain.gain.value = levels[2];
                    break;
                case "lfo1_wave":
                case "lfo2_wave":
                    this._setLFOWaveforms();
                    break;
                case "lfo1_speed": {
                    this.nodes.lfo1.frequency.linearRampToValueAtTime(patchObj[paramID], this.audioCtx.currentTime + this.minGlideS);
                    break;
                }
                case "lfo2_speed": {
                    this.nodes.lfo2.frequency.linearRampToValueAtTime(patchObj[paramID], this.audioCtx.currentTime + this.minGlideS);
                    break;
                }
                case "detuneBase":
                    this.nodes.detuneBaseSemis.offset.value = this.instrumentSpec.GetParamByID("detuneBase").currentValue;
                    break;
                case "detuneLFO1":
                    this.nodes.detuneLFO1amt.gain.linearRampToValueAtTime(patchObj[paramID], this.audioCtx.currentTime + this.minGlideS);
                    break;
                case "detuneLFO2":
                    this.nodes.detuneLFO2amt.gain.linearRampToValueAtTime(patchObj[paramID], this.audioCtx.currentTime + this.minGlideS);
                    break;

                // these must be processed here because they do a full disconnect / reconnect.
                case "enable_osc0":
                //console.log(`enable_osc0 ${this.instrumentSpec.GetParamByID("enable_osc0").currentValue}`);
                case "enable_osc1":
                case "enable_osc2":
                case "enable_osc3":
                case "voicing":
                case "linkosc":
                case "algo": {
                    this.disconnect();
                    this.connect();
                    break;
                }
                default:
                    this.voices.forEach(voice => {
                        voice.SetParamValue(paramID, patchObj[paramID]);
                    });
                    break;
            }
        });
    };
};


module.exports = {
    FMPolySynth,
};

