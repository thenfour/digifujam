const DF = require("./DFCommon.js");
const DFUI = require("./ui/right");

$(() => {

    // prefix for client-side generated IDs.
    let gNanoid = nanoid;

    // safari audiocontext support
    window.AudioContext = window.AudioContext || window.webkitAudioContext;

    $.getJSON('./ui/spinners.json', function (data) {
        window.gSpinners = data;
    });

    // a default room name based on the URL you entered. only to be used when you're not connected to a room.
    let roomID = DF.routeToRoomID(window.location.pathname);
    window.DFRoomID = roomID;

    ReactDOM.render(
        <DFUI.RootArea />,
        document.getElementById('root')
    );

});

