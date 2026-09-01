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
const { resolveBuildTarget } = require('../release-targets.cjs');

const WORKER_SOURCE = path.resolve(__dirname, '../../worker-gchat/src/index.js');

module.exports = (env = {}, argv = {}) => {
  const targetName = env.target;
  if (!['team-dev', 'snapshot-dev'].includes(targetName)) {
    throw new Error('QA harness requires --env target=team-dev or the explicit evidence-only snapshot-dev target');
  }
  const harnessProfile = resolveBuildTarget(targetName);

  return ({
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
        // Build-only exposure of the exact Worker quote core selected by this
        // worktree. The loader stubs only Cloudflare's Workflow base class and
        // exports parser/builder/endpoint-guard functions for local evidence.
        test: /index\.js$/,
        include: WORKER_SOURCE,
        use: [{ loader: path.resolve(__dirname, 'worker-quote-core-loader.cjs') }],
      },
      {
        test: /\.jsx?$/,
        exclude: [/node_modules/, WORKER_SOURCE],
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
      STRATUS_API_BASE: JSON.stringify(harnessProfile.apiBase),
      STRATUS_ENV: JSON.stringify(harnessProfile.stratusEnv),
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
};
