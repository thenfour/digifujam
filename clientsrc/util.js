const DF = require("./DFCommon");
const EventEmitter = require('events');

class ModifierKeyTracker {
    constructor() {

        this.ShiftKey = false;
        this.CtrlKey = false;
    
        $(document).on('keydown', (e) => {
            if (e.shiftKey) {
                this.ShiftKey = true;
            }
            if (e.ctrlKey) {
                this.CtrlKey = true;
            }
        });
        $(document).on('keyup', (e) => {
            if (e.shiftKey == false) {
                this.ShiftKey = false;
            }
            if (e.ctrlKey == false) {
                this.CtrlKey = false;
            }
        });
    
    }
};


class GestureTracker {
    get hasUserGestured() {
        return this.__hasUserGestured;
    }
    constructor() {
        this.events = new EventEmitter();
        this.__hasUserGestured = false;
        $(document).on('keydown', (e) => {
            //console.log(`GestureTracker -> keydown`);
            if (!this.__hasUserGestured) {
                this.__hasUserGestured = true;
                this.events.emit('gesture');
            }
        });
        $(document).on('keyup', (e) => {
            //console.log(`GestureTracker -> keyup`);
            if (!this.__hasUserGestured) {
                this.__hasUserGestured = true;
                this.events.emit('gesture');
            }
        });
        $(document).on('touchstart', (e) => {
            //console.log(`GestureTracker -> touchstart`);
            if (!this.__hasUserGestured) {
                this.__hasUserGestured = true;
                this.events.emit('gesture');
            }
        });
        $(document).on('click', (e) => {
            //console.log(`GestureTracker -> click`);
            if (!this.__hasUserGestured) {
                this.__hasUserGestured = true;
                this.events.emit('gesture');
            }
        });
    }
};


function IsValidJSONString(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

// based on
// https://stackoverflow.com/questions/18389224/how-to-style-html5-range-input-to-have-different-color-before-and-after-slider
let stylizeRangeInput = (elementID, opts) => {
    let stylize = (target) => {
        if (!target) return;
        let min = parseFloat(target.min);
        let max = parseFloat(target.max);
        let v = parseFloat(target.value);
        let zp = (opts.zeroVal - min) / (max - min) * 100;
        let vp = (v - min) / (max - min) * 100;
        if (v < opts.zeroVal) {
            target.style.background = `linear-gradient(to right,
                        ${opts.bgNegColorSpec} 0%, ${opts.bgNegColorSpec} ${vp}%,
                        ${opts.negColorSpec} ${vp}%, ${opts.negColorSpec} ${zp}%,
                        ${opts.bgPosColorSpec} ${zp}%, ${opts.bgPosColorSpec} 100%)`;
            return;
        }

        if (v == max) {
            target.style.background = `linear-gradient(to right,
                        ${opts.bgNegColorSpec} 0%, ${opts.bgNegColorSpec} ${zp}%,
                        ${opts.posColorSpec} ${zp}%, ${opts.posColorSpec} ${vp}%, ${opts.bgPosColorSpec} ${vp}%`;
        }

        target.style.background = `linear-gradient(to right,
                        ${opts.bgNegColorSpec} 0%, ${opts.bgNegColorSpec} ${zp}%,
                        ${opts.posColorSpec} ${zp}%, ${opts.posColorSpec} ${vp}%,
                        ${opts.bgPosColorSpec} ${vp}%, ${opts.bgPosColorSpec} 100%)`;

    };
    $("#" + elementID).on('input', e => stylize(e.target));
    $("#" + elementID).on('change', e => stylize(e.target));
    stylize(document.getElementById(elementID));
};

// requires accompanying CSS to prevent default rendering, give some base styles

// stylizeRangeInput("hi", {
//     bgNegColorSpec: "gray",
//     negColorSpec: "red",
//     posColorSpec: "green",
//     bgPosColorSpec: "white",
//     zeroVal: 3,
// });



let testExportValue = (min, max, v) => {
    let p = Object.assign(new DF.InstrumentParam(), {
        /*valueCurve: 2,*/
        minValue: min,
        maxValue: max
    });
    let x = p.nativeToForeignValue(v, 0, 160);
    let x2 = p.foreignToNativeValue(x, 0, 160);
    console.log(`${v} => ${x} => ${x2}`);
    //return x;
};


let testImportValue = (min, max, v) => {
    let p = Object.assign(new DF.InstrumentParam(), {
        /*valueCurve: 2,*/
        minValue: min,
        maxValue: max
    });
    let x = p.foreignToNativeValue(v, 0, 160);
    let x2 = p.nativeToForeignValue(x, 0, 160);
    console.log(`${v} => ${x} => ${x2}`);
    //return x;
};


// a sorted array of objects, with ability to find object based on distance to val
// and increment/decrement clamped. used by UI value selection.
class FuzzySelector
{
    constructor(sortedValues, distFn) {
        this.sortedValues = sortedValues;
        this.distFn = distFn;
    }

    GetClosestMatch(val, indexDelta) {
        if (!this.sortedValues.length)
            return null;
        let minDist = 0x7FFFFFFF;
        let minObjIndex = 0;
        for (let i = 0; i < this.sortedValues.length; ++ i) {
            let dist = this.distFn(val, this.sortedValues[i]);
            if (dist >= minDist)
                continue;
            minDist = dist;
            minObjIndex = i;
        }
        minObjIndex += indexDelta ?? 0;
        if (minObjIndex < 0)
            minObjIndex = 0;
        if (minObjIndex >= this.sortedValues.length - 1)
            minObjIndex = this.sortedValues.length - 1;
        return this.sortedValues[minObjIndex];
    }

    get min() { return this.sortedValues.at(0); }
    get max() { return this.sortedValues.at(-1); }
}



module.exports = {
    stylizeRangeInput,
    IsValidJSONString,
    ModifierKeyTracker,
    GestureTracker,
    FuzzySelector,
};

