"use strict";var e=require("react");function n(e){return e&&"object"==typeof e&&"default"in e?e:{default:e}}var t=n(e);function r(e,n,t){return n in e?Object.defineProperty(e,n,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[n]=t,e}var u={click:"onClick",mousedown:"onMouseDown",mouseup:"onMouseUp",touchstart:"onTouchStart",touchend:"onTouchEnd"},o=function(n){var o,c=n.children,i=n.onClickAway,a=n.mouseEvent,f=void 0===a?"click":a,l=n.touchEvent,d=void 0===l?"touchend":l,s=e.useRef(null),v=e.useRef(null),m=e.useRef(!1);e.useEffect((function(){return setTimeout((function(){m.current=!0}),0),function(){m.current=!1}}),[]);var E=function(e){return function(n){v.current=n.target;var t=null==c?void 0:c.props[e];t&&t(n)}};e.useEffect((function(){var e=function(e){m.current&&(s.current&&s.current.contains(e.target)||v.current===e.target||!document.contains(e.target)||i(e))};return document.addEventListener(f,e),document.addEventListener(d,e),function(){document.removeEventListener(f,e),document.removeEventListener(d,e)}}),[f,i,d]);var p=u[f],h=u[d];return t.default.Children.only(e.cloneElement(c,(r(o={ref:function(e){s.current=e;var n=c.ref;"function"==typeof n?n(e):n&&(n.current=e)}},p,E(p)),r(o,h,E(h)),o)))};o.displayName="ClickAwayListener",module.exports=o;
//# sourceMappingURL=react-click-away-listener.js.map
