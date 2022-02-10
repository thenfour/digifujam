const DF = require("../DFcommon/DFCommon");
const {AdminRootArea} = require("./adminUI/adminUIMain");
const React = require('react');
const ReactDOM = require('react-dom');

$(() => {
   console.log(`admin client`);

   ReactDOM.render(
       <AdminRootArea />,
       document.getElementById('root'));
});
