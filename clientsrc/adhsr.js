'use strict';

// (c) Copyright 2018, Sean Connelly (@voidqk), http://sean.cm
// MIT License
// Project Home: https://github.com/voidqk/adsrnode

var DEBUG = false;

function ADSRNode(ctx, opts) {
    // `ctx` is the AudioContext
    // `opts` is an object in the format:
    // {
    //   base:         <number>, // output     optional    default: 0
    //   attack:       <number>, // seconds    optional    default: 0
    //   attackCurve:  <number>, // bend       optional    default: 0
    //   peak:         <number>, // output     optional    default: 1
    //   hold:         <number>, // seconds    optional    default: 0
    //   decay:        <number>, // seconds    optional    default: 0
    //   decayCurve:   <number>, // bend       optional    default: 0
    //   sustain:      <number>, // output     required
    //   release:      <number>, // seconds    optional    default: 0
    //   releaseCurve: <number>  // bend       optional    default: 0
    // }

    function getNum(opts, key, def) {
        if (typeof def === 'number' && typeof opts[key] === 'undefined')
            return def;
        if (typeof opts[key] === 'number')
            return opts[key];
        throw new Error('[ADSRNode] Expecting "' + key + '" to be a number');
    }

    var attack = 0, decay = 0, sustain, sustain_adj, release = 0;
    var base = 0, acurve = 0, peak = 1, hold = 0, dcurve = 0, rcurve = 0;

    function update(opts) {
        base = getNum(opts, 'base', base);
        attack = getNum(opts, 'attack', attack);
        acurve = getNum(opts, 'attackCurve', acurve);
        peak = getNum(opts, 'peak', peak);
        hold = getNum(opts, 'hold', hold);
        decay = getNum(opts, 'decay', decay);
        dcurve = getNum(opts, 'decayCurve', dcurve);
        sustain = getNum(opts, 'sustain', sustain);
        release = getNum(opts, 'release', release);
        rcurve = getNum(opts, 'releaseCurve', rcurve);
        sustain_adj = adjustCurve(dcurve, peak, sustain);
    }

    // extract options
    update(opts);

    // create the node and inject the new methods
    var node = ctx.createConstantSource();
    node.offset.value = base;

    // unfortunately, I can't seem to figure out how to use cancelAndHoldAtTime, so I have to have
    // code that calculates the ADSR curve in order to figure out the value at a given time, if an
    // interruption occurs
    //
    // the curve functions (linearRampToValueAtTime and setTargetAtTime) require an *event*
    // preceding the curve in order to calculate the correct start value... inserting the event
    // *should* work with cancelAndHoldAtTime, but it doesn't (or I misunderstand the API).
    //
    // therefore, for the curves to start at the correct location, I need to be able to calculate
    // the entire ADSR curve myself, so that I can correctly interrupt the curve at any moment.
    //
    // these values track the state of the trigger/release moments, in order to calculate the final
    // curve
    var lastTrigger = false;
    var lastRelease = false;

    // small epsilon value to check for divide by zero
    var eps = 0.00001;

    function curveValue(type, startValue, endValue, curTime, maxTime) {
        if (type === 0)
            return startValue + (endValue - startValue) * Math.min(curTime / maxTime, 1);
        // otherwise, exponential
        return endValue + (startValue - endValue) * Math.exp(-curTime * type / maxTime);
    }

    function adjustCurve(type, startValue, endValue) {
        // the exponential curve will never hit its target... but we can calculate an adjusted
        // target so that it will miss the adjusted value, but end up hitting the actual target
        if (type === 0)
            return endValue; // linear hits its target, so no worries
        var endExp = Math.exp(-type);
        return (endValue - startValue * endExp) / (1 - endExp);
    }

    function triggeredValue(time) {
        // calculates the actual value of the envelope at a given time, where `time` is the number
        // of seconds after a trigger (but before a release)
        var atktime = lastTrigger.atktime;
        if (time < atktime) {
            return curveValue(acurve, lastTrigger.v,
                adjustCurve(acurve, lastTrigger.v, peak), time, atktime);
        }
        if (time < atktime + hold)
            return peak;
        if (time < atktime + hold + decay)
            return curveValue(dcurve, peak, sustain_adj, time - atktime - hold, decay);
        return sustain;
    }

    function releasedValue(time) {
        // calculates the actual value of the envelope at a given time, where `time` is the number
        // of seconds after a release
        if (time < 0)
            return sustain;
        if (time > lastRelease.reltime)
            return base;
        let ret = curveValue(rcurve, lastRelease.v,
            adjustCurve(rcurve, lastRelease.v, base), time, lastRelease.reltime);
        if (isNaN(ret))
            return 0;
        return ret;
    }

    function curveTo(param, type, value, time, duration) {
        if (type === 0 || duration <= 0)
            param.linearRampToValueAtTime(value, time + duration);
        else // exponential
            param.setTargetAtTime(value, time, duration / type);
    }

    node.trigger = function (when) {
        if (typeof when === 'undefined')
            when = this.context.currentTime;

        if (lastTrigger !== false) {
            if (when < lastTrigger.when)
                throw new Error('[ADSRNode] Cannot trigger before future trigger');
            this.release(when);
        }
        var v = base;
        var interruptedLine = false;
        if (lastRelease !== false) {
            var now = when - lastRelease.when;
            v = releasedValue(now);
            // check if a linear release has been interrupted by this attack
            interruptedLine = rcurve === 0 && now >= 0 && now <= lastRelease.reltime;
            lastRelease = false;
        }
        var atktime = attack;
        if (Math.abs(base - peak) > eps)
            atktime = attack * (v - peak) / (base - peak);
        lastTrigger = { when: when, v: v, atktime: atktime };

        this.offset.cancelScheduledValues(when);

        if (DEBUG) {
            // simulate curve using triggeredValue (debug purposes)
            for (var i = 0; i < 10; i += 0.01)
                this.offset.setValueAtTime(triggeredValue(i), when + i);
            return this;
        }

        if (interruptedLine)
            this.offset.linearRampToValueAtTime(v, when);
        else {
            this.offset.setTargetAtTime(v, when, 0.001);
        }
        curveTo(this.offset, acurve, adjustCurve(acurve, v, peak), when, atktime);
        this.offset.setTargetAtTime(peak, when + atktime, 0.001);
        if (hold > 0)
            this.offset.setTargetAtTime(peak, when + atktime + hold, 0.001);
        curveTo(this.offset, dcurve, sustain_adj, when + atktime + hold, decay);
        this.offset.setTargetAtTime(sustain, when + atktime + hold + decay, 0.001);
        return this;
    };

    node.release = function () {
        // if (typeof when === 'undefined')
        //     when = this.context.currentTime;
        const when = this.context.currentTime;

        // if (lastTrigger === false)
        //     throw new Error('[ADSRNode] Cannot release without a trigger');
        // if (when < lastTrigger.when)
        //     throw new Error('[ADSRNode] Cannot release before the last trigger');
        var tnow = when - lastTrigger.when;
        var v = triggeredValue(tnow);
        var reltime = release;
        // if (Math.abs(sustain - base) > eps)  <-- not sure the point of this
        //     reltime = release * (v - base) / (sustain - base);
        lastRelease = { when: when, v: v, reltime: reltime };
        var atktime = lastTrigger.atktime;
        // check if a linear attack or a linear decay has been interrupted by this release
        var interruptedLine =
            (acurve === 0 && tnow >= 0 && tnow <= atktime) ||
            (dcurve === 0 && tnow >= atktime + hold && tnow <= atktime + hold + decay);
        lastTrigger = false;

        this.offset.cancelScheduledValues(when);
        node.baseTime = when + reltime;

        // if (DEBUG) {
        //     // simulate curve using releasedValue (debug purposes)
        //     for (var i = 0; true; i += 0.01) {
        //         this.offset.setValueAtTime(releasedValue(i), when + i);
        //         if (i >= reltime)
        //             break;
        //     }
        //     return this;
        // }

        if (interruptedLine)
            this.offset.linearRampToValueAtTime(v, when);
        else
            this.offset.setTargetAtTime(v, when, 0.001);
        curveTo(this.offset, rcurve, adjustCurve(rcurve, v, base), when, reltime);
        this.offset.setTargetAtTime(base, when + reltime, 0.001);
        return this;
    };

    node.reset = function () {
        lastTrigger = false;
        lastRelease = false;
        var now = this.context.currentTime;
        this.offset.cancelScheduledValues(now);
        this.offset.setTargetAtTime(base, now, 0.001);
        node.baseTime = now;
        return this;
    };

    node.update = function (opts) {
        update(opts);
        //return this.reset();
        return this;
    };

    node.baseTime = 0;

    return node;
}

module.exports = {
    ADSRNode
};
