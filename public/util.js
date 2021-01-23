'use strict';

// based on
// https://stackoverflow.com/questions/18389224/how-to-style-html5-range-input-to-have-different-color-before-and-after-slider
let stylizeRangeInput = (elementID, opts) => {
    let stylize = (target) => {
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
