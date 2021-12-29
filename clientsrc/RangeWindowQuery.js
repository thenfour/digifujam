const DFU = require('./dfutil');

const eRangeWindowOperator = {
   eq : 1,
   gt : 3,
   gte : 4,
   lt : 5,
   lte : 6,
   between : 7,
   alwaysMatch : 8,
   neverMatch : 9,
}

class RangeWindow {
   constructor(spec) {
      // 0 or =0
      // 1,5
      // >=5
      if (spec.startsWith('>=')) {
         this.lhs = parseInt(spec.substring(2));
         this.op = eRangeWindowOperator.gte;
      } else if (spec.startsWith('>')) {
         this.lhs = parseInt(spec.substring(1));
         this.op = eRangeWindowOperator.gt;
      } else if (spec.startsWith('<=')) {
         this.lhs = parseInt(spec.substring(2));
         this.op = eRangeWindowOperator.lte;
      } else if (spec.startsWith('<')) {
         this.lhs = parseInt(spec.substring(1));
         this.op = eRangeWindowOperator.lt;
      } else if (spec.includes(',')) {
         const operands = spec.split(',');
         console.assert(operands.length === 2, `numeric range window looks like 'between', but doesn't contain exactly 2 operands. ${spec}`);
         this.lhs = parseInt(operands[0]);
         this.rhs = parseInt(operands[1]);
         this.op = eRangeWindowOperator.between;
      } else if (spec.startsWith('=')) {
         this.lhs = parseInt(spec.substring(1));
         this.op = eRangeWindowOperator.eq;
      } else if (spec === '*') {
         this.op = eRangeWindowOperator.alwaysMatch;
      } else if (spec === '!') {
         this.op = eRangeWindowOperator.neverMatch;
      } else {
         this.lhs = parseInt(spec);
         this.op = eRangeWindowOperator.eq;
      }
   }
   IsMatch(x) {
      switch (this.op) {
      case eRangeWindowOperator.eq:
         return x === this.lhs;
      case eRangeWindowOperator.gt:
         return x > this.lhs;
      case eRangeWindowOperator.gte:
         return x >= this.lhs;
      case eRangeWindowOperator.lt:
         return x < this.lhs;
      case eRangeWindowOperator.lte:
         return x <= this.lhs;
      case eRangeWindowOperator.between:
         return (x >= this.lhs) && (x <= this.rhs);
      case eRangeWindowOperator.alwaysMatch:
         return true;
      case eRangeWindowOperator.neverMatch:
         return false;
      }
   }
}

class RangeSpec {
   constructor(spec) {
      // 0|1|2|3|4
      // 1,5|10,15
      // 1|>=5
      this.windows = spec.split('|').map(w => new RangeWindow(w));
   }
   IsMatch(x) {
      return this.windows.some(w => w.IsMatch(x));
   }
}

function DurationTokenToMS(tok, _default) {
   if (!tok) {
      return _default || 0;
   }
   tok = tok.toLowerCase().trim();
   if (tok == '0') {
      return 0;
   }
   const parts = tok.split(/[0-9]+/g);
   console.assert(parts.length === 2); // there should only be 1 numeric "word", so splitting gives 2
                                       // maybe empty strings on either side.

   const num = parseInt(tok);
   const suffix = parts[1].trim();

   if (suffix === 'ms') {
      return num;
   }
   if ([ 's', 'sec', 'second', 'seconds' ].some(s => suffix === s)) {
      return num * 1000;
   }
   if ([ 'm', 'min', 'mins', 'minute', 'minutes' ].some(s => suffix === s)) {
      return num * 1000 * 60;
   }
   if ([ 'h', 'hr', 'hrs', 'hour', 'hours' ].some(s => suffix === s)) {
      return num * 1000 * 60 * 60;
   }
   if ([ 'd', 'day', 'days' ].some(s => suffix === s)) {
      return num * 1000 * 60 * 60 * 24;
   }

   throw new Error(`Suffix unknown on time duration token ${tok}`);
}

function DurationSpecToMS(str, _default)
{
   if (!str) {
      return _default || 0;
   }
   const tokens = str.split(' ').filter(s => s.length > 0);
   return tokens.reduce((a,b) => a + DurationTokenToMS(b), 0);
}

const eRangeMatchType = {
   Touch : 1,
   Maintain : 2,
   Sum : 3,
};

class RangeDurationQuery {
   constructor(spec) {
      this.spec = spec;
      // 'triggerOnUserCount': 'maintains [0,2] during [15 s]',
      // 'conditionOnUserCount': 'touches [>5] during [1 h]',
      const m = spec.match(/(\w+?)\s+\[(.*?)\]\s+during\s+\[(.*?)\]/);
      console.assert(m?.length === 4, `Spec '${spec}' doesn't appear to match the form 'match_type[range] during [duration] where match_type is maintains or touches'`);
      // 0 is whole match
      // 1 = match type
      // 2 = range spec
      // 3 = duration spec
      const matchTypeStr = m[1].trim();
      if (matchTypeStr == 'touches') {
         this.matchType = eRangeMatchType.Touch;
      } else if (matchTypeStr == 'maintains') {
         this.matchType = eRangeMatchType.Maintain;
      } else if (matchTypeStr == 'sum') {
         this.matchType = eRangeMatchType.Sum;
      } else {
         throw new Error(`Unknown match type '${matchTypeStr}' in spec ${spec}`);
      }

      this.range = new RangeSpec(m[2]);
      this.durationMS = DurationSpecToMS(m[3]);
   }
}

class LiveTimeProvider {
   constructor() {
      //this.baseTime = Date.now();
   }
   nowMS() {
      return Date.now(); // - this.baseTime;
   }
}

class StaticTimeProvider {
   constructor(staticTimeMS) {
      this.staticTimeMS = staticTimeMS;
   }
   nowMS() {
      return this.staticTimeMS;
   }
}

////////////////////////////////////////////////////////////////////////////////////////////////
// tracks a sampled signal value over time
class SampledSignalDataSource {
   constructor(initialValue, maxAgeMS, timeProvider) {
      this.maxAgeMS = maxAgeMS || (1000 * 60 * 60 * 24);

      // { value, time} --- MUST BE SORTED BY TIME for optimization.
      // the first item's time should be *treated* as 0, to fill before we tracked data.
      this.events = [ {
         value : initialValue,
         time : 0
      } ];
      this.timeProvider = timeProvider || new LiveTimeProvider();
   }
   Dump() {
      console.log(JSON.stringify(this.events, null, 2));
   }

   GetDebugData() {
      return {
         binSizeMS : this.binSizeMS,
         type : 'SampledSignalDataSource',
         events : this.events,
      };
   }

   PruneEvents() {
      const boundaryTime = this.timeProvider.nowMS() - this.maxAgeMS;
      let iFirstItemToKeep = this.events.findIndex(e => e.time >= boundaryTime);
      if (iFirstItemToKeep === -1) {
         // let's keep at least 1 item
         this.events = [ this.events.at(-1) ];
         return;
      }

      this.events = this.events.slice(iFirstItemToKeep);
   }
   AddEvent(value, time) {
      time = (time === undefined) ? this.timeProvider.nowMS() : time;
      console.assert(!this.events.length || this.events.at(-1).time <= time, `Events must be added in chronological order.`);
      this.events.push({value, time});
      this.PruneEvents();
   }
   // return an array of events which correspond to a window of time (since now)
   // the window should also include the latest known value before the window,
   // to build a complete picture of the activity in this window.
   GetEventWindow(durationMS) {
      let boundaryTime = this.timeProvider.nowMS() - durationMS;
      let iFirstItemToKeep = this.events.findIndex(e => e.time >= boundaryTime);
      if (iFirstItemToKeep === -1) {
         // nothing matches; return the latest value which we assume fills this whole window.
         return [ this.events.at(-1) ];
      }
      if (iFirstItemToKeep === 0) {
         // return everything.
         return this.events.slice();
      }
      // include the previous item.
      return this.events.slice(iFirstItemToKeep - 1);
   }
   IsMatch(query, tag, verboseDebugLogging) {
      let events = this.GetEventWindow(query.durationMS);

      if (verboseDebugLogging) {
         console.log(`${tag} IsMatch with query ${query.spec} with event window ${'{'}`);
         events.forEach(e => {
            const age = Date.now() - e.time;
            console.log(`  [val=${e.value}, age = ${DFU.FormatTimeMS(age)} ]`);
         });
      }

      let isMatch = false;
      switch (query.matchType) {
      case eRangeMatchType.Touch:
         isMatch = events.some(e => query.range.IsMatch(e.value));
         break;
      case eRangeMatchType.Maintain:
         isMatch = events.every(e => query.range.IsMatch(e.value));
         break;
      default:
         throw new Error(`Unsupported range match type ${query.matchType}`);
      }

      if (verboseDebugLogging) {
         console.log(`  -> ${isMatch ? "MATCH" : "no match."}`);
         console.log('}');
      }
      return isMatch;
   };
};

////////////////////////////////////////////////////////////////////////////////////////////////
// used for keeping stats about impulses/events (note ons) over time.
class HistogramDataSource {
   constructor(binSizeMS, maxAgeMS, timeProvider) {
      this.maxAgeMS = maxAgeMS || (1000 * 60 * 60 * 24);
      this.binSizeMS = binSizeMS || 60000; // default 1 minute bins ()
      this.timeProvider = timeProvider || new LiveTimeProvider();

      const maxBinCount = this.maxAgeMS / this.binSizeMS;
      console.log(`Max bin count is ${maxBinCount}`);
      if (maxBinCount > 100000) {
         throw new Error(`  -> that's too much.`);
      }

      this.events = [];
   }

   GetDebugData() {
      // do a few preprocess things:
      // - add empty missing bins to complete the set.
      // - bake age from now into the data
      // - calculate the SUM of bins to now
      const nowMS = Date.now();
      let bins = this.events.map(e => { // create a completely new copy of events
         return {
            value: e.value,
            binID: e.binID,
            binEndTimeMS: e.binEndTimeMS,
         };
      });

      return {
         type : 'HistogramDataSource',
         binSizeMS : this.binSizeMS,
         bins,
      };
   }

   ConstructBinWithID(binID, props) {
      return Object.assign({
         value : 0,
         binID : binID,
         binEndTimeMS : (binID + 1) * this.binSizeMS,
      }, props);
   }

   Prune() {
      const boundaryTime = this.timeProvider.nowMS() - this.maxAgeMS;
      let iFirstItemToKeep = this.events.findIndex(e => e.binEndTimeMS >= boundaryTime);
      if (iFirstItemToKeep === -1) {
         // let's keep at least 1 item
         this.events = [ this.events.at(-1) ];
         return;
      }

      this.events = this.events.slice(iFirstItemToKeep);
   }

   AddEvent(value) {
      const timeMS = this.timeProvider.nowMS();
      console.assert(!this.events.length || this.events.at(-1).lastSampleTimeMS <= timeMS, `Events must be added in chronological order.`);

      // calculate a bin id
      const binID = Math.floor(timeMS / this.binSizeMS);
      let latestBin = null;
      if (this.events.length) {
         latestBin = this.events.at(-1);
         if (latestBin.binID === binID) {
            latestBin.value += value;
            latestBin.lastSampleTimeMS = timeMS;
            return;
         }
      }

      const newBin = this.ConstructBinWithID(binID, {
         value: value,
         lastSampleTimeMS: timeMS,
      });

      if (latestBin?.value === 0) {
         // latest was an empty bin; just replace it because it was worthless.
         this.events[this.events.length - 1] = newBin;
      } else {
         this.events.push(newBin);
      }

      this.Prune();
   }

   // return an array of events which correspond to a window of time (since now)
   // any bins which touch the window are returned.
   GetBinsInWindow(durationMS) {
      let boundaryTimeMS = this.timeProvider.nowMS() - durationMS;
      // find the first bin that is partially within the window.
      let iFirstItemToKeep = this.events.findIndex(e => e.binEndTimeMS >= boundaryTimeMS);
      if (iFirstItemToKeep === -1) {
         return [];// no data in window.
      }
      return this.events.slice(iFirstItemToKeep);
   }

   GetSumForDurationMS(ms) {
      let events = this.GetBinsInWindow(ms);
      const sum = events.reduce((acc, e) => acc + e.value, 0);
      return sum;
   }

   IsMatch(query, tag, verboseDebugLogging) {
      this.AddEvent(0); // ensure a bin exists for "now"
      let events = this.GetBinsInWindow(query.durationMS);

      if (verboseDebugLogging) {
         console.log(`${tag} IsMatch with query ${query.spec} with event window ${'{'}`);
         events.forEach(e => {
            const endAge = Date.now() - e.binEndTimeMS;
            console.log(`  [id=${e.binID} val=${e.value}, age = ${DFU.FormatTimeMS(endAge)} ]`);
         });
      }

      let isMatch = false;
      switch (query.matchType) {
      case eRangeMatchType.Touch:
         isMatch = events.some(e => query.range.IsMatch(e.value));
         break;
      case eRangeMatchType.Maintain:
         isMatch = events.every(e => query.range.IsMatch(e.value));
         break;
      case eRangeMatchType.Sum:
         const sum = events.reduce((acc, e) => acc + e.value, 0);
         isMatch = query.range.IsMatch(sum);
         break;
      default:
         throw new Error(`Unsupported range match type ${query.matchType}`);
      }

      if (verboseDebugLogging) {
         console.log(`  -> ${isMatch ? "MATCH" : "no match."}`);
         console.log('}');
      }

      return isMatch;
   };
};

////////////////////////////////////////////////////////////////////////////////////////////////

function TestBinProvider() {
   let tp = new StaticTimeProvider(0);
   let ds = new HistogramDataSource(1000, 9000, tp);

   // virtual history.
   console.assert(ds.IsMatch(new RangeDurationQuery('maintains [0] during [300 hr]')));

   ds.AddEvent(10);
   tp.staticTimeMS = 900;
   ds.AddEvent(2); // bin 0 should now have 12 and represent between 0-1 sec
   tp.staticTimeMS = 1050;
   ds.AddEvent(3); // and bin 1 should have 3 and represent between 1-2 sec

   tp.staticTimeMS = 2010;

   console.assert(!ds.IsMatch(new RangeDurationQuery('maintains [0] during [300 hr]')));
   console.assert(!ds.IsMatch(new RangeDurationQuery('maintains [3] during [1 sec]'))); // won't match because bin boundaries are set to when the first bin sample was taken, not bin theoretical boundary.

   tp.staticTimeMS = 3000;
   console.assert(ds.IsMatch(new RangeDurationQuery('maintains [3] during [1 sec]')));
   console.assert(ds.IsMatch(new RangeDurationQuery('maintains [3,12] during [2 sec]')));
   console.assert(!ds.IsMatch(new RangeDurationQuery('maintains [<3|>12] during [2 sec]')));

   console.assert(!ds.IsMatch(new RangeDurationQuery('maintains [3,12] during [3 sec]')));
}

function RunTests() {

   let r = new RangeSpec('5');
   console.assert(!r.IsMatch(4));
   console.assert(r.IsMatch(5));
   console.assert(!r.IsMatch(6));

   r = new RangeSpec('>5');
   console.assert(!r.IsMatch(4));
   console.assert(!r.IsMatch(5));
   console.assert(r.IsMatch(6));

   r = new RangeSpec('>=5');
   console.assert(!r.IsMatch(4));
   console.assert(r.IsMatch(5));
   console.assert(r.IsMatch(6));

   r = new RangeSpec('<5');
   console.assert(r.IsMatch(4));
   console.assert(!r.IsMatch(5));
   console.assert(!r.IsMatch(6));

   r = new RangeSpec('<=5');
   console.assert(r.IsMatch(4));
   console.assert(r.IsMatch(5));
   console.assert(!r.IsMatch(6));

   r = new RangeSpec('=5');
   console.assert(!r.IsMatch(4));
   console.assert(r.IsMatch(5));
   console.assert(!r.IsMatch(6));

   r = new RangeSpec('5,6');
   console.assert(!r.IsMatch(4));
   console.assert(r.IsMatch(5));
   console.assert(r.IsMatch(6));
   console.assert(!r.IsMatch(7));

   r = new RangeSpec('5,6|8,9');
   console.assert(!r.IsMatch(4));
   console.assert(r.IsMatch(5));
   console.assert(r.IsMatch(6));
   console.assert(!r.IsMatch(7));
   console.assert(r.IsMatch(8));
   console.assert(r.IsMatch(9));
   console.assert(!r.IsMatch(10));

   console.assert(DurationSpecToMS('1s') === 1000);
   console.assert(DurationSpecToMS(' 10 s ') === 10000);
   console.assert(DurationSpecToMS(' 10 ms ') === 10);
   console.assert(DurationSpecToMS(' 999 sec ') === 999000);

   let tp = new StaticTimeProvider(10000);

   let ds = new SampledSignalDataSource(0, 9000, tp);
   ds.AddEvent(0, 0);

   let q = new RangeDurationQuery('maintains [0] during [3 s]');
   console.assert(ds.IsMatch(q));

   q = new RangeDurationQuery('maintains [1] during [10 s]');
   console.assert(!ds.IsMatch(q));

   ds.AddEvent(0, 1500);
   ds.AddEvent(1, 8500);

   q = new RangeDurationQuery('maintains [1] during [10 s]');
   console.assert(!ds.IsMatch(q));

   q = new RangeDurationQuery('maintains [1] during [5 s]');
   console.assert(!ds.IsMatch(q));

   q = new RangeDurationQuery('maintains [1] during [1 s]');
   console.assert(ds.IsMatch(q));

   q = new RangeDurationQuery('touches [1] during [10 s]');
   console.assert(ds.IsMatch(q));

   q = new RangeDurationQuery('touches [1] during [1 s]');
   console.assert(ds.IsMatch(q));

   q = new RangeDurationQuery('touches [1] during [0 s]');
   console.assert(ds.IsMatch(q));

   q = new RangeDurationQuery('maintains [1] during [0 s]');
   console.assert(ds.IsMatch(q));

   q = new RangeDurationQuery('maintains [0] during [0 s]');
   console.assert(!ds.IsMatch(q));

   tp.staticTimeMS += 4000;

   q = new RangeDurationQuery('maintains [1] during [5 s]');
   console.assert(ds.IsMatch(q));

   TestBinProvider();
}

module.exports = {
   eRangeWindowOperator,
   RangeWindow,
   RangeSpec,
   DurationSpecToMS,
   eRangeMatchType,
   RangeDurationQuery,
   SampledSignalDataSource,
   HistogramDataSource,
   RunTests,
};
