/*
imports audio & json to a format the server can easily serve up.
samples are converted to m4a and brought into the same dir as the sfz.
*/
const fs = require('fs');
const parseSFZ = require('./clientsrc/sfzParser');
const wav = require('node-wav');
const exec = require('child_process').exec

function GetLeaf(path) {
  if (!path.includes("\\")) return path;
  return path.substring(path.lastIndexOf("\\") + 1);
};

function RemoveExtension(path) {
  if (!path.includes(".")) return path;
  return path.substring(0, path.lastIndexOf("."));
};

// requires the ORIGINAL r.sample opcode
function GetDestSamplePath(r) {
  let leaf = GetLeaf(r.sample.replace(/\//g, "\\").replace(/#/g,"sharp"));
  if ('end' in r) {
    return outputDir + `${RemoveExtension(leaf)}_${r.offset}_${r.end - r.offset}.wav`;
  }
  return outputDir + `${RemoveExtension(leaf)}_${r.offset}_end.wav`;
};

function RemoveQuotes(s) {
  return s.replace(/\"/g, "\\");
}
function EnsureWindowsPathSeparators(s) {
  return s.replace(/\//g, "\\");
}



////////////////////////////////////////////////////////////////////////////////////////////////////
// MAIN

console.log(`----------------------------------`);
console.log(`7jam Serverside SFZ Importer`);
console.log(``);

const errorMessages = [];

// find the sfz arg.
let sfzpath = null;
let outputDir = null;
process.argv.forEach(arg => {
  if (arg.toLowerCase().startsWith("sfzpath=")) {
    sfzpath = arg.substring("sfzpath=".length);
  }
  if (arg.toLowerCase().startsWith("outputdir=")) {
    outputDir = arg.substring("outputdir=".length);
  }
});

if (!sfzpath) {
  throw new Error(`no sfzpath= specified in arguments.`);
}
sfzpath = RemoveQuotes(sfzpath);
if (!sfzpath.includes(":")) {
  throw new Error(`Path must be rooted: ${sfzpath}`);
}

console.log(`Input SFZ:`);
console.log(`  ${sfzpath}`);
console.log(``);

if (!outputDir) {
  //throw new Error(`no outputdir= specified in arguments.`);
  // generate an output dir based on the input dir.
  outputDir = __dirname + "/public/sfz/" + RemoveExtension(GetLeaf(sfzpath));
  //console.log(`Generated output dir: ${outputDir}`);
}
outputDir = RemoveQuotes(outputDir);
if (!outputDir.includes(":")) {
  throw new Error(`Path must be rooted: ${outputDir}`);
}

outputDir = EnsureWindowsPathSeparators(outputDir);

if (!outputDir.endsWith("\\")) { // ensure outputdir ends with backslash so relative paths can be appended.
  outputDir += "\\";
}

console.log(`Output:`);
console.log(`  ${sfzpath}`);
console.log(``);

if (fs.existsSync(outputDir)) {
  console.log(`Output directory already exists.`);
} else {
  console.log(`Creating output directory.`);
  fs.mkdirSync(outputDir);
}

const old_console_log = console.log;
const gLogPath = outputDir + "00import_log.txt";
console.log = (msg) => {
  fs.appendFileSync(gLogPath, msg + "\r\n");
  old_console_log(msg);
};

const sfzPathStem = sfzpath.substring(sfzpath.lastIndexOf("\\") + 1);
let outputJSONPath = outputDir + sfzPathStem + ".json";
console.log(`Output JSON will be @: ${outputJSONPath}`);

////////////////////////////////////////////////////////////////////////////////////////////////////
// PARSE the original SFZ
const parsed = parseSFZ(fs.readFileSync(sfzpath, "utf8"));

// transform it a bit:
// - bake global opcodes to regions (effectively getting rid of the need for <global>)
// - calculate absolute URL to samples
const sfzRegions = [];
const srcSamples = {}; // key=original path
const destSamples = {}; // all the different permutations of sample+offset+length, keyed by full path, value=one region from sfzRegions which describes this sample.

let globalOpcodes = {};
if (parsed.global) {
  if (parsed.global.length > 1) {
    throw new Error(`sfz format not supported: multiple <global> headers for inst ${i.instrumentID}`);
  }
  globalOpcodes = parsed.global[0];
}

let pathBase = "";
if (parsed.control) {
  // <control>
  // default_path=../
  if (parsed.control.length > 1) {
    throw new Error(`sfz format not supported: multiple <control> headers for inst ${i.instrumentID}`);
  }
  if (parsed.control[0].default_path) {
    pathBase = parsed.control[0].default_path;
  }
}

// pathbase is relative to the .sfz
let rootedPath = sfzpath.substring(0, sfzpath.lastIndexOf("\\") + 1); // remove the inst.sfz filename to make relative paths
rootedPath += EnsureWindowsPathSeparators(pathBase);

// there are some global opcodes which want to be ADDED to group/region opcodes.
// remove them from the globalOpcodes struct and put them here for later dealin
globalAddOpcodes = {};
if ('global_volume' in globalOpcodes) {
  globalAddOpcodes.volume = parseFloat(globalOpcodes.global_volume);// global_volume => volume
  delete globalOpcodes.global_volume;
}
if ('global_tune' in globalOpcodes) {
  globalAddOpcodes.tune = parseFloat(globalOpcodes.global_tune);// global_tune => tune
  delete globalOpcodes.global_tune;
}

// Process all regions...
parsed.region.forEach(region => {
  // calculate the sample URL to load
  // first bring in global opcodes + region opcodes
  let r = {};

  r = Object.assign({}, globalOpcodes);
  r = Object.assign(r, region);
  if (!r.sample) {
    throw new Error(`no sample file defined for region of ${i.instrumentID}`);
  }
  if (!r.offset) r.offset = 0; // guarantee this one. 'end' is not guaranteed.

  // deal with globalAddOpcodes
  if ('volume' in globalAddOpcodes) {
    if ('volume' in r) {
      r.volume = parseFloat(r.volume) + globalAddOpcodes.volume;
    } else {
      r.volume = globalAddOpcodes.volume;
    }
  }

  if ('tune' in globalAddOpcodes) {
    if ('tune' in r) {
      r.tune = parseFloat(r.tune) + globalAddOpcodes.tune;
    } else {
      r.tune = globalAddOpcodes.tune;
    }
  }

  const CalcAbsSamplePath = () => {
    let s = r.sample.replace(/\//g, "\\"); // use backslashes on windows.
    let ret = rootedPath + s;
    return ret.replace(/\\\\/g, "\\"); // if rootedpath ends in slash and s begins with slash, collapse them.
  };

  r.srcSamplePath = CalcAbsSamplePath();//rootedPath + r.sample; // full path to the full source sample

  r.destWavPath = GetDestSamplePath(r);
  r.destM4APath = RemoveExtension(r.destWavPath) + ".m4a";
  r.sample = GetLeaf(r.destM4APath); // during import we will bring samples into the same dir as the json, so just use leaf.

  srcSamples[r.srcSamplePath] = {
    WAVPath: r.srcSamplePath,
    wavData: null,
  };

  if (!r.srcSamplePath.toLowerCase().endsWith(".wav")) {
    srcSamples[r.srcSamplePath].WAVPath = outputDir + `${GetLeaf(r.srcSamplePath)}.wav`;
  }

  destSamples[r.destWavPath] = r;
  sfzRegions.push(r);
});

// we now have everything we need to proceed.
console.log(`Region count: ${sfzRegions.length}`);
console.log(`Source samples to read: ${Object.keys(srcSamples).length}`);
console.log(`Dest samples to create: ${Object.keys(destSamples).length}`);

const conversionPromises = [];

// convert & load source WAV files.
Object.keys(srcSamples).forEach(originalPath => {

  const workWithWAVSource = (resolve, originalPath, WAVPath, shouldDeleteWAV) => {
    console.log(`Loading ${WAVPath}`);

    let buffer = fs.readFileSync(WAVPath);
    let sourceWav = wav.decode(buffer);
    console.log(`  Samplerate: ${sourceWav.sampleRate}`);
    console.log(`  Channels: ${sourceWav.channelData.length}`);
    console.assert(sourceWav.channelData.length > 0);

    srcSamples[originalPath] = sourceWav;

    // get min/max sample offsets for this src sample for fun.
    // search offset and end
    let extents = sfzRegions.filter(r => originalPath === r.srcSamplePath) // only care about regions using this src sample
      .map(r => { // extract lo & hi sample positions
        return {
          lo: r.offset,
          hi: (('end' in r) ? (r.offset + r.end) : r.offset),
        };
      })
      .reduce((a, b) => { // aggregate.
        return {
          lo: Math.min(a.lo, b.lo),
          hi: Math.max(a.hi, b.lo),
        }
      });

    console.log(`  Length in samples: ${sourceWav.channelData[0].length}`);
    console.log(`  Min offset       : ${extents.lo}`);
    console.log(`  Max offset       : ${extents.hi}`);
    console.log(`  Reflen in samples: ${extents.hi - extents.lo}`);
    // could also show overlaps -- basically redundant data we're about to export

    // find all output wav samples which reference this one.
    const splitSamplePromises = [];
    Object.keys(destSamples).forEach(destWavPath => {
      const r = destSamples[destWavPath];
      let smallerChannelData = null;
      if (r.srcSamplePath !== originalPath) return;
      if ('end' in r) {
        console.log(`  > Creating ${GetLeaf(destWavPath)} from ${GetLeaf(originalPath)} [${r.offset}-${r.end}]`);
        smallerChannelData = sourceWav.channelData.map(ch => ch.subarray(r.offset, r.end + 1)); // SFZ end is inclusive.
      } else {
        console.log(`  > Creating ${GetLeaf(destWavPath)} from ${GetLeaf(originalPath)} [${r.offset}-end]`);
        smallerChannelData = sourceWav.channelData.map(ch => ch.subarray(r.offset));
      }

      // create this wav.
      let encodedOutput = wav.encode(smallerChannelData, { sampleRate: sourceWav.sampleRate });
      fs.writeFileSync(destWavPath, encodedOutput);

      // convert to m4a and mp3
      const cmdline = `ffmpeg -y -i \"${r.destWavPath}\" \"${r.destM4APath}\"`; // -y to overwrite outfiles; quiet mode.
      console.log(`Exec to conv to m4a: ${cmdline}`);
      splitSamplePromises.push(new Promise(resolveSplit => {
        exec(cmdline, (err, stdout, stderr) => {
          //console.log(`${stdout} ${err} ${stderr}`);
          console.log(`Deleting/unlinking ${r.destWavPath}`);
          fs.unlinkSync(r.destWavPath);
          resolveSplit();
        });
      }));
    }); // for each splitted sample

    // resolve when all splitted samples finish.
    Promise.allSettled(splitSamplePromises).then(() => {
      if (shouldDeleteWAV) {
        console.log(`Deleting/unlinking ${WAVPath}`);
        fs.unlinkSync(WAVPath);
      }
      resolve();
    });

  }; // workWithWAVSource()

  // if the sample needs conversion, convert it. otherwise just process.
  const s = srcSamples[originalPath];
  conversionPromises.push(new Promise(resolve => {
    if (originalPath === s.WAVPath) {
      workWithWAVSource(resolve, originalPath, s.WAVPath);
    } else {
      const cmdline = `ffmpeg -y -i \"${originalPath}\" \"${s.WAVPath}\"`; // -y to overwrite outfiles; quiet mode.
      console.log(`Exec to conv to WAV: ${cmdline}`);
      exec(cmdline, (err, stdout, stderr) => {
        //console.log(`${stdout} ${err} ${stderr}`);
        workWithWAVSource(resolve, originalPath, s.WAVPath, true);
      });
    }
  }));

}); // for each source sample.


// wait for the above to complete.
Promise.allSettled(conversionPromises).then(() => {
  console.log(`Completed processing source WAV files with ${conversionPromises.length} conversions.`);

  let cutoffMin = null;
  let cutoffMax = null;

  const unsupportedOpcodes = [
    "region_label",
  ];
  const errorOpcodes = [
    "ampeg_delay",
    "loop_crossfade",
  ];
  const floatOpcodes = [
    "ampeg_attack",
    "ampeg_delay",
    "ampeg_decay",
    "ampeg_hold",
    "ampeg_release",
    "ampeg_start",
    "ampeg_sustain",
    "volume",
    "pan",
    "tune",
    "cutoff",
    "resonance",
  ];
  const intOpcodes = [
    "pitch_keycenter",
    "group",
    "off_by",
  ];
  const renameOpcodes = {
    "polyphony_group": "group",
    "pitch": "tune",
  };

  sfzRegions.forEach(r => {
    // correct sample offsets. Web Audio wants loop points specified in seconds so just perform the calculation here.
    const sampleRate = srcSamples[r.srcSamplePath].sampleRate;

    // loopstart / loop_start
    if ('loopstart' in r) {
      r.loop_start = r.loopstart;
      delete r.loopstart;
    }
    if ('loop_start' in r) {
      if (parseInt(r.loop_start) < parseInt(r.offset)) {
        throw new Error(`Loop starts before the sample offset...`);
      }
      r.loop_start = (parseInt(r.loop_start) - parseInt(r.offset)) / sampleRate;
    }

    // loopend / loop_end
    if ('loopend' in r) {
      r.loop_end = r.loopend;
      delete r.loopend;
    }
    if ('loop_end' in r) {
      if (parseInt(r.loop_end) < parseInt(r.offset)) {
        throw new Error(`Loop ends before the sample offset...`);
      }
      r.loop_end = (parseInt(r.loop_end) - parseInt(r.offset)) / sampleRate;
    }

    delete r.offset;// = 0;
    delete r.end;

    // remove temp properties from regions.
    delete r.srcSamplePath;
    delete r.destWavPath;
    delete r.destM4APath;

    // rename opcodes to be consistent.
    Object.keys(r).forEach(k => {
      if (k in renameOpcodes) {
        r[renameOpcodes[k]] = r[k];
        delete r[k];
      }
    });

    // remove more ignored/unsupported opcodes.
    unsupportedOpcodes.forEach(k => {
      delete r[k];
    });

    // convert values
    floatOpcodes.forEach(k => {
      if (k in r) r[k] = parseFloat(r[k]);
    });
    intOpcodes.forEach(k => {
      if (k in r) r[k] = parseInt(r[k]);
    });
    errorOpcodes.forEach(k => {
      if (k in r) errorMessages.push(`Error: opcode ${k} is going to cause issues.`);
    });

  }); // for each region

  fs.writeFileSync(outputJSONPath, JSON.stringify(sfzRegions, null, 2), "utf8");

  errorMessages.forEach(m => console.log(m));

  // generate a sample instrumentspec...
  console.log(`Import complete.`);

  // a lot of sfz instruments have some oddball filter cutoff frequency range. alert to that.
  let filtCutoffMul = null;
  if (cutoffMin !== null && cutoffMax !== null) {
    filtCutoffMul = 22050 / cutoffMax;
    console.log(`Filter cutoff range [${cutoffMin}-${cutoffMax}]`);
    //console.log(`${filtCutoffMul}`);
  }
  const pubDir = (__dirname + "\\public").toLowerCase();
  if (outputJSONPath.toLowerCase().startsWith(pubDir)) {
    console.log(`Sample JSON instrument spec:`);
    const sampleSpec = {
      "instrumentID": "sfz_" + RemoveExtension(GetLeaf(sfzpath)).replace(/\W/g, ''),
      "copyOfInstrumentID": "sfz",
      "sfzURL": outputJSONPath.substr(pubDir.length).replace(/\\/g, "/"),
      "name": RemoveExtension(GetLeaf(sfzpath)),
    };
    if (filtCutoffMul !== null) {
      sampleSpec.filtCutoffMul = filtCutoffMul;
    }

    console.log(JSON.stringify(sampleSpec, null, 2));
  }


}); // wait for conversions to complete.



