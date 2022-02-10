const React = require('react');
const {ValueSliderElement} = require('../util');

function renderKnob(el, value01, formatSpec, valueSpec, propGetter) {
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
    ctx.fillText(valueSpec.value01ToString(value01), centerX, centerY);
  }
}

class SeqLegendKnob extends React.Component {
  constructor(props) {
    super(props);
    this.formatSpec = this.props.formatSpec;
    this.valueSpec = this.props.valueSpec;
    this.isDragging = false;
  }

  get value() {
    return this.valueSpec.value01ToValue(this.value01);
  }

  componentDidMount() {
    this.formatSpec.width = this.formatSpec.height =
        Math.max(this.formatSpec.valHighlightRadius, this.formatSpec.radius) * 2 + Math.max(this.formatSpec.lineWidth, this.formatSpec.valHighlightWidth) + (this.formatSpec.padding ?? 2);

        this.slider = new ValueSliderElement({
          valueSpec : this.valueSpec,
          elements : [this.canvasRef, this.legendRef],
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
    renderKnob(this.canvasRef, this.value01, this.formatSpec, this.valueSpec, (p) => typeof (p) === 'function' ? p(this) : p);
  }

  render() {
    const valueStr = !this.value01 ? "" : this.valueSpec.value01ToString(this.value01);
    return (
      <div className='paramGroup'>
        <div title={valueStr} className='legend' ref={(r) => { this.legendRef = r; }}>{this.props.caption}</div>
        <div className='paramBlock'>
          <canvas title={valueStr} className={this.props.className} ref={(r) => { this.canvasRef = r; }}></canvas>
        </div>
        {this.props.children}
      </div>
    );
  }
}

module.exports = {
  SeqLegendKnob,
};

