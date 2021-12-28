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

const DurationSpecToMS =
    (spec, _default) => {
       // by replacing numeric strings with an asterisk, i should always get a
       // string like, *ms, where the suffix is at the end, and there's exactly 1
       // asterisk. it's a quick&dirty way to check syntax,
       if (!spec) {
          return _default || 0;
       }
       spec = spec.toLowerCase().trim();
       if (spec == '0') {
          return 0;
       }
       const parts = spec.split(/[0-9]+/g);
       console.assert(parts.length === 2); // there should only be 1 numeric "word", so splitting gives 2
                                           // maybe empty strings on either side.

       const num = parseInt(spec);
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

       throw new Error(`Suffix unknown on time duration spec ${spec}`);
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
// does not slice or dice data in any way.
class SimpleValueArrayDataSource {
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
   IsMatch(query) {
      // query.durationMS
      // query.matchType = eRangeMatchType.Touch or Maintain
      // query.range
      let events = this.GetEventWindow(query.durationMS);

      // console.log('IsMatch with event window {');
      // events.forEach(e => {
      //    console.log(`  [@ ${e.time} = ${e.value}]`);
      // });
      // console.log('}');

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
      return isMatch;
   };
};

////////////////////////////////////////////////////////////////////////////////////////////////
// does not slice or dice data in any way.
class PartitionedValueDataSource {
   constructor(initialValue, partitionSizeMS, maxAgeMS, timeProvider, reduceFn) {
      this.maxAgeMS = maxAgeMS || (1000 * 60 * 60 * 24);
      this.partitionSizeMS = partitionSizeMS || 60000; // default 1 minute partitions ()
      this.reduceFn = reduceFn;
      this.timeProvider = timeProvider || new LiveTimeProvider();

      console.assert(reduceFn, `you must specify a way to aggregate/accumulate/reduce values into partitions.`);

      const maxPartitionCount = this.maxAgeMS / this.partitionSizeMS;
      console.log(`Max partition count is ${maxPartitionCount}`);
      if (maxPartitionCount > 100000) {
         throw new Error(`  -> that's too much.`);
      }

      // { partitionID, partitionStartTimeMS, partitionEndTimeMS, accumulator } --- MUST BE SORTED BY TIME for optimization.
      const now = this.timeProvider.nowMS();
      const partitionID = Math.floor(now / this.partitionSizeMS);
      this.events = [ {
         accumulator : initialValue,
         partitionID,
         partitionStartTimeMS : partitionID * this.partitionSizeMS, // NB: don't try to be clever with boundaries: it doesn't really add anything except confusion when things don't behave like you expected.
         partitionEndTimeMS : (partitionID + 1) * this.partitionSizeMS,
         lastSampleTimeMS : partitionID * this.partitionSizeMS,
      } ];
   }
   Prune() {
      const boundaryTime = this.timeProvider.nowMS() - this.maxAgeMS;
      let iFirstItemToKeep = this.events.findIndex(e => e.partitionStartTimeMS >= boundaryTime);
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

      // calculate a partition id
      const partitionID = Math.floor(timeMS / this.partitionSizeMS);
      const latestPartition = this.events.at(-1);
      if (latestPartition.partitionID === partitionID) {
         latestPartition.accumulator = this.reduceFn(latestPartition.accumulator, value);
         latestPartition.lastSampleTimeMS = timeMS;
         return;
      }

      this.events.push({
         accumulator : value,
         partitionID : partitionID,
         partitionStartTimeMS : partitionID * this.partitionSizeMS,
         partitionEndTimeMS : (partitionID + 1) * this.partitionSizeMS,
         lastSampleTimeMS : timeMS,
      });

      this.Prune();
   }
   // return an array of events which correspond to a window of time (since now)
   GetPartitionsInWindow(durationMS) {
      let boundaryTimeMS = this.timeProvider.nowMS() - durationMS;
      // find the first partition that is fully within the window. later we always add 1 extra to fill
      // initial state, so don't pick partial windows; that's done naturally later.
      let iFirstItemToKeep = this.events.findIndex(e => e.partitionStartTimeMS >= boundaryTimeMS);
      if (iFirstItemToKeep === -1) {
         // nothing matches; return the latest value which we assume fills this whole window.
         return [ this.events.at(-1) ];
      }
      if (iFirstItemToKeep === 0) {
         // return everything.
         return this.events.slice();
      }

      // include previous to backfill.
      return this.events.slice(iFirstItemToKeep - 1);
   }

   GetSumForDurationMS(ms) {
      let events = this.GetPartitionsInWindow(ms);
      const sum = events.reduce((acc, e) => acc + e.accumulator, 0);
      return sum;
   }

   IsMatch(query, tag, verboseDebugLogging) {
      let events = this.GetPartitionsInWindow(query.durationMS);

      if (verboseDebugLogging) {
         console.log(`${tag} IsMatch with query ${query.spec} with event window ${'{'}`);
         events.forEach(e => {
            const startAge = Date.now() - e.partitionStartTimeMS;
            const endAge = Date.now() - e.partitionEndTimeMS;
            console.log(`  [id=${e.partitionID} val=${e.accumulator}, age = ${DFU.FormatTimeMS(endAge)} - ${DFU.FormatTimeMS(startAge)} ]`);
         });
      }

      let isMatch = false;
      switch (query.matchType) {
      case eRangeMatchType.Touch:
         isMatch = events.some(e => query.range.IsMatch(e.accumulator));
         break;
      case eRangeMatchType.Maintain:
         isMatch = events.every(e => query.range.IsMatch(e.accumulator));
         break;
      case eRangeMatchType.Sum:
         const sum = events.reduce((acc, e) => acc + e.accumulator, 0);
         //console.log(` sum = ${sum}`);
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

function TestPartitionProvider() {
   let tp = new StaticTimeProvider(0);
   let ds = new PartitionedValueDataSource(0, 1000, 9000, tp, (a, b) => a + b);

   // virtual history.
   console.assert(ds.IsMatch(new RangeDurationQuery('maintains [0] during [300 hr]')));

   ds.AddEvent(10);
   tp.staticTimeMS = 900;
   ds.AddEvent(2); // partition 0 should now have 12 and represent between 0-1 sec
   tp.staticTimeMS = 1050;
   ds.AddEvent(3); // and partition 1 should have 3 and represent between 1-2 sec

   tp.staticTimeMS = 2010;

   console.assert(!ds.IsMatch(new RangeDurationQuery('maintains [0] during [300 hr]')));
   console.assert(!ds.IsMatch(new RangeDurationQuery('maintains [3] during [1 sec]'))); // won't match because partition boundaries are set to when the first partition sample was taken, not partition theoretical boundary.

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

   let ds = new SimpleValueArrayDataSource(0, 9000, tp);
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

   TestPartitionProvider();
}

module.exports = {
   eRangeWindowOperator,
   RangeWindow,
   RangeSpec,
   DurationSpecToMS,
   eRangeMatchType,
   RangeDurationQuery,
   SimpleValueArrayDataSource,
   PartitionedValueDataSource,
   RunTests,
};
