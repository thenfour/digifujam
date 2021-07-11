const React = require('react');

class CreditsButton extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            isExpanded: false,
        };
    }

    onClickExpand = () => {
        this.setState({
            isExpanded: !this.state.isExpanded,
        });
    };

    render() {

        return (
            <div>
                <div className={"creditsButton " + (this.state.isExpanded ? "expanded" : "")} onClick={this.onClickExpand}>greetz</div>

                {this.state.isExpanded &&
                    <div className="creditsDialog">
                        <pre>
                        7jam was created by tenfour with tons of help from:<br />
                        <br />
                        wwhhooami<br />
                        ∮ f⁽ʷ⁾(z) 𝐝w = 0<br />
                        Saga Musix<br />
                        Wayfinder<br />
                        Tony Thai<br />
                        Mattmatatt<br />
                        </pre>
                    </div>}
            </div>);
    }
};

module.exports = CreditsButton;

