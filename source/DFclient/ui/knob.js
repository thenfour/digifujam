const React = require('react');
const {ValueSliderElement} = require('../util');

function renderKnob(el, value01, formatSpec, valueSpec, propGetter) {
  // if (!el) {
  //   console.log(`el is null`);
  // }
  let centerX = formatSpec.width / 2;
  let centerY = formatSpec.height / 2;

  centerY += formatSpec.offsetY ?? 0;

  // el.style.width = `${formatSpec.width}px`;
  // el.style.height = `${formatSpec.height}px`;
  el.width = formatSpec.width;
  el.height = formatSpec.height;

  const ctx = el.getContext('2d');
  ctx.clearRect(0, 0, formatSpec.width, formatSpec.height);

  const startRadians = formatSpec.valueOffsetRadians - formatSpec.valueRangeRadians * .5;
  const endRadians = startRadians + formatSpec.valueRangeRadians;

  ctx.beginPath();
  ctx.arc(centerX, centerY, formatSpec.radius, startRadians, endRadians);
  ctx.lineCap = 'butt'; // butt / round / square
  ctx.lineWidth = formatSpec.lineWidth;
  ctx.strokeStyle = formatSpec.trackColor;
  ctx.stroke();

  const snappedVal = valueSpec.valueToValue01(valueSpec.value01ToValue(value01));

  const valRad = startRadians + snappedVal * formatSpec.valueRangeRadians;
  const centerRad = startRadians + valueSpec.valueToValue01(valueSpec.centerValue) * formatSpec.valueRangeRadians;

  ctx.beginPath();
  ctx.arc(centerX, centerY, formatSpec.radius, Math.min(centerRad, valRad), Math.max(centerRad, valRad));
  ctx.lineCap = 'butt'; // butt / round / square
  ctx.lineWidth = formatSpec.lineWidth;
  ctx.strokeStyle = propGetter(formatSpec.fgColor);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX, centerY, formatSpec.valHighlightRadius, valRad - formatSpec.valHighlightRangeRad * .5, valRad + formatSpec.valHighlightRangeRad * .5);
  ctx.lineCap = formatSpec.valHighlightLineCap; // butt / round / square
  ctx.lineWidth = formatSpec.valHighlightWidth;
  ctx.strokeStyle = propGetter(formatSpec.valHighlightColor);
  ctx.stroke();

  const fontSpec = propGetter(formatSpec.fontSpec);
  if (fontSpec) {
    ctx.font = fontSpec; // + 'px sans-serif';
    ctx.fillStyle = propGetter(formatSpec.textColor);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let txt;
    if (formatSpec.centerText)
      txt = propGetter(formatSpec.centerText);
    else
      txt = valueSpec.value01ToString(value01);
    ctx.fillText(txt, centerX, centerY);
  }
}

class SeqLegendKnob extends React.Component {
  constructor(props) {
    super(props);
    this.formatSpec = this.props.formatSpec ?? {
      fontSpec: (knob) => { return knob.isDragging ? "16px monospace" : null; },
      textColor: "#0ff",
      padding: 1,
      lineWidth: 10,
      valHighlightWidth: 10,
      offsetY: 2,
      trackColor: "#777",
      fgColor: (knob) => { return knob.value < 0 ? "#fa4" : "#fa4"; },
      valHighlightColor: (knob) => { return knob.value === knob.valueSpec.centerValue ? "#0cc" : "#0aa"; },
      radius: 15,
      valHighlightRadius: 15,
      valueRangeRadians: .75 * 2 * Math.PI,
      valueOffsetRadians: Math.PI * 1.5,
      valHighlightRangeRad: 0,
      valHighlightLineCap: 'round', // butt round
    };
    this.valueSpec = this.props.valueSpec;
    this.smallCaption = this.props.smallCaption ?? "";
    this.isDragging = false;
    this.isEnabled = this.props.enabled ?? true;
  }

  get value() {
    return this.valueSpec.value01ToValue(this.value01);
  }

  componentDidMount() {
    this.formatSpec.width = this.formatSpec.height =
        Math.max(this.formatSpec.valHighlightRadius, this.formatSpec.radius) * 2 + Math.max(this.formatSpec.lineWidth, this.formatSpec.valHighlightWidth) + (this.formatSpec.padding ?? 2);

        this.slider = new ValueSliderElement({
          valueSpec : this.valueSpec,
          elements : this.props.hideTitle ? [this.canvasRef] : [this.canvasRef, this.legendRef],
          initialValue : this.props.initialValue,
          onChange : (v, s, isUserAction) => {
            this.value01 = v;
            this.isDragging = s.isDragging;
            this.nonReactUpdate();
            if (this.props.onChange) {
              this.props.onChange(this.valueSpec.value01ToValue(this.value01), isUserAction);
            }
          },
        });

    this.nonReactUpdate();
  }

  nonReactUpdate() {
    if (!this.canvasRef) return;
    renderKnob(this.canvasRef, this.value01, this.formatSpec, this.valueSpec, (p) => typeof (p) === 'function' ? p(this) : p);
  }

  render() {
    const valueStr = !this.value01 ? "" : this.valueSpec.value01ToString(this.value01);
    //console.log(`knob react render: this.props.enabled=${this.props.enabled}  this.isEnabled=${this.isEnabled}`);
    if (this.props.enabled !== this.isEnabled) 
    {
      this.isEnabled = !!this.props.enabled;
      this.nonReactUpdate();
    }
    return (
      <div className='paramGroup'>
        {!this.props.hideTitle &&
          <div title={valueStr} className='legend' ref={(r) => { this.legendRef = r; }}>{this.props.caption}</div>
        }
        <div className='paramBlock'>
          <canvas title={this.props.caption + ": " + valueStr} className={this.props.className} ref={(r) => { this.canvasRef = r; }}></canvas>
        </div>
        {this.props.children}
      </div>
    );
  }
}

class IntRangeValueSpec {
  constructor(min, max, centerValue, resetValue) {
      this.mouseSpeed = 0.004;
      this.fineMouseSpeed = 0.0008;
      this.centerValue = centerValue;
      this.resetValue = resetValue ?? centerValue;
      this.min = min;
      this.max = max;
      this.range = max - min;
  }
  value01ToValue = (v01) => {
      return (v01 * this.range) + this.min;
  }
  valueToValue01 = (v) => {
      return (v - this.min) / this.range;
  }
  value01ToString = (v01) => {
      return parseFloat(this.value01ToValue(v01)).toFixed(0);
  }
};


class FloatValueSpec01 {
  constructor(params) {
    if (params) Object.assign(this, params);
      this.mouseSpeed ??= 0.004;
      this.fineMouseSpeed ??= 0.0008;
      this.centerValue ??= 0.0;
      this.resetValue ??= this.centerValue;
  }
  value01ToValue = (v01) => {
      return v01;
  }
  valueToValue01 = (v) => {
      return v;
  }
  value01ToString = (v01) => {
      return parseFloat(v01).toFixed(2);
  }
};

class FreqValueSpec {
  constructor() {
      this.mouseSpeed ??= 0.004;
      this.fineMouseSpeed ??= 0.0008;
      this.centerValue = 0.0;
  }
  value01ToValue = (v01) => {
      return Math.pow(v01, 3.5) * 20000;
  }
  valueToValue01 = (v) => {
      return Math.pow(v / 20000, 1.0/3.5);
  }
  value01ToString = (v01) => {
      return parseInt(this.value01ToValue(v01));
  }
};




module.exports = {
  SeqLegendKnob,
  IntRangeValueSpec,
  FloatValueSpec01,
  FreqValueSpec,
};

