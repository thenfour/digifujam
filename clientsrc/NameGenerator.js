








const gAdj = [
   'groovy',
   'funky',
   'lucid',
   'rockabilly',
   'ambient',
   'ska',
   'jazzy',
   'fortunate',
   'cute',
   'defiant',
   'microtonal',
   'fusion',
   'digital',
   'analog',
   'smart',
   'green-eyed',
   'digifu',
   'diminished',
   'augmented',
   'quartal',
   'experimental',
   'punchy',
   'poppy',
   'dizzy',
   'elegant',
   'fuzzy',
   'acclaimed',
   'debut',
   'radiant',
   'squirrely',
   'low-carb',
   'rusty',
   'newfangled',
   'prickly',
   'genuine',
   'acoustic',
   'out-of-tune',
   'rackmounted',
   'floppy',
   'oscillating',
   'low pass',
   'band pass',
   'high pass',
   'ducking',
   'rattling',
   'kpop',
   'untitled',
   'noisy',
   '4-track',
];

const gNouns = [
   ' chicken',
   ' chord',
   ' clarinet',
   ' scale',
   ' arpeggio',
   ' cat',
   ' rocker',
   ' jazzer',
   ' microphone',
   ' guitar pick',
   ' plugin',
   ' min7',
   ' maj7',
   ' chord pack',
   ' virtuoso',
   ' synth',
   ' tuba',
   ' theramin',
   ' jukebox',
   ' cassette',
   ' vinyl',
   ' floppy disk',
   ' lazer',
   ' minidisc',
   '.flac',
   '.mp3',
   '.aiff',
   '.dll',
   '.exe',
   '.nsf',
   '.smus',
   '.prg',
   ' wave',
   ' sawtooth',
   ' sinewave',
   ' impulse',
   ' oscillator',
   ' reverb',
   ' filter',
   ' rainbow',
   ' album',
   '.gif',
];


// seed is an integer
function GenerateUserName(seed) {
   const inoun = Math.floor(seed) % gNouns.length;
   const iadj = Math.floor(seed / gNouns.length) % gAdj.length;
   return `${gAdj[iadj]}${gNouns[inoun]} #${seed % 100}`;
}


module.exports = {
   GenerateUserName,
};

