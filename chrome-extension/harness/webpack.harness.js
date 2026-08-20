// Standalone build for the QA harness.
//
// Deliberately a SEPARATE config with its own output directory. The harness must
// never end up in dist/ (which is rsynced verbatim into the installed extension),
// so it is not an entry in webpack.config.js.
//
// The harness imports the REAL components and lib modules from ../src — it does not
// copy them. That is the whole point: what renders here is what ships, so the two
// cannot drift.

const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => ({
  entry: { harness: path.resolve(__dirname, 'index.jsx') },
  output: {
    path: path.resolve(__dirname, '../harness-dist'),
    filename: '[name].bundle.js',
    clean: true,
  },
  resolve: { extensions: ['.js', '.jsx', '.mjs'] },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { chrome: '114' } }],
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        },
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.STRATUS_API_BASE': JSON.stringify('https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev'),
      'process.env.STRATUS_ENV': JSON.stringify('dev'),
    }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'index.html'),
      filename: 'index.html',
      chunks: ['harness'],
    }),
  ],
  devtool: false,
  mode: argv.mode || 'development',
});
