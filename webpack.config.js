const path = require( 'path' );
module.exports = {
    mode: "development",
    context: __dirname,
    entry: {
        main: './clientsrc/7jam.js'
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: 'babel-loader',
            }
        ]
    }
};
