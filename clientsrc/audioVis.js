'use strict';



// // sets up an audio graph.
// class TestAudioSrc {

//     constructor(context) {
//         this.context = context;
//         this.oscillator = context.createOscillator();
//         this.oscillator.type = 'square';
//         this.oscillator.frequency.value = 1440;
//         this.oscillator.start();

//         this.gain1 = context.createGain();
//         this.gain1.gain.value = .95;
//         this.analysisNode = context.createAnalyser();

//         // Reduce output level to not hurt your ears.
//         this.gain2 = context.createGain();
//         this.gain2.gain.value = .0;

//         // [osc] -> [gain] -> [analyzer] -> [gain] -> dest
//         this.oscillator.connect(this.gain1);
//         this.gain1.connect(this.analysisNode);
//         this.analysisNode.connect(this.gain2);
//         this.gain2.connect(this.context.destination);
//     }

// };

class AudioToFFTConverter {
    constructor(analysisNode) {
        //this.fftsize = 512;
        this.freqData = new Uint8Array(analysisNode.frequencyBinCount);
        this.analysisNode = analysisNode;
        //this.analysisNode.fftSize = 1024;
        this.byteTimeDomainData = new Uint8Array(this.analysisNode.fftSize);
        this.lastPeak = 0.0;
    }

    Update() {
        this.analysisNode.getByteFrequencyData(this.freqData);
        this.analysisNode.getByteTimeDomainData(this.byteTimeDomainData);

        // Compute average power over the interval.
        let sumOfSquares = 0;
        let peakInstantaneousPower = 0;
        let peakLevel01 = 0;
        let zeroCrossing01 = 0.0;
        let prev = 0;
        const trigLevel = Math.max(0.01, this.lastPeak * .5);
        for (let i = 0; i < this.byteTimeDomainData.length; i++) {
            const lvl = ((this.byteTimeDomainData[i] / 255.0) - .5);
            const power = lvl ** 2;
            peakLevel01 = Math.max(peakLevel01, lvl);
            sumOfSquares += power; // db
            peakInstantaneousPower = Math.max(power, peakInstantaneousPower); // db
            if (!zeroCrossing01 && prev <= trigLevel && lvl > trigLevel) {
                zeroCrossing01 = i / this.byteTimeDomainData.length;
            }
            prev = lvl;
        }
        const rms = 10 * Math.log10(sumOfSquares / this.byteTimeDomainData.length);
        const peak = 10 * Math.log10(peakInstantaneousPower);
        this.lastPeak = peak;
        return {
            rms, // in db, so <0 for normal audio
            peak, // in db also.
            byteFreqDomainData: this.freqData, // in db (generally < 0) for each bin.
            byteTimeDomainData: this.byteTimeDomainData,
            peakLevel01,
            zeroCrossing01,
        };
    }
};

// this will launch an animation on a canvas element using the given audio analysis node.
class AudioVis {
    constructor(canvas, analysisNode) {

        this.fftProvider = new AudioToFFTConverter(analysisNode);

        this.isRunning = true;

        //const canvas = document.querySelector('#c');
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: false });

        let fftData = this.fftProvider.Update();
        const texture = new THREE.DataTexture(
            fftData.byteTimeDomainData,
            fftData.byteTimeDomainData.length, 1,
            THREE.LuminanceFormat, THREE.UnsignedByteType, undefined, undefined, undefined,
            THREE.LinearFilter, THREE.LinearFilter);

        const fftTex = new THREE.DataTexture(
            fftData.byteFreqDomainData,
            fftData.byteFreqDomainData.length, 1,
            THREE.LuminanceFormat, THREE.UnsignedByteType, undefined, undefined, undefined,
            THREE.LinearFilter, THREE.LinearFilter);

        const fragmentShader = `
#include <common>

    uniform sampler2D u_tex;
    uniform sampler2D u_fft;
uniform float iOscWidth;
uniform float iOscMax;
uniform vec3 iResolution;
uniform float iTime;
uniform float iZeroCrossingX;
uniform float iRMS;
uniform float iPeak;
uniform float iVisType;

const float OscilloscopeXScale = 1.0;

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;

    vec2 uvx = uv*2.-1.;// uv is now -1 to 1.
    uvx = 1.-abs(uvx); // distance to edge, 0-1
    float vign = pow(uvx.y, .6) * pow(uvx.x, .6);

    const float MeterWidth = 2.0;
/*
    if (gl_FragCoord.x > iResolution.x - MeterWidth) {
        // level meter
        gl_FragColor = vec4(step(uv.y - iRMS, 0.), step(uv.y - iPeak, 0.),.5,1);
        return;
    }
    uv = gl_FragCoord.xy / vec2(iResolution.x - MeterWidth, iResolution.y);
*/

    if (iVisType == 1.0) {
        // FFT

        float r = texture2D(u_fft, vec2(pow(uv.x, 3.5), 0.)).r;
        //r = step(uv.y, r);
        float h = smoothstep(0.0, 0.03, r - uv.y - 0.025);

        h *= .5;
        if (uv.y > r) {
            h += (1.-sqrt(uv.y-r))*.1;
        }
        gl_FragColor = vec4(0, h,h,vign);
        return;
    }

    // OSCILLOSCOPE
    float y = uv.y * 2.0 - 1.0; // also -1 to 1.

    float c = texture2D(u_tex, (gl_FragCoord.xy / iOscWidth * OscilloscopeXScale) + iZeroCrossingX).r * 2.0 - 1.0; // -1 to 1
    if (iOscMax > (1./128.)) {
        c /= pow(iOscMax, .6); // normalize it. the pow(<1) curves it so at low volumes it doesn't amplify it fully. 1=full normalization. 0=never normalize; keep low amplitudes low.
    }

    // for loud signals this looks worse, however it's more accurate and reveals the zero crossing so we use it.
    float d = sign(y)*y-sign(y)*c;
    //float d = c - y; // this i think looks better at high levels but ok.
    //float h = step(d, 0.);
    //float h = smoothstep(0.04, 0.0, abs(d - 0.025));
    float h = smoothstep(0.04, 0.0, (d));

    h *= .5;
    h += (1.-d)*.2;

    if (abs(y)<1.5/iResolution.y) {
        gl_FragColor = vec4(0,.5,.5,1);
        h = 1.0;
    }

    h *= vign;
    gl_FragColor = vec4(0, 1,1,h*h);
}
`;
        const uniforms = {
            u_tex: { value: texture },
            u_fft: { value: fftTex },
            iTime: { value: 0 },
            iRMS: { value: 0 },
            iPeak: { value: 0 },
            iOscWidth: { value: fftData.byteTimeDomainData.length },
            iResolution: { value: new THREE.Vector3() },
            iZeroCrossingX: { value: 0 },
            iOscMax: { value: 0 },
            iVisType: { value: 0 },
        };

        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
        const scene = new THREE.Scene();
        scene.background = null;
        const plane = new THREE.PlaneBufferGeometry(2, 2);
        const material = new THREE.ShaderMaterial({ fragmentShader, uniforms });

        material.transparent = true;
        material.blending = THREE.NoBlending;

        scene.add(new THREE.Mesh(plane, material));

        let startTime = new Date();
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        let onFrame = () => {
            if (!this.isRunning) {
                return;
            }

            window.requestAnimationFrame(onFrame);

            let fftData = this.fftProvider.Update();
            texture.needsUpdate = true;
            fftTex.needsUpdate = true;

            uniforms.iZeroCrossingX.value = fftData.zeroCrossing01;
            uniforms.iResolution.value.set(canvas.clientWidth, canvas.clientHeight, 1);
            uniforms.iTime.value = (new Date()) - startTime;
            uniforms.iRMS.value = 1.0 + fftData.rms / 50.0;
            uniforms.iPeak.value = 1.0 + fftData.peak / 50.0;
            uniforms.iOscMax.value = fftData.peakLevel01 * 2.1; // *2.1 because it's 0-1 but will scale only 1/2 the screen.

            // renderer.setSize(canvas.clientWidth, canvas.clientHeight);
            renderer.render(scene, camera);
        }
        window.requestAnimationFrame(onFrame);
    }

    stop() {
        this.isRunning = false;
    }
};

