const React = require('react');
const { RegisterModalHandler, DFInvokeModal, DFModalDialog } = require('./roomPresets');




/////////////////////////////////////////////////////////////////////////////////////////////////////////
class SFZEditor extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
    };
  }

  render() {
    const app = this.props.app;
    const instrument = this.props.instrument;
    const engine = this.props.app.synth.instruments[instrument.instrumentID];
    console.log(engine);

    return (
      <DFModalDialog title={"SFZ Editor: " + this.props.instrument.name} modalClassName="sfzEdit">
          <div className='subtext'>
            Changes made here are local only, and if you want to reset it you must refresh the page.
          </div>
         <fieldset>
            <div className="legend">sfz editur</div>
            <ul className='liveSettings'>
              <li>
                variations
                for each variation, grid of regions (note, velocity)
              </li>
            </ul>
            <button>export JSON to clipboard</button>
         </fieldset>
      </DFModalDialog>
    );
  }
}



RegisterModalHandler("sfzEdit", (app, context) => <SFZEditor app={app} instrument={context.instrument} />);

function LaunchSFZEditor(instrument) {
  DFInvokeModal({
    op: "sfzEdit",
    instrument,
  })
}

module.exports = {
  SFZEditor,
  LaunchSFZEditor,
}