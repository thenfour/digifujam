

Array.prototype.removeIf = function (callback) {
    var i = this.length;
    while (i--) {
        if (callback(this[i], i)) {
            this.splice(i, 1);
        }
    }
};

let secondsToMS = (x) => x * 1000;
let minutesToMS = (x) => secondsToMS(x * 60);
let hoursToMS = (x) => minutesToMS(x * 60);
let daysToMS = (x) => hoursToMS(x * 24);

let getArrowText = shown => shown ? '⯆' : '⯈';

// get only the decimal part of a number.  https://stackoverflow.com/a/65046431/402169
function getDecimalPart(decNum) {
    return Math.round((decNum % 1) * 100000000) / 100000000;
}

function array_move(arr, old_index, new_index) {
    if (new_index >= arr.length) {
        var k = new_index - arr.length + 1;
        while (k--) {
            arr.push(undefined);
        }
    }
    arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
    //return arr; // for testing
};

// https://stackoverflow.com/a/40407914/402169
function baseClamp(number, lower, upper) {
    if (number === number) {
        if (upper !== undefined) {
            number = number <= upper ? number : upper;
        }
        if (lower !== undefined) {
            number = number >= lower ? number : lower;
        }
    }
    return number;
}

let MidiNoteToFrequency = function (midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
};
let FrequencyToMidiNote = (hz) => {
    return 12.0 * Math.log2(Math.max(8, hz) / 440) + 69;
};

// linear mapping
let remap = function (value, low1, high1, low2, high2) {
    return low2 + (high2 - low2) * (value - low1) / (high1 - low1);
}

let remapWithPowCurve = (value, inpMin, inpMax, p, outpMin, outpMax) => {
    // map to 0-1
    value -= inpMin;
    value /= inpMax - inpMin;
    if (value < 0) value = 0;
    if (value > 1) value = 1;
    // curve
    value = Math.pow(value, p);
    // map to outpMin-outpMax
    value *= outpMax - outpMin;
    return value + outpMin;
};


// invokes a fn in a throttled way. You set a proc & interval, and call InvokeThrottled() when you want to invoke it.
class Throttler {
    constructor(interval, proc) {
        this.interval = interval || 1000.0 / 15;
        this.proc = proc || (() => { }); // the work fn to run throttled

        this.stats = {
            timersCreated: 0,
            invokesSkipped: 0,
            realtimeInvokes: 0,
            throttledInvokes: 0,
            invokes: 0,
        };

        this.timerCookie = null;
        this.Reset();
    }

    Reset() {
        if (this.timerCookie) {
            clearTimeout(this.timerCookie);
        }
        this.timerCookie = null;
        this.lastInvoked = new Date();
        // (reset params)
    }

    InvokeThrottled() {
        if (this.timerCookie) {
            // already have a timer pending
            // (integrate to queued)
            this.stats.invokesSkipped++;
            return;
        }

        let now = new Date();
        let delta = now - this.lastInvoked;
        if (delta >= this.interval) {
            // we waited long enough between changes; invoke in real time.
            this.lastInvoked = now;
            this.stats.invokes++;
            this.stats.realtimeInvokes++;
            this.proc();
            return;
        }

        // we need to set a timer.
        this.stats.timersCreated++;
        this.timerCookie = setTimeout(() => {
            this.timerCookie = null;
            this.stats.invokes++;
            this.stats.throttledInvokes++;
            //console.log(`Throttler invoke; timeout=${this.interval - delta}`);//. timerscreated:${this.timersCreated}, paramsOptimized:${this.invokesSkipped}, paramsSent:${this.invokes}`);
            //console.log(this.stats);
            this.proc();
            this.Reset();
        }, this.interval - delta);
    };
};

let BeatsToMS = (beats, bpm) => {
    return (beats * 60000.0) / bpm;
    // ms = (b * 60k) / bpm;
    // ms*bpm = b*60k;
    // (ms*bpm)/60k = b;
};

let MSToBeats = (ms, bpm) => {
    return ms / 60000.0 * bpm;
};


let steppedCeil = (x, step) => { // so imagine 4.22 with step of 0.33. i want to return 4.33.
    if (step < 0.00001) return x;
    return Math.ceil(x / step) * step;
};

let steppedFloor = (x, step) => {
    if (step < 0.00001) return x;
    return Math.floor(x / step) * step;
};

let dividedCeil = (x, denom) => { // so imagine 4.22 with denom of 3. i want to return 4.33.
    if (denom < 0.00001) return x;
    return Math.ceil(x * denom) / denom;
};

let dividedFloor = (x, denom) => {
    if (denom < 0.00001) return x;
    return Math.floor(x * denom) / denom;
};

let lerp = (start, end, amt) => {
    return (1 - amt) * start + amt * end;
};

const DBToLinear = dB => {
    return Math.pow(10, dB / 20);
};

module.exports = {
    secondsToMS,
    minutesToMS,
    hoursToMS,
    daysToMS,
    getArrowText,
    getDecimalPart,
    array_move,
    baseClamp,
    MidiNoteToFrequency,
    FrequencyToMidiNote,
    remap,
    remapWithPowCurve,
    Throttler,
    BeatsToMS,
    MSToBeats,
    steppedCeil,
    steppedFloor,
    dividedCeil,
    dividedFloor,
    lerp,
    DBToLinear,
};
