const DF = require("./DFCommon.js");
const DFUI = require("./ui/right");
const React = require('react');
const ReactDOM = require('react-dom');
const DFUtils = require("./util");

$(() => {

    // safari audiocontext support
    window.AudioContext = window.AudioContext || window.webkitAudioContext;

    $.getJSON('./ui/spinners.json', function (data) {
        window.gSpinners = data;
    });

    // a default room name based on the URL you entered. only to be used when you're not connected to a room.
    let roomID = DF.routeToRoomID(window.location.pathname);
    window.DFRoomID = roomID;

    window.DFModifierKeyTracker = new DFUtils.ModifierKeyTracker();


    ReactDOM.render(
        <DFUI.RootArea />,
        document.getElementById('root')
    );

});

