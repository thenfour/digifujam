// https://sfzformat.com/legacy/

function matchAll(str/*: string*/, regexp/*: RegExp*/) {
    let match = null;//: RegExpExecArray | null = null;
    const res = [];
    while ((match = regexp.exec(str)) !== null) {
        res.push(match);
    }
    return res;
}

function name2num(name) {
    const tmp = name.match(/^([a-gA-G])(#?)(\d)$/);
    if (!tmp) return -1;
    const d = tmp[1].toLowerCase();
    const s = tmp[2];
    const o = Number(tmp[3]);
    let res = (o + 1) * 12 + (s === "#" ? 1 : 0);
    switch (d) {
        case "c":
            return res;
        case "d":
            return res + 2;
        case "e":
            return res + 4;
        case "f":
            return res + 5;
        case "g":
            return res + 7;
        case "a":
            return res + 9;
        case "b":
            return res + 11;
        default:
            return -1;
    }
}

function parseSFZ(sfzText) {
    sfzText = sfzText.replace(/\/\/.*$/gm, "");
    const ret = {}; // SFZ <header> is an array of instances, and each instance is an object of opcodes.

    // <group> headers 
    let currentGroupOpcodes = {};

    matchAll(sfzText, /<(.*?)>\s([\s\S]*?)((?=<)|\Z)/gm).forEach((res) => { // match all <headers>...

        const headerName = res[1];
        if (!(headerName in ret)) {
            ret[headerName] = [];
        }
        let headerInstanceOpcodes = {};

        //const kvs = matchAll(res[2], /(.*?)=(.*?)($|\s(?=.*?=))/gm); // match all opcodes in this header.
        // ([a-z,0-9,_]*?) // capture the opcode name
        // =
        // (  // capture the value
        //   (?:. // do not capture; any character
        //     (?! // negative lookahead assertion: don't match a character followed by another header
        //       ([a-z,0-9,_]*?)=))*)

        const kvs = matchAll(res[2], /([a-z,0-9,_]*?)=((?:.(?!([a-z,0-9,_]*?)=))*)/gm);//.exec("sample=x1.flac l_1ol=2");
        kvs.forEach((kv) => {
            headerInstanceOpcodes[kv[1].replace(/\s/gm, "")] = /^\d*$/g.test(kv[2])
                ? Number(kv[2])
                : kv[2];
            if (/^[a-gA-G]#?\d$/.test(kv[2])) prop[kv[1]] = name2num(kv[2]);
        });
        if (headerInstanceOpcodes.sample) {
            headerInstanceOpcodes.sample = headerInstanceOpcodes.sample.replace(/\\/g, "/"); // windows path correction
        }

        if (headerName === "group") {
            currentGroupOpcodes = headerInstanceOpcodes;
        }
        else if (headerName === "region") {
            // apply group params.
            let tmp = Object.assign({}, currentGroupOpcodes);
            headerInstanceOpcodes = Object.assign(tmp, headerInstanceOpcodes);
        }

        ret[headerName].push(headerInstanceOpcodes);
    });
    return ret;
};

// // <control>
// // <global>
// // 	<group>
// // 		<region>
// // 			sample=
// // 		<region>
// // 			sample=
// // 	<group>
// // 		<region>
// // 			sample=
// // 		<region>
// // 			sample=

module.exports = parseSFZ;


