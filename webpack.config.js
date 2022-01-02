const path = require( 'path' );
module.exports = {
    mode: "development",
    context: __dirname,
    entry: {
        '7jam': './clientsrc/7jam.js',
        '7jamAdmin': './clientsrc/7jamAdminClient.js'
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
