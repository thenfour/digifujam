// i guess this util lib is client UI stuff
const DF = require("../DFcommon/DFCommon");
const EventEmitter = require('events');

function altHotkey(keyName, eventName) {
  return {
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    eventName,
    keyName,
  };
}

// modifier hotkeys can be triggered even when you're focused in a text box.
const gModifierHotkeys = [
  altHotkey("m", "toggleMute"),
  // alt+0 is error log
  altHotkey("1", "selectSeqPatternA"),
  altHotkey("2", "selectSeqPatternB"),
  altHotkey("3", "selectSeqPatternC"),
  altHotkey("4", "selectSeqPatternD"),
  altHotkey("5", "toggleSequencerShown"),
  altHotkey("9", "toggleModerationControls"),
];

// raw hotkeys represent hotkeys that can result in character input. therefore
// they should only trigger when not focused in a text box.
function rawHotkey(keyName, eventName) {
  return {
    keyName,
    eventName,
  };
}

const gRawHotkeys = [
  rawHotkey("\\", "cheer"),
  rawHotkey(" ", "toggleStartStopSequencer"),
];

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

function getSelectionText() {
  var text = "";
  if (window.getSelection) {
    text = window.getSelection().toString();
  } else if (document.selection && document.selection.type != "Control") {
    text = document.selection.createRange().text;
  }
  return text;
}

class GestureTracker {

  get hasUserGestured() {
    return this.__hasUserGestured;
  }

  constructor() {
    this.events = new EventEmitter();
    this.__hasUserGestured = false;

    document.addEventListener('keydown', (e) => {
      //console.log(`GestureTracker -> keydown`);
      if (!this.__hasUserGestured) {
        this.__hasUserGestured = true;
        this.events.emit('gesture');
      }

      this.events.emit('keydown', e);

      // if (window.DFModerationControlsVisible) {
      //   console.log(e);
      // }

      if (e.key === '0' && e.altKey) {
        return; // special case: don't let the global debug log hotkey to interfere with our handling.
      }

      let handled = gModifierHotkeys.find(hotkey => {
        if (e.key !== hotkey.keyName) return false;
        if ((hotkey.altKey !== null) && e.altKey !== hotkey.altKey) return false;
        if ((hotkey.ctrlKey !== null) && e.ctrlKey !== hotkey.ctrlKey) return false;
        if ((hotkey.shiftKey !== null) && e.shiftKey !== hotkey.shiftKey) return false;
        e.preventDefault();
        this.events.emit(hotkey.eventName, e);
        handled = true;
        return true;
      });
      if (handled) return;

      if (window.DFChatinput) {
        if (e.target.tagName == 'BODY' && e.key.length === 1 && !e.altKey && !e.ctrlKey) { // BODY means it's bubbled up to the top of the DOM. nothing else has handled it.
          //console.log(`  charcode=${e.charCode}, keycode=${e.keyCode} key=${e.key} code=${e.code} which=${e.which} tag=${e.target.tagName}`);
          if (getSelectionText()?.length === 0) { // if you are selecting text, then you probably want to copy it or something? using keyboard shortcuts? anyway don't proceed.
            //if ("/abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()='\",<>.`~;:".indexOf(e.key) != -1) { // don't include registered hotkeys here.
            if (!gRawHotkeys.find(hk => hk.keyName === e.key)) {
              window.DFChatinput.focus();
              return;
            }
          }
        }
      }

      if (!handled && e.target.tagName == 'BODY') {
        gRawHotkeys.find(hk => {
          if (hk.keyName !== e.key) return false;
          e.preventDefault();
          this.events.emit(hk.eventName, e);
          return true;
        });
      }
    });

    document.onkeyup = (e) => {
      //console.log(`GestureTracker -> keyup`);
      if (!this.__hasUserGestured) {
        this.__hasUserGestured = true;
        this.events.emit('gesture');
      }
    };

    document.ontouchstart = (e) => {
      //console.log(`GestureTracker -> touchstart`);
      if (!this.__hasUserGestured) {
        this.__hasUserGestured = true;
        this.events.emit('gesture');
      }
    };

    document.onclick = (e) => {
      //console.log(`GestureTracker -> click`);
      if (!this.__hasUserGestured) {
        this.__hasUserGestured = true;
        this.events.emit('gesture');
      }
    };
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
    if (!target)
      return;
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
    minValue : min,
    maxValue : max
  });
  let x = p.nativeToForeignValue(v, 0, 160);
  let x2 = p.foreignToNativeValue(x, 0, 160);
  console.log(`${v} => ${x} => ${x2}`);
  //return x;
};

let testImportValue = (min, max, v) => {
  let p = Object.assign(new DF.InstrumentParam(), {
    /*valueCurve: 2,*/
    minValue : min,
    maxValue : max
  });
  let x = p.foreignToNativeValue(v, 0, 160);
  let x2 = p.nativeToForeignValue(x, 0, 160);
  console.log(`${v} => ${x} => ${x2}`);
  //return x;
};

// a sorted array of objects, with ability to find object based on distance to val
// and increment/decrement clamped. used by UI value selection.
class FuzzySelector {
  constructor(sortedValues, distFn) {
    this.sortedValues = sortedValues;
    this.distFn = distFn;
  }

  GetClosestMatch(val, indexDelta) {
    if (!this.sortedValues.length)
      return null;
    let minDist = 0x7FFFFFFF;
    let minObjIndex = 0;
    for (let i = 0; i < this.sortedValues.length; ++i) {
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

// abstraction of the mouse capture + fine behavior
// only operates on 0-1 values.
// onChange(value01, this, is_because_of_user_action)
class ValueSliderElement {
  constructor(params) {
    Object.assign(this, params ?? {});
    this.value01 = this.initialValue01 ?? this.valueSpec.valueToValue01(this.initialValue);
    //console.log(`ValueSliderElement setting initial value ${this.value01}; this.initialValue01=${this.initialValue01}; this.initialValue=${this.initialValue}; valueto01=${this.valueSpec.valueToValue01(this.initialValue)}`);
    this.isDragging = false;
    this.elements.forEach(el => {
      el.style.cursor = "pointer";
      el.onpointerdown = (e) => this.onPointerDown(e);
      el.onpointerup = (e) => this.onPointerUp(e);
      el.ondblclick = (e) => this.onDoubleClick(e);
    });
    this.onChange(this.value01, this, false); // give callers a chance to handle this.
    this.cancelProc = () => {};
  }

  onPointerDown(e) {
    //const el = this.element; //document.getElementById(this.elementID);
    const el = e.target;

    if (e.ctrlKey) {
      this.value01 = this.valueSpec.valueToValue01(this.valueSpec.resetValue);
      this.onChange(this.value01, this, true);
      return;
    }

    this.beginCoordY = e.clientY;
    this.beginValue01 = this.value01;        // backup of original value to support canceling.
    this.trackingBaseValue01 = this.value01; // intermediate value to use during drag
    this.fine = e.shiftKey;

    window.DFKeyTracker.events.on("keydown", this.onKeyDownWhileDragging);
    el.onpointermove = (e) => this.onPointerMove(e);
    this.isDragging = true;
    el.setPointerCapture(e.pointerId);
    this.onChange(this.value01, this, true); // send a change event to allow caller to react to state change.

    this.cancelProc = () => {
      this.isDragging = false;
      el.style.cursor = "pointer";
      el.releasePointerCapture(e.pointerId);
      el.onpointermove = null;
      window.DFKeyTracker.events.removeListener("keydown", this.onKeyDownWhileDragging);
      this.onChange(this.value01, this, true); // send a change event to allow caller to react to state change.
    };
  }

  onPointerUp(e) {
    this.cancelProc();
  }

  onKeyDownWhileDragging = (e) => {
    if (e.key === 'Escape') {
      this.cancelProc();
      this.value01 = this.beginValue01;
      this.onChange(this.value01, this, true);
    }
  }

  onPointerMove(e) {
    if (e.shiftKey != this.fine) {
      // enter or exit fine control.
      this.trackingBaseValue01 = this.value01;
      this.beginCoordY = e.clientY;
      this.fine = e.shiftKey;
    }

    const el = e.target;//this.element; //document.getElementById(this.elementID);
    let delta = this.beginCoordY - e.clientY;
    if (delta) {
      el.style.cursor = "ns-resize";
    }
    this.value01 = this.trackingBaseValue01 + delta * (e.shiftKey ? this.valueSpec.fineMouseSpeed : this.valueSpec.mouseSpeed);

    if (this.value01 < 0)
      this.value01 = 0;
    if (this.value01 > 1)
      this.value01 = 1;
    this.onChange(this.value01, this, true);
  }

  onDoubleClick(e) {
    const el = e.target;//this.element; //document.getElementById(this.elementID);
    this.value01 = this.valueSpec.valueToValue01(this.valueSpec.resetValue);
    this.onChange(this.value01, this, true);
  }
}

module.exports = {
  stylizeRangeInput,
  IsValidJSONString,
  ModifierKeyTracker,
  GestureTracker,
  FuzzySelector,
  ValueSliderElement,
};
