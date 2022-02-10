

class MixingDeskInstrument {
    constructor(audioCtx, instrumentSpec, delayNode, dryGain, verbGain) {
        this.audioCtx = audioCtx;
        this.instrumentSpec = instrumentSpec;
        this.delayNode = delayNode;
        this.dryGain = dryGain;
        this.verbGain = verbGain;

        // initial values.
        const patchObj = {};
        patchObj["delayFeedback"] = 0; // values are not important; here we don't read them.
        patchObj["delayFilterType"] = 0;
        patchObj["delayFilterCutoff"] = 0;
        patchObj["delayFilterQ"] = 0;
        patchObj["delayVerbMix"] = 0;
        patchObj["delaySaturation"] = 0;
        patchObj["delayTimeSec"] = 0;
        this.SetParamValues(patchObj);
    }
    
    AllNotesOff() { }
    connect() { }
    disconnect() { }

    // returns [drygain, verbgain]
    getGainLevels() {
        let verbMul = this.instrumentSpec.GetParamByID("delayVerbMix").currentValue;
        return [
            (1.0 - verbMul), // not-verb, scaled by master gain
            verbMul, // verb, scaled by master gain
        ];
    }

    SetParamValues(patchObj) {
        Object.keys(patchObj).forEach(paramID => {
            switch (paramID) {
                case "delayTimeSec":
                    this.delayNode.setDelayTime(parseFloat(this.instrumentSpec.GetParamByID("delayTimeSec").currentValue));
                    break;
                case "delayFilterType":
                    this.delayNode.setFilterType(parseInt(this.instrumentSpec.GetParamByID("delayFilterType").currentValue));
                    break;
                case "delayFilterCutoff":
                    this.delayNode.setFilterCutoff(this.instrumentSpec.GetParamByID("delayFilterCutoff").currentValue);
                    break;
                case "delayFilterQ":
                    this.delayNode.setFilterQ(this.instrumentSpec.GetParamByID("delayFilterQ").currentValue);
                    break;
                case "delayFeedback":
                    this.delayNode.setFeedbackGain(this.instrumentSpec.GetParamByID("delayFeedback").currentValue);
                    break;
                case "delayVerbMix":
                    const gains = this.getGainLevels();
                    this.dryGain.gain.value = gains[0];
                    this.verbGain.gain.value = gains[1];
                    break;
                case "delaySaturation":
                    break;
            }
        });
    };
};


module.exports = MixingDeskInstrument;
