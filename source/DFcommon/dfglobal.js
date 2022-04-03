
// i should really put other stuff here like all of DF.ServerSettings etc.
// thing is that "DFCommon" depends on a lot of stuff.
// but also contains very fundamental things.
// those fundamental things should be broken out into a file like ... this.


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




function sanitizeBPM(bpm) {
  bpm ??= 100;
  bpm = parseFloat(bpm);
  return baseClamp(bpm, 20, 220);
}



module.exports = {
  sanitizeBPM,
};

