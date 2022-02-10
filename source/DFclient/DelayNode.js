const DF = require("../DFcommon/DFCommon");
const DFU = require('../DFcommon/dfutil');





class DFDelayNode extends DelayNode {
    constructor(audioCtx, name, destNodes) {
        super(audioCtx, {
            delayTime: 0.3,
            maxDelayTime: 2
        });

        this.originalConnect = this.connect;
        this.originalDisconnect = this.disconnect;

        /*
            [delay] = this

          (src)---->[delay]----------->[saturation]-------------->(dest)
                       ^                             |
                       '---[feedbackGain]<----------'


          (src)---->[delay]-->[filt]-->[saturation]-------------->(dest)
                       ^                             |
                       '---[feedbackGain]<----------'

        */

        this.filter = audioCtx.createBiquadFilter(name);

        this.saturation = this.context.createWaveShaper(name);

        this.feedbackGain = this.context.createGain(name);
        this.feedbackGain.connect(this);

        this.saturation.connect(this.feedbackGain);

        this.connect(this.saturation);
        this.filterIsConnected = false;

        //this.connect = this.saturation.connect;
        destNodes.forEach(d => {
            this.saturation.connect(d);
        });
    }

    disableFilter() {
        if (!this.filterIsConnected) return;
        this.disconnect();
        this.filter.disconnect();
        this.connect(this.saturation);
        this.filterIsConnected = false;
    }

    enableFilter() {
        if (this.filterIsConnected) return;
        this.disconnect();
        this.connect(this.filter);
        this.filter.connect(this.saturation);
        this.filterIsConnected = true;
    }

    setFilterType(type) {
        switch (type) {
            case 0: // off
                this.disableFilter();
                return;
            case 1:
                this.enableFilter();
                this.filter.type = "lowpass";
                return;
            case 2:
                this.enableFilter();
                this.filter.type = "highpass";
                return;
            case 3:
                this.enableFilter();
                this.filter.type = "bandpass";
                return;
        }
        throw new Error(`unknown filter type ${type}`);
    }

    setFilterCutoff(hz) {
        this.filter.frequency.value = hz;
    }

    setFilterQ(q) {
        this.filter.Q.value = q;
    }

    setSaturationAmt(s) {

    }
    
    setFeedbackGain(db) {
        this.feedbackGain.gain.value = DFU.DBToLinear(db);
    }

    setDelayTime(t) {
        const minGlideS = DF.ClientSettings.InstrumentParamIntervalMS / 1000;
        // this.nodes.detuneLFO2amt.gain.linearRampToValueAtTime(patchObj[paramID], this.audioCtx.currentTime + this.minGlideS);
        this.delayTime.linearRampToValueAtTime(t, this.context.currentTime + minGlideS);
    }
}


module.exports = DFDelayNode;

