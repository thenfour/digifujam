const {nanoid} = require("nanoid");

Array.prototype.removeIf = function(callback) {
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

function FormatTimeMS(ms) {
  return new Date(ms).toISOString().substring(11).substring(0, 8);
}

// another way of getting time duration info
class TimeSpan {
  constructor(ms) {
    //const Sign = Math.sign(ms);
    //ms = Math.abs(ms);
    // if (ms < 0) // why? negative timespans are just fine.
    //   ms = 0;
    this.__totalMilliseconds = ms;
    this.__totalSeconds = Math.floor(ms / 1000);
    this.__totalMinutes = Math.floor(ms / 60000);
    this.__totalHours = Math.floor(ms / (60000 * 60));
    this.__totalDays = Math.floor(ms / (60000 * 60 * 24));
    this.__secondsPart = this.__totalSeconds % 60;
    this.__minutesPart = this.__totalMinutes % 60;
    this.__hoursPart = this.__totalHours % 24;
    this.__shortString = `${this.__totalHours}h ${this.__minutesPart}m ${this.__secondsPart}s`;
    if (!this.__totalHours && !!this.__minutesPart) {
      this.__shortString = `${this.__minutesPart}m ${this.__secondsPart}s`;
    } else if (!this.__totalHours && !this.__minutesPart) {
      this.__shortString = `${this.__secondsPart}s`;
    }

    this.__longString = `${this.__totalDays} days ${this.__hoursPart} hours ${this.__minutesPart} min ${this.__secondsPart} sec`;
    if (!this.__totalDays) {
      this.__longString = `${this.__hoursPart} hours ${this.__minutesPart} min ${this.__secondsPart} sec`;
      if (!this.__hoursPart) {
        this.__longString = `${this.__minutesPart} min ${this.__secondsPart} sec`;
        if (!this.__minutesPart) {
          this.__longString = `${this.__secondsPart} sec`;
        }
      }
    }
  } // ctor

  get totalMilliseconds() { return this.__totalMilliseconds; }
  get totalSeconds() { return this.__totalSeconds; }
  get totalMinutes() { return this.__totalMinutes; }
  get totalHours() { return this.__totalHours; }
  get totalDays() { return this.__totalDays; }
  get secondsPart() { return this.__secondsPart; }
  get minutesPart() { return this.__minutesPart; }
  get hoursPart() { return this.__hoursPart; }
  get shortString() { return this.__shortString; }
  get longString() { return this.__longString; }

} // TimeSpan

// strip args off args, return them and the remaining unparsed string.
function GrabArgs(args, count) {
  let ret = [ args ?? '' ];
  for (let i = 0; i < count; ++i) {
    let tmp = ret.at(-1)?.trim().split(/(\s.*)/).map(s => s.trim()); // awkward way of splitting by 1st whitespace
    tmp ??= [];
    ret = ret.slice(0, ret.length - 1).concat(tmp.filter(t => t.trim().length));
  }
  return ret;
}

let getArrowText = shown => shown ? '⯆' : '⯈';

// get only the decimal part of a number.  https://stackoverflow.com/a/65046431/402169
// function getDecimalPart(decNum) {
//    return Math.round((decNum % 1) * 100000000) / 100000000;
// }
// i don't like that function... wtf really.
function getDecimalPart(x) {
  return x - Math.trunc(x);
}

// retains repeating pattern into the negative.
function modulo(x, n) {
  return ((x % n) + n) % n;
};

// given a period length,
// and a begin/length in the period (NOTE: if length is longer than 1 period, returns always true)
// does X lie in the begin-end segment.
//   |-----------|-----------|-----------|-----------|-----------|-----------
//         [=======]   [=======]   [=======]   [=======]   [=======]
//         ^begin      ^begin
//    <----------> period
function IsInPeriodicSegment(x, period, begin, length) {
  x = modulo(x, period);      // bring x into window 0
  const end = begin + length; // note: this may lie outside window 0.
  if (x >= begin && x < end)
    return true;
  // check if window 1 satisfies.
  x += period;
  if (x >= begin && x < end)
    return true;
  return false;
}

// todo: optimize for sorted arrays
function findNearestIndex(array, distFn) {
  let closestDistance = 0x7fffffff;
  let closestIndex = -1;
  array.forEach((e, i) => {
    const dist = distFn(e, i);
    if (dist < closestDistance) {
      closestDistance = dist;
      closestIndex = i;
    }
  });
  return closestIndex;
}
function findNearest(array, distFn) {
  return array.at(findNearestIndex(array, distFn));
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

// https://stackoverflow.com/a/34890276/402169
// console.log(groupBy(['one', 'two', 'three'], 'length'));
// => {3: ["one", "two"], 5: ["three"]}
function groupBy(array, keySelectorFn) {
  return array.reduce((rv, el) => {
    const k = keySelectorFn(el);
    (rv[k] ??= []).push(el);
    return rv;
  }, {});
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

let MidiNoteToFrequency = function(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
};
let FrequencyToMidiNote = (hz) => {
  return 12.0 * Math.log2(Math.max(8, hz) / 440) + 69;
};

// linear mapping
let remap = function(value, low1, high1, low2, high2) {
  return low2 + (high2 - low2) * (value - low1) / (high1 - low1);
}

let remapWithPowCurve = (value, inpMin, inpMax, p, outpMin, outpMax) => {
  // map to 0-1
  value -= inpMin;
  value /= inpMax - inpMin;
  if (value < 0)
    value = 0;
  if (value > 1)
    value = 1;
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
    this.proc = proc || (() => {}); // the work fn to run throttled

    this.stats = {
      timersCreated : 0,
      invokesSkipped : 0,
      realtimeInvokes : 0,
      throttledInvokes : 0,
      invokes : 0,
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
  if (step < 0.00001)
    return x;
  return Math.ceil(x / step) * step;
};

let steppedFloor = (x, step) => {
  if (step < 0.00001)
    return x;
  return Math.floor(x / step) * step;
};

let dividedCeil = (x, denom) => { // so imagine 4.22 with denom of 3. i want to return 4.33.
  if (denom < 0.00001)
    return x;
  return Math.ceil(x * denom) / denom;
};

let dividedFloor = (x, denom) => {
  if (denom < 0.00001)
    return x;
  return Math.floor(x * denom) / denom;
};

let lerp = (start, end, amt) => {
  return (1 - amt) * start + amt * end;
};

const DBToLinear = dB => {
  return Math.pow(10, dB / 20);
};

function StringReplaceAllCaseInsensitive(str, strReplace, strWith) {
  // See http://stackoverflow.com/a/3561711/556609
  // https://stackoverflow.com/a/7313467/402169
  var esc = strReplace.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  var reg = new RegExp(esc, 'ig');
  return str.replace(reg, strWith);
};

function PerformSubstitutions(str, subs) {
  Object.keys(subs).forEach(k => {
    str = StringReplaceAllCaseInsensitive(str, k, subs[k]);
  });
  return str;
}

function ProcessMessageFields(fieldsSpec, subs) {
  let messageFields = {};
  if (fieldsSpec) {
    Object.keys(fieldsSpec).forEach(k => {
      messageFields[PerformSubstitutions(k, subs)] = PerformSubstitutions(fieldsSpec[k], subs);
    });
  }
  return messageFields;
}

function generateID() {
  return nanoid(10);
}

function generateUserID() {
  return "u" + generateID();
}


function IsServer() {
  return typeof window === 'undefined';
}

function IsClient() {
  return !IsServer();
}

// https://stackoverflow.com/questions/4059147/check-if-a-variable-is-a-string-in-javascript?answertab=scoredesc#tab-top
// lol javascript.
function IsString(myVar) {
  return (typeof myVar === 'string' || myVar instanceof String);
}

const imageExtensions = [
  ".png",
  ".gif",
  ".jpeg",
  ".jpg",
  ".svg",
  ".webp",
  //".mp4", does not work.
  //".webm",does not work.
];
function IsImageFilename(f) {
  f = f.toLowerCase();
  return imageExtensions.some(ext => f.endsWith(ext));
}

// point-in-polygon stuff
// https://github.com/substack/point-in-polygon
// some example code:

// var polygon = [[0, 30], [150, 330], [140, 800]];

// function handleClick(e) {
//     console.log(Date.now() + `  >>> [${e.offsetX}, ${e.offsetY}] => ` + pointInPolygon([e.offsetX, e.offsetY], polygon));
// }

// const svg = document.querySelector("#cont");
// const p = polyToPathEl(polygon);
// p.style["fill"] = `rgb(${(Math.random() * 255) | 0},${(Math.random() * 255) | 0},${(Math.random() * 255) | 0}, 0.5)`;
// svg.appendChild(p);

function pointInPolygon(point, vs, start, end) {
  var x = point[0], y = point[1];
  var inside = false;
  start ??= 0;
  end ??= vs.length;
  var len = end - start;
  for (var i = 0, j = len - 1; i < len; j = i++) {
    var xi = vs[i + start][0], yi = vs[i + start][1];
    var xj = vs[j + start][0], yj = vs[j + start][1];
    var intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect)
      inside = !inside;
  }
  return inside;
};


class DFRect {
  constructor() {
      this.x = 0;
      this.y = 0;
      this.w = 0;
      this.h = 0;
  }
  thaw() { }

  PointIntersects(pt) {
      if (pt.x < this.x) return false;
      if (pt.y < this.y) return false;
      if (pt.x >= this.x + this.w) return false;
      if (pt.y >= this.y + this.h) return false;
      return true;
  }
};


function pointToStr(p) {
  return `${p[0]},${p[1]}`;
}

function polyToPathDesc(poly) {
  let ret = "M " + pointToStr(poly[0]);
  for (let i = 1; i < poly.length; ++i) {
    ret += " L " + pointToStr(poly[i]);
  }
  ret += " z";
  return ret;
}

class CommandHistory {
  constructor() {
    this.historyCursor = 0; // 0 = new; 1 = previous etc.
    this.history = [ "" ];
  }

  // registers a new item
  onEnter(cmdLine) {
    this.history[0] = cmdLine;
    if (!this.historyCursor) {
      this.history.unshift(""); // only add a new blank commandline when you're at the top of the stack
    }
    this.historyCursor = 0;
  }

  // returns the new item
  onUp() {
    return this.#SetHistoryCursor(this.historyCursor + 1);
  }

  onDown() {
    return this.#SetHistoryCursor(this.historyCursor - 1);
  }

  #SetHistoryCursor(newCursor) {
    newCursor = Math.max(0, Math.min(this.history.length - 1, newCursor));
    this.historyCursor = newCursor;
    return this.history[newCursor];
  }
}

// similar to Throttler but with parameter key/val
class ParamThrottler {
  constructor(periodMS, handler) {
    this.timer = null;
    this.periodMS = periodMS;
    this.handler = handler;
    this.queuedParamChangeData = new Map();
    this.paramChangeLastSent = 0;
  }

  // based on net.SendInstrumentParams
  InvokeChange(key, val, isWholePatch) {
    // - if we have a timer set, modify its value
    // - if we're slow enough, and no timer set, then send live.
    // - if we're too fast, then set timer with this packet.

    if (isWholePatch) { // if you're changing "the whole patch", then wipe out any previous patch changes.
      this.queuedParamChangeData.clear();
    }
    this.queuedParamChangeData.set(key, val);

    // already have a timer pending; integrate this patch obj.
    if (this.timer) {
      return false;
    }

    let now = Date.now();
    let delta = now - this.paramChangeLastSent;
    if (delta >= this.periodMS) {
      // we waited long enough between changes; send in real time.
      this.paramChangeLastSent = now;
      this.handler(this.queuedParamChangeData);
      return true;
    }

    this.timer = setTimeout(this.timerProc, this.periodMS - delta);
    return false;
  };

  timerProc = () => { // avoid allocation in potentially hot path
    this.handler(this.queuedParamChangeData);
    this.timer = null;
    this.queuedParamChangeData.clear();
  }
}


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
  StringReplaceAllCaseInsensitive,
  PerformSubstitutions,
  ProcessMessageFields,
  FormatTimeMS,
  GrabArgs,
  TimeSpan,
  modulo,
  IsInPeriodicSegment,
  findNearest,
  findNearestIndex,
  groupBy,
  generateID,
  generateUserID,
  IsClient,
  IsServer,
  polyToPathDesc,
  pointInPolygon,
  IsImageFilename,
  CommandHistory,
  ParamThrottler,
  DFRect,
  IsString,
};
