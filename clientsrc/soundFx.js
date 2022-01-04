// for playing application sound effects (non-musical sounds, UI sounds etc.)
const DFU = require('./dfutil');

const RateLimitMS = 1000;
const GainDB = -16;

class SoundEffect {
   constructor(audioCtx, url) {
      this.url = url;
      this.timeLastSent = 0;

      var request = new XMLHttpRequest();
      request.open("GET", url, true);
      request.responseType = "arraybuffer";

      request.onload = () => {
         audioCtx.decodeAudioData(
             request.response,
             (data) => {
                //console.log(`Successfully loaded : ${url}`);
                this.sampleBuffer = data;
             },
             (e) => {
                console.log(`Error while decoding : ${url}`);
                console.log(e);
             });
      };

      request.send();
   }

   play(audioCtx, destNode) {
      if (this.sampleBuffer != null) {
         const now = Date.now();
         if ((now - this.timeLastSent) > RateLimitMS) {
            this.timeLastSent = now;
            const source = audioCtx.createBufferSource();
            source.buffer = this.sampleBuffer;
            source.connect(destNode);
            source.start();
         }
      }
   }
};

const eSoundEffects = {
   ChatMessageNotification : 'ChatMessageNotification',
   UserJoinNotification : 'UserJoinNotification',
   UserPartNotification : 'UserPartNotification',
};

// key should match val of eSoundEffects
const SoundEffectSpecs = {
   'ChatMessageNotification' : 'uisfx/chatMessage.mp3',
   'UserJoinNotification' : 'uisfx/userJoin.mp3',
   'UserPartNotification' : 'uisfx/userPart.mp3',
};

class SoundFxManager {
   constructor(audioCtx, destNode) {
      this.audioCtx = audioCtx;
      this.destNode = destNode;
      this.effects = {};

      destNode.gain.value = DFU.DBToLinear(GainDB);

      Object.entries(SoundEffectSpecs).forEach((e) => {
         this.effects[e[0]] = new SoundEffect(audioCtx, e[1]);
      });
   }

   // effect is from eSoundEffects
   play(effect) {
      if (document.visibilityState === 'visible')
         return;
      this.effects[effect].play(this.audioCtx, this.destNode);
   }
};

module.exports = {
   SoundFxManager,
   eSoundEffects,
};
