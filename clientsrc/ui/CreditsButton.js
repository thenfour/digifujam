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
            <div className='dropdownMenu right'>
                <div className={"dropdownMenuButton creditsButton " + (this.state.isExpanded ? "expanded" : "")} onClick={this.onClickExpand}>greetz</div>

                {this.state.isExpanded &&
                    <div className="creditsDialog popUpDialog">
                        <pre>
                        7jam was created by tenfour with tons of help from:<br />
                        <br />
                        wwhhooami<br />
                        ∮ f⁽ʷ⁾(z) 𝐝w = 0<br />
                        wwhhooami<br />
                        Saga Musix<br />
                        Wayfinder<br />
                        Tony Thai<br />
                        Mattmatatt<br />
                        </pre>
                    </div>}
            </div>);
    }
};


class IdeasButton extends React.Component {
    render() {
        return (<button className='dropdownMenuButton' onClick={() => window.DFEvents.emit("IdeasButtonClick")}>Ideas?</button>);
    }
};


class IdeasDialog extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            isShown: false,
        }
    }
    
    componentDidMount() {
        window.DFEvents.on("IdeasButtonClick", this.handleButtonClick);
    }
    
    componentWillUnmount() {
        window.DFEvents.removeListener("IdeasButtonClick", this.handleButtonClick);
    }
    
    handleButtonClick = (e) => {
        this.setState({isShown: true});
    }

    clickMainArea = (e) => {
        e.stopPropagation();
        //e.preventDefault();
    }
    
    render() {
        if (!this.state.isShown) return null;
        return (
            <div id="alertScreen" className='darker ideasDialog' onClick={() => this.setState({isShown: false})}>
            <div id="alertScreen2" onClick={this.clickMainArea}>
                <div id="alertContent">
                    <button className='closeButton'  onClick={() => this.setState({isShown: false})}><i className="material-icons">close</i></button>
    <h2>Got <em>Ideas</em>? Have a <em>question</em>?</h2>
    <ul>
    <li>
        <a href="https://discord.gg/kkf9gQfKAd" target="_blank"> {/* https://discord.gg/cKSF3Mg maj7*/}
            <svg className="socicon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Discord icon</title><path d="M20.222 0c1.406 0 2.54 1.137 2.607 2.475V24l-2.677-2.273-1.47-1.338-1.604-1.398.67 2.205H3.71c-1.402 0-2.54-1.065-2.54-2.476V2.48C1.17 1.142 2.31.003 3.715.003h16.5L20.222 0zm-6.118 5.683h-.03l-.202.2c2.073.6 3.076 1.537 3.076 1.537-1.336-.668-2.54-1.002-3.744-1.137-.87-.135-1.74-.064-2.475 0h-.2c-.47 0-1.47.2-2.81.735-.467.203-.735.336-.735.336s1.002-1.002 3.21-1.537l-.135-.135s-1.672-.064-3.477 1.27c0 0-1.805 3.144-1.805 7.02 0 0 1 1.74 3.743 1.806 0 0 .4-.533.805-1.002-1.54-.468-2.14-1.404-2.14-1.404s.134.066.335.2h.06c.03 0 .044.015.06.03v.006c.016.016.03.03.06.03.33.136.66.27.93.4.466.202 1.065.403 1.8.536.93.135 1.996.2 3.21 0 .6-.135 1.2-.267 1.8-.535.39-.2.87-.4 1.397-.737 0 0-.6.936-2.205 1.404.33.466.795 1 .795 1 2.744-.06 3.81-1.8 3.87-1.726 0-3.87-1.815-7.02-1.815-7.02-1.635-1.214-3.165-1.26-3.435-1.26l.056-.02zm.168 4.413c.703 0 1.27.6 1.27 1.335 0 .74-.57 1.34-1.27 1.34-.7 0-1.27-.6-1.27-1.334.002-.74.573-1.338 1.27-1.338zm-4.543 0c.7 0 1.266.6 1.266 1.335 0 .74-.57 1.34-1.27 1.34-.7 0-1.27-.6-1.27-1.334 0-.74.57-1.338 1.27-1.338z" /></svg>
            <div><em>Chat with us</em> @ discord</div>
        </a>
    </li>
    <li>
        <a href="https://twitter.com/tenfour2" target="_blank">
            <svg className="socicon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>twitter.com/tenfour2</title><path d="M23.954 4.569c-.885.389-1.83.654-2.825.775 1.014-.611 1.794-1.574 2.163-2.723-.951.555-2.005.959-3.127 1.184-.896-.959-2.173-1.559-3.591-1.559-2.717 0-4.92 2.203-4.92 4.917 0 .39.045.765.127 1.124C7.691 8.094 4.066 6.13 1.64 3.161c-.427.722-.666 1.561-.666 2.475 0 1.71.87 3.213 2.188 4.096-.807-.026-1.566-.248-2.228-.616v.061c0 2.385 1.693 4.374 3.946 4.827-.413.111-.849.171-1.296.171-.314 0-.615-.03-.916-.086.631 1.953 2.445 3.377 4.604 3.417-1.68 1.319-3.809 2.105-6.102 2.105-.39 0-.779-.023-1.17-.067 2.189 1.394 4.768 2.209 7.557 2.209 9.054 0 13.999-7.496 13.999-13.986 0-.209 0-.42-.015-.63.961-.689 1.8-1.56 2.46-2.548l-.047-.02z" /></svg>
            <div>Send a message via <em>twitter</em></div>
        </a>
    </li>
    <li>
        <a target="_blank" href="https://github.com/thenfour/digifujam">
            <svg className="socicon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>GitHub icon</title><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
            <div>Submit an issue @ <em>Github</em></div>
        </a>
    </li>
    </ul>

    <h2>How to support 7jam</h2>
    <ul>
    <li><em>Play</em> and have fun!</li>
    <li><em>Spread the word</em>, invite friends. The more the merrier!</li>
    <li><div>7jam is 100% a labor of love. Please <em>support the many musicians</em> that have contributed to the project!</div></li>
    </ul>

                </div>
                {/* <div id="alertClickToContinue">Click or press a key to continue...</div> */}
            </div>
            </div>);
    };
}

module.exports = {
    CreditsButton,
    IdeasButton,
    IdeasDialog,
};

