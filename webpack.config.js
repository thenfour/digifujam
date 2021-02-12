// webpack.config.js
const path = require( 'path' );
module.exports = {
    mode: "development",
    context: __dirname,
    entry: './clientsrc/7jam.js',
    output: {
        path: path.resolve( __dirname, 'public/dist' ),
        filename: '7jam.js',
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
